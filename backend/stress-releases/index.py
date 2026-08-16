import json
import os
import re
import uuid

import boto3
import psycopg2
from botocore.client import Config

SCHEMA = "t_p72635010_quantum_fusion_resea"
TABLE = f"{SCHEMA}.stress_app_releases"

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
}


def resp(code, data):
    return {
        "statusCode": code,
        "headers": {**cors, "Content-Type": "application/json"},
        "body": json.dumps(data, default=str),
    }


def esc(v):
    """Экранирование строки для Simple Query Protocol (параметров нет)."""
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def s3():
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
    )


def cdn_url(key):
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def row_to_dict(r, admin=False):
    d = {
        "id": r[0], "version": r[1], "changelog": r[2] or "",
        "file_url": r[3], "file_name": r[4] or "", "file_size": int(r[5] or 0),
        "download_count": int(r[7] or 0), "created_at": r[8],
    }
    if admin:
        d["s3_key"] = r[9] or ""
        d["is_published"] = bool(r[6])
    return d


COLS = ("id, version, changelog, file_url, file_name, file_size, "
        "is_published, download_count, created_at, s3_key")


def handler(event: dict, context) -> dict:
    """Версии стресс-тестера (EXE): список для сайта, загрузка и управление из админки.

    Файл до 5 ГБ грузится браузером НАПРЯМУЮ в S3 по presigned-ссылке —
    через функцию он не проходит (лимиты размера и времени выполнения).
    """
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    headers = event.get("headers") or {}
    params = event.get("queryStringParameters") or {}
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except ValueError:
            body = {}

    admin_key = (headers.get("X-Admin-Key") or headers.get("x-admin-key")
                 or body.get("ak") or params.get("ak") or "")
    is_admin = bool(admin_key) and admin_key == os.environ.get("ADMIN_KEY")

    conn = get_conn()
    cur = conn.cursor()
    try:
        if method == "GET":
            # Админу отдаём и черновики, публике — только опубликованные.
            where = "" if is_admin else "WHERE is_published = TRUE"
            cur.execute(f"SELECT {COLS} FROM {TABLE} {where} ORDER BY id DESC")
            rows = cur.fetchall()
            return resp(200, {"releases": [row_to_dict(r, is_admin) for r in rows]})

        if method != "POST":
            return resp(405, {"error": "method not allowed"})

        action = body.get("action") or ""

        # ── Публичное: засчитать скачивание ───────────────────────────────
        if action == "count_download":
            rid = int(body.get("id") or 0)
            if rid:
                cur.execute(
                    f"UPDATE {TABLE} SET download_count = download_count + 1 WHERE id = {rid}"
                )
                conn.commit()
            return resp(200, {"ok": True})

        # ── Дальше только админ ───────────────────────────────────────────
        if not is_admin:
            return resp(403, {"error": "Нет доступа"})

        # Шаг 1: выдать ссылку для прямой загрузки файла в хранилище.
        if action == "upload_url":
            name = (body.get("file_name") or "stress-tester.exe").strip()
            # Оставляем только безопасные символы, иначе ключ объекта может сломаться.
            safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:120] or "app.exe"
            key = f"stress_app/{uuid.uuid4().hex}_{safe}"
            url = s3().generate_presigned_url(
                "put_object",
                Params={"Bucket": "files", "Key": key,
                        "ContentType": "application/octet-stream"},
                ExpiresIn=6 * 60 * 60,  # 6 часов: 5 ГБ на медленном канале грузятся долго
            )
            return resp(200, {"upload_url": url, "s3_key": key, "file_url": cdn_url(key)})

        # Шаг 2: файл уже в хранилище — сохраняем карточку версии.
        if action == "create":
            version = (body.get("version") or "").strip()
            file_url = (body.get("file_url") or "").strip()
            if not version or not file_url:
                return resp(400, {"error": "Нужны версия и файл"})
            cur.execute(
                f"INSERT INTO {TABLE} (version, changelog, file_url, file_name, "
                f"file_size, s3_key, is_published) VALUES ("
                f"{esc(version)}, {esc(body.get('changelog') or '')}, {esc(file_url)}, "
                f"{esc(body.get('file_name') or '')}, {int(body.get('file_size') or 0)}, "
                f"{esc(body.get('s3_key') or '')}, "
                f"{'TRUE' if body.get('is_published', True) else 'FALSE'}) RETURNING id"
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return resp(201, {"ok": True, "id": new_id})

        if action == "update":
            rid = int(body.get("id") or 0)
            if not rid:
                return resp(400, {"error": "Нет id"})
            sets = []
            if "version" in body:
                sets.append(f"version = {esc(body['version'])}")
            if "changelog" in body:
                sets.append(f"changelog = {esc(body['changelog'])}")
            if "is_published" in body:
                sets.append(f"is_published = {'TRUE' if body['is_published'] else 'FALSE'}")
            if not sets:
                return resp(400, {"error": "Нечего обновлять"})
            cur.execute(f"UPDATE {TABLE} SET {', '.join(sets)} WHERE id = {rid}")
            conn.commit()
            return resp(200, {"ok": True})

        if action == "delete":
            rid = int(body.get("id") or 0)
            if not rid:
                return resp(400, {"error": "Нет id"})
            cur.execute(f"SELECT s3_key FROM {TABLE} WHERE id = {rid}")
            row = cur.fetchone()
            # Файл удаляем вместе с карточкой, иначе 5 ГБ мусора останутся в бакете.
            if row and row[0]:
                try:
                    s3().delete_object(Bucket="files", Key=row[0])
                except Exception:
                    pass
            cur.execute(f"DELETE FROM {TABLE} WHERE id = {rid}")
            conn.commit()
            return resp(200, {"ok": True})

        return resp(400, {"error": "Неизвестное действие"})
    finally:
        cur.close()
        conn.close()
