import json
import os
import base64
import uuid
import io
import boto3
from botocore.client import Config
from PIL import Image

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

MAX_SIZE = (1200, 1200)
WEBP_QUALITY = 82

# Видео в статьях. Файл НЕ проходит через функцию (ролик на сотни мегабайт
# не влезет в тело запроса) — браузер грузит его напрямую в хранилище по
# временной ссылке, а сюда приходит только запрос на эту ссылку.
VIDEO_TYPES = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-m4v": "m4v",
}


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
    )


def cdn_url(key: str) -> str:
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def video_upload_url(body: dict) -> dict:
    """Временная ссылка для загрузки видео прямо из браузера в хранилище."""
    mime = (body.get("content_type") or "").strip().lower()
    if mime not in VIDEO_TYPES:
        return {"statusCode": 400, "headers": cors, "body": json.dumps(
            {"error": "Поддерживаются видео MP4, WebM и MOV"})}

    key = f"articles/video/{uuid.uuid4().hex}.{VIDEO_TYPES[mime]}"
    url = s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": "files", "Key": key, "ContentType": mime},
        ExpiresIn=3 * 60 * 60,  # 3 часа: большой ролик на слабом канале
    )
    return {"statusCode": 200, "headers": cors, "body": json.dumps(
        {"upload_url": url, "url": cdn_url(key), "key": key})}


def compress_image(image_bytes: bytes, mime: str) -> tuple[bytes, str]:
    img = Image.open(io.BytesIO(image_bytes))

    if img.mode in ("RGBA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGBA", img.size, (255, 255, 255, 255))
        background.paste(img, mask=img.split()[3])
        img = background.convert("RGB")
    elif img.mode != "RGB":
        img = img.convert("RGB")

    img.thumbnail(MAX_SIZE, Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format="WEBP", quality=WEBP_QUALITY, method=6)
    return out.getvalue(), "image/webp"


def handler(event: dict, context) -> dict:
    """Загрузка изображений в S3 со сжатием в WebP. POST с base64-файлом, возвращает CDN URL."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "method not allowed"})}

    body = json.loads(event.get("body") or "{}")

    # Видео: отдаём ссылку на прямую загрузку, сам файл сюда не приходит
    if body.get("action") == "video_upload_url":
        return video_upload_url(body)

    file_data = body.get("file", "")
    folder = body.get("folder", "products")
    compress = body.get("compress", True)

    if not file_data:
        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "no file"})}

    if "," in file_data:
        header, b64 = file_data.split(",", 1)
        mime = header.split(":")[1].split(";")[0] if ":" in header else "image/jpeg"
    else:
        b64 = file_data
        mime = "image/jpeg"

    image_bytes = base64.b64decode(b64)

    if compress and mime in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        image_bytes, mime = compress_image(image_bytes, mime)
        ext = "webp"
    else:
        ext_map = {
            "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
            "application/pdf": "pdf",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
            "application/vnd.ms-excel": "xls",
        }
        ext = ext_map.get(mime, "jpg")

    unique_name = f"{folder}/{uuid.uuid4().hex}.{ext}"

    s3_client().put_object(
        Bucket="files",
        Key=unique_name,
        Body=image_bytes,
        ContentType=mime,
    )

    return {"statusCode": 200, "headers": cors, "body": json.dumps({"url": cdn_url(unique_name)})}