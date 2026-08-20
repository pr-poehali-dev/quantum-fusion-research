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


def ensure_cors():
    """Разрешить браузеру грузить файлы в хранилище напрямую.

    Без этого правила браузер обрывает загрузку на старте («Загрузка
    прервалась») — запрос из вкладки к другому домену блокируется.
    Ставим правило перед каждой выдачей ссылки: операция дешёвая и
    защищает от сброса настроек хранилища.
    """
    try:
        s3().put_bucket_cors(Bucket="files", CORSConfiguration={"CORSRules": [{
            "AllowedHeaders": ["*"],
            "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
            "AllowedOrigins": ["*"],
            "ExposeHeaders": ["ETag"],
            "MaxAgeSeconds": 3600,
        }]})
    except Exception as e:
        print(f"[RELEASES] не удалось выставить CORS: {e}")


YADISK_API = "https://cloud-api.yandex.net/v1/disk/public/resources"


def resolve_yadisk(link: str) -> dict:
    """Публичная ссылка Яндекс.Диска → прямая ссылка на скачивание.

    Возвращает {ok, file_url, file_name, file_size} либо {ok: False, error}.
    Обычная ссылка вида disk.yandex.ru/d/xxx открывает страницу, а не файл,
    поэтому спрашиваем у Яндекса настоящий адрес. Ссылка «живая» ограниченное
    время, но её можно получать заново — при скачивании делаем это на лету.
    """
    import urllib.parse
    import urllib.request
    import urllib.error

    if not link.startswith("http"):
        return {"ok": False, "error": "Ссылка должна начинаться с https://"}

    if "yandex" not in link:
        # Не Яндекс.Диск — считаем, что это уже прямая ссылка на файл.
        name = urllib.parse.urlparse(link).path.rsplit("/", 1)[-1] or "stress-tester.exe"
        size = 0
        try:
            req = urllib.request.Request(link, method="HEAD")
            req.add_header("User-Agent", "Mozilla/5.0")
            with urllib.request.urlopen(req, timeout=10) as r:
                size = int(r.headers.get("Content-Length") or 0)
        except Exception:
            pass
        return {"ok": True, "file_url": link, "file_name": name, "file_size": size,
                "direct": True}

    try:
        meta_url = f"{YADISK_API}?public_key={urllib.parse.quote(link, safe='')}"
        with urllib.request.urlopen(meta_url, timeout=10) as r:
            meta = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"ok": False, "error": "Яндекс.Диск не нашёл файл по этой ссылке. "
                                          "Убедитесь, что доступ открыт «по ссылке»"}
        return {"ok": False, "error": f"Яндекс.Диск ответил ошибкой {e.code}"}
    except Exception as e:
        return {"ok": False, "error": f"Не удалось проверить ссылку: {str(e)[:120]}"}

    if meta.get("type") == "dir":
        return {"ok": False, "error": "Это ссылка на папку. Нужна ссылка на сам файл"}

    try:
        dl_url = f"{YADISK_API}/download?public_key={urllib.parse.quote(link, safe='')}"
        with urllib.request.urlopen(dl_url, timeout=10) as r:
            href = json.loads(r.read().decode("utf-8")).get("href") or ""
    except Exception as e:
        return {"ok": False, "error": f"Не удалось получить файл: {str(e)[:120]}"}

    if not href:
        return {"ok": False, "error": "Яндекс.Диск не отдал ссылку на файл"}

    # href — одноразовая ссылка, привязанная к запросившему; клиенту отдаём
    # публичную страницу файла (там кнопка «Скачать» работает у всех).
    return {"ok": True, "file_url": link, "direct_url": href, "public_link": link,
            "file_name": meta.get("name") or "stress-tester.exe",
            "file_size": int(meta.get("size") or 0)}


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

        # ── Публичное: засчитать скачивание и выдать ссылку для перехода ──
        # Прямую ссылку Яндекс.Диска отдавать клиенту нельзя: она одноразовая
        # и привязана к тому, кто её запросил (сервер), поэтому в браузере
        # клиента открывается с ошибкой. Отправляем на страницу файла.
        if action == "count_download":
            rid = int(body.get("id") or 0)
            target = ""
            if rid:
                cur.execute(
                    f"UPDATE {TABLE} SET download_count = download_count + 1 "
                    f"WHERE id = {rid} RETURNING source_link, file_url"
                )
                row = cur.fetchone()
                conn.commit()
                if row:
                    target = row[0] or row[1] or ""
            return resp(200, {"ok": True, "file_url": target})

        # ── Дальше только админ ───────────────────────────────────────────
        if not is_admin:
            return resp(403, {"error": "Нет доступа"})

        # Шаг 1: выдать ссылку для прямой загрузки файла в хранилище.
        if action == "upload_url":
            ensure_cors()
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

        # Публичная ссылка Яндекс.Диска → прямая ссылка на файл + имя и размер.
        # Хранилище проекта не принимает загрузку из браузера, поэтому большие
        # EXE выкладываются на Яндекс.Диск, а сайт раздаёт их по ссылке.
        if action == "resolve_link":
            src = (body.get("link") or "").strip()
            if not src:
                return resp(400, {"error": "Вставьте ссылку на файл"})
            info = resolve_yadisk(src)
            if not info.get("ok"):
                return resp(200, info)
            return resp(200, info)

        # Проверка: файл реально долетел в хранилище (и какого он размера).
        if action == "check_upload":
            key = (body.get("s3_key") or "").strip()
            if not key:
                return resp(400, {"error": "Нет ключа файла"})
            try:
                head = s3().head_object(Bucket="files", Key=key)
                return resp(200, {"ok": True, "size": int(head.get("ContentLength") or 0)})
            except Exception as e:
                return resp(200, {"ok": False, "error": str(e)[:200]})

        # Шаг 2: файл уже в хранилище — сохраняем карточку версии.
        if action == "create":
            version = (body.get("version") or "").strip()
            file_url = (body.get("file_url") or "").strip()
            if not version or not file_url:
                return resp(400, {"error": "Нужны версия и файл"})
            cur.execute(
                f"INSERT INTO {TABLE} (version, changelog, file_url, file_name, "
                f"file_size, s3_key, is_published, source_link) VALUES ("
                f"{esc(version)}, {esc(body.get('changelog') or '')}, {esc(file_url)}, "
                f"{esc(body.get('file_name') or '')}, {int(body.get('file_size') or 0)}, "
                f"{esc(body.get('s3_key') or '')}, "
                f"{'TRUE' if body.get('is_published', True) else 'FALSE'}, "
                f"{esc(body.get('source_link') or '')}) RETURNING id"
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