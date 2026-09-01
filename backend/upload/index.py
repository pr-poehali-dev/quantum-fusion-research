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

# Видео в статьях. Идёт через функцию КУСКАМИ — прямая загрузка в хранилище
# из браузера невозможна (подробности в video_upload_url).
VIDEO_TYPES = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-m4v": "m4v",
}

# Размер куска. Платформа принимает не больше 3,5 МБ в запросе, а base64
# раздувает данные примерно на треть — поэтому берём 2 МБ сырых данных.
VIDEO_CHUNK = 2 * 1024 * 1024


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
    """Начало загрузки видео: заводим файл и отдаём его адрес.

    ПОЧЕМУ ПО КУСКАМ, А НЕ НАПРЯМУЮ В ХРАНИЛИЩЕ (проверено в браузере):
    хранилище не отвечает на предзапрос браузера (OPTIONS → 403), поэтому
    любая прямая загрузка из вкладки — и PUT по временной ссылке, и POST
    формой — блокируется, хотя через curl работает. Правило CORS на бакете
    выставляется без ошибки, но в ответах не применяется.
    Вывод: файл идёт ЧЕРЕЗ функцию. Целиком нельзя — платформа принимает
    не больше 3,5 МБ за запрос, поэтому браузер режет видео на части и
    досылает их по очереди, а мы склеиваем куски в хранилище.
    """
    mime = (body.get("content_type") or "").strip().lower()
    if mime not in VIDEO_TYPES:
        return {"statusCode": 400, "headers": cors, "body": json.dumps(
            {"error": "Поддерживаются видео MP4, WebM и MOV"})}

    key = f"articles/video/{uuid.uuid4().hex}.{VIDEO_TYPES[mime]}"
    return {"statusCode": 200, "headers": cors, "body": json.dumps(
        {"key": key, "url": cdn_url(key), "chunk_size": VIDEO_CHUNK})}


def video_chunk(body: dict) -> dict:
    """Приём одного куска видео. Куски копятся рядом и склеиваются в конце."""
    key = (body.get("key") or "").strip()
    index = body.get("index")
    data = body.get("data") or ""
    if not key.startswith("articles/video/") or not isinstance(index, int):
        return {"statusCode": 400, "headers": cors,
                "body": json.dumps({"error": "bad request"})}

    if "," in data:
        data = data.split(",", 1)[1]
    chunk = base64.b64decode(data)
    s3_client().put_object(Bucket="files", Key=f"{key}.part{index:05d}", Body=chunk)
    return {"statusCode": 200, "headers": cors,
            "body": json.dumps({"ok": True, "index": index, "size": len(chunk)})}


def video_finish(body: dict) -> dict:
    """Склейка кусков в один файл и уборка временных частей."""
    key = (body.get("key") or "").strip()
    total = body.get("total")
    mime = (body.get("content_type") or "video/mp4").strip().lower()
    if not key.startswith("articles/video/") or not isinstance(total, int) or total < 1:
        return {"statusCode": 400, "headers": cors,
                "body": json.dumps({"error": "bad request"})}

    cli = s3_client()
    buf = io.BytesIO()
    part_keys = []
    for i in range(total):
        pk = f"{key}.part{i:05d}"
        part_keys.append(pk)
        buf.write(cli.get_object(Bucket="files", Key=pk)["Body"].read())

    body_bytes = buf.getvalue()
    cli.put_object(Bucket="files", Key=key, Body=body_bytes,
                   ContentType=mime if mime in VIDEO_TYPES else "video/mp4")

    # Части занимают место — убираем сразу после склейки
    for pk in part_keys:
        try:
            cli.delete_object(Bucket="files", Key=pk)
        except Exception as e:
            print(f"[UPLOAD] не удалось убрать часть {pk}: {e}")

    return {"statusCode": 200, "headers": cors, "body": json.dumps(
        {"ok": True, "url": cdn_url(key), "size": len(body_bytes)})}


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

    # Видео: заводим файл, принимаем куски, склеиваем
    if body.get("action") == "video_upload_url":
        return video_upload_url(body)
    if body.get("action") == "video_chunk":
        return video_chunk(body)
    if body.get("action") == "video_finish":
        return video_finish(body)



    # Проба: presigned POST (форма) вместо PUT — POST с multipart/form-data


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