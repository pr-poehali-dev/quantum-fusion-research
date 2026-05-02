import json
import os
import base64
import uuid
import boto3
from botocore.client import Config

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

def handler(event: dict, context) -> dict:
    """Загрузка изображений в S3. POST с base64-файлом, возвращает CDN URL."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "method not allowed"})}

    body = json.loads(event.get("body") or "{}")
    file_data = body.get("file", "")
    file_name = body.get("name", "image.jpg")
    folder = body.get("folder", "products")

    if not file_data:
        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "no file"})}

    # Парсим base64 data URL: "data:image/jpeg;base64,..."
    if "," in file_data:
        header, b64 = file_data.split(",", 1)
        # Определяем расширение из mime-типа
        mime = header.split(":")[1].split(";")[0] if ":" in header else "image/jpeg"
    else:
        b64 = file_data
        mime = "image/jpeg"

    ext_map = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
    ext = ext_map.get(mime, "jpg")

    # Уникальное имя файла
    unique_name = f"{folder}/{uuid.uuid4().hex}.{ext}"

    image_bytes = base64.b64decode(b64)

    s3 = boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
    )

    s3.put_object(
        Bucket="files",
        Key=unique_name,
        Body=image_bytes,
        ContentType=mime,
    )

    cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{unique_name}"

    return {"statusCode": 200, "headers": cors, "body": json.dumps({"url": cdn_url})}
