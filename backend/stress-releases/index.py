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


_UUID_NAME = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def key_from_url(url):
    """Ключ объекта, если ссылка ведёт в наше хранилище (иначе '')."""
    marker = f"/projects/{os.environ.get('AWS_ACCESS_KEY_ID', '')}/bucket/"
    if not url or marker not in url:
        return ""
    return url.split(marker, 1)[1].split("?", 1)[0]


def nice_file_name(name, version, edition="full"):
    """Имя для сохранения на диск клиента.

    Файлы в хранилище часто лежат под техническим именем-идентификатором
    (cd660c2d-….exe) — тогда собираем понятное имя из номера версии.
    """
    name = (name or "").strip()
    base = name.rsplit("/", 1)[-1]
    ext = ("." + base.rsplit(".", 1)[-1].lower()) if "." in base else ".exe"
    if base and not _UUID_NAME.match(base):
        return base
    ver = re.sub(r"[^0-9A-Za-z._-]", "_", clean_version(version)) or "latest"
    suffix = "_Lite" if edition == "lite" else ""
    return f"StressTester_Setup_{ver}{suffix}{ext}"


def detect_edition(*hints):
    """Сборка по названию: 'lite' если где-то встретилось Lite/Light."""
    for h in hints:
        if h and re.search(r"(?i)\b(lite|light)\b|_lite|-lite", str(h)):
            return "lite"
    return "full"


def clean_version(raw):
    """Голый номер версии: без «v», без слов Lite/Full.

    Полная и облегчённая сборки — одна версия программы, поэтому сверка
    идёт именно по этому номеру.
    """
    v = re.sub(r"(?i)(lite|light|full)", " ", str(raw or ""))
    v = re.sub(r"^[vV][\s._-]*", "", v.strip())
    return v.strip(" -_.") or str(raw or "").strip()


_LAST_RENAME_ERROR = {"msg": ""}


def ensure_named_key(key, nice_name):
    """Переложить файл так, чтобы адрес заканчивался понятным именем.

    Хранилище не отдаёт заданное в ссылке имя файла (Content-Disposition
    теряется), поэтому браузер берёт имя из адреса. Если файл лежит под
    техническим именем — копируем его в stress_app/<id>/<нормальное имя>
    и удаляем исходный объект.
    """
    if not key or key.rsplit("/", 1)[-1] == nice_name:
        return key
    new_key = f"stress_app/{uuid.uuid4().hex}/{nice_name}"
    cli = s3()
    try:
        cli.copy_object(Bucket="files", Key=new_key,
                        CopySource={"Bucket": "files", "Key": key})
    except Exception as e:
        # Файл останется под прежним адресом — скачивание не ломаем.
        print(f"[RELEASES] переименование не удалось: {e}")
        _LAST_RENAME_ERROR["msg"] = str(e)[:300]
        return key
    try:
        cli.delete_object(Bucket="files", Key=key)
    except Exception as e:
        print(f"[RELEASES] не удалось удалить исходный файл {key}: {e}")
    return new_key


def cdn_url(key):
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"


def download_url(s3_key, file_name):
    """Временная ссылка на файл в нашем хранилище (действует час).

    Постоянный адрес наружу не отдаём — он расходится по чатам и живёт
    вечно. Имя файла браузер берёт из КОНЦА адреса: наше хранилище
    заголовок Content-Disposition из ссылки не применяет, поэтому объект
    заранее переложен под понятным именем (ensure_named_key).
    """
    name = (file_name or "stress-tester.exe").replace('"', "")
    # Имя берётся из адреса объекта (см. ensure_named_key): подсказку
    # Content-Disposition хранилище отбрасывает. Оставляем её на случай,
    # если поведение изменится, но полагаться на неё нельзя.
    return s3().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": "files", "Key": s3_key,
            "ResponseContentType": "application/octet-stream",
            "ResponseContentDisposition": f'attachment; filename="{name}"',
        },
        ExpiresIn=60 * 60,
    )


def row_to_dict(r, admin=False):
    s3_key = r[9] or ""
    d = {
        "id": r[0], "version": r[1], "changelog": r[2] or "",
        # Файл из нашего хранилища скачивается по временной ссылке —
        # её выдаёт count_download, поэтому наружу адрес не публикуем.
        "file_url": "" if s3_key else (r[3] or ""),
        "file_name": r[4] or "", "file_size": int(r[5] or 0),
        "download_count": int(r[7] or 0), "created_at": r[8],
        "storage": "local" if s3_key else "external",
        # full | lite — сборка одной и той же версии программы.
        "edition": (r[10] if len(r) > 10 else None) or "full",
    }
    if admin:
        d["s3_key"] = s3_key
        d["file_url"] = r[3] or ""
        d["is_published"] = bool(r[6])
    return d


COLS = ("id, version, changelog, file_url, file_name, file_size, "
        "is_published, download_count, created_at, s3_key, edition")


def handler(event: dict, context) -> dict:
    """Версии стресс-тестера (EXE): список для сайта, загрузка и управление из админки.

    Файл до 5 ГБ грузится браузером НАПРЯМУЮ в S3 по presigned-ссылке —
    через функцию он не проходит (лимиты размера и времени выполнения).
    Скачивание идёт по временной ссылке; путь объекта заканчивается
    настоящим именем файла, иначе браузер сохраняет его как «uuid.exe».
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
                    f"WHERE id = {rid} AND is_published = TRUE "
                    f"RETURNING source_link, file_url, s3_key, file_name, version, edition"
                )
                row = cur.fetchone()
                conn.commit()
                if row:
                    key = row[2] or key_from_url(row[1])
                    if key:
                        # Наше хранилище: временная ссылка. Файлы, залитые до
                        # появления «говорящих» путей, перекладываем на лету —
                        # иначе браузер сохранит их под техническим именем.
                        nice = nice_file_name(row[3], row[4], row[5] or "full")
                        new_key = ensure_named_key(key, nice)
                        if new_key != key:
                            cur.execute(
                                f"UPDATE {TABLE} SET s3_key = {esc(new_key)}, "
                                f"file_url = {esc(cdn_url(new_key))}, "
                                f"file_name = {esc(nice)} WHERE id = {rid}"
                            )
                            conn.commit()
                            key = new_key
                        target = download_url(key, nice)
                    else:
                        target = row[0] or row[1] or ""
            if not target:
                return resp(404, {"ok": False, "error": "Версия недоступна"})
            out = {"ok": True, "file_url": target}
            if is_admin and _LAST_RENAME_ERROR["msg"]:
                out["rename_error"] = _LAST_RENAME_ERROR["msg"]
            return resp(200, out)

        # Самопроверка: умеет ли хранилище копировать объект и отдавать
        # заданное имя файла. Работает на крошечном временном объекте и
        # подчищает за собой (вызывается тестами при деплое).
        if action == "selftest_storage":
            key_a = "__selftest__/probe.bin"
            key_b = "__selftest__/Nice_Name.exe"
            out = {"ok": False}
            try:
                cli = s3()
                cli.put_object(Bucket="files", Key=key_a, Body=b"probe",
                               ContentType="application/octet-stream")
                cli.copy_object(
                    Bucket="files", Key=key_b,
                    CopySource={"Bucket": "files", "Key": key_a},
                    ContentType="application/octet-stream",
                    ContentDisposition='attachment; filename="Nice_Name.exe"',
                    MetadataDirective="REPLACE",
                )
                head = cli.head_object(Bucket="files", Key=key_b)
                out = {"ok": True, "copy": True,
                       "disposition": head.get("ContentDisposition") or ""}
            except Exception as e:
                out = {"ok": True, "copy": False, "error": str(e)[:300]}
            finally:
                for k in (key_a, key_b):
                    try:
                        s3().delete_object(Bucket="files", Key=k)
                    except Exception:
                        pass
            return resp(200, out)

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

        # Разовая починка: перекладывает файлы версий под понятные имена,
        # если они лежат в хранилище под техническим идентификатором.
        if action == "fix_file_names":
            cur.execute(f"SELECT id, version, file_name, file_url, s3_key, edition "
                        f"FROM {TABLE}")
            fixed = []
            for rid, ver, fname, furl, skey, edi in cur.fetchall():
                key = (skey or "") or key_from_url(furl or "")
                if not key:
                    continue
                nice = nice_file_name(fname, ver, edi or "full")
                if key.rsplit("/", 1)[-1] == nice:
                    continue
                try:
                    new_key = ensure_named_key(key, nice)
                except Exception as e:
                    print(f"[RELEASES] fix {rid}: {e}")
                    continue
                cur.execute(
                    f"UPDATE {TABLE} SET s3_key = {esc(new_key)}, "
                    f"file_url = {esc(cdn_url(new_key))}, file_name = {esc(nice)} "
                    f"WHERE id = {int(rid)}"
                )
                fixed.append({"id": rid, "file_name": nice})
            conn.commit()
            return resp(200, {"ok": True, "fixed": fixed})

        # Список файлов в нашем хранилище — чтобы выбрать уже залитый EXE
        # прямо в админке, не составляя ссылку руками.
        if action == "storage_files":
            prefix = (body.get("prefix") or params.get("prefix") or "").strip()
            files = []
            token = None
            while True:
                kw = {"Bucket": "files", "MaxKeys": 1000}
                if prefix:
                    kw["Prefix"] = prefix
                if token:
                    kw["ContinuationToken"] = token
                page = s3().list_objects_v2(**kw)
                for o in page.get("Contents", []):
                    key = o["Key"]
                    size = int(o.get("Size") or 0)
                    # Показываем только дистрибутивы: мелочь и картинки не нужны.
                    if not key.lower().endswith((".exe", ".msi", ".zip", ".7z")):
                        continue
                    files.append({
                        "key": key,
                        "name": key.rsplit("/", 1)[-1],
                        "size": size,
                        "modified": str(o.get("LastModified") or ""),
                    })
                if not page.get("IsTruncated"):
                    break
                token = page.get("NextContinuationToken")
            files.sort(key=lambda f: f["modified"], reverse=True)
            return resp(200, {"ok": True, "files": files[:200]})

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
            s3_key = (body.get("s3_key") or "").strip()
            file_name_raw = (body.get("file_name") or "").strip()
            if not version or not (file_url or s3_key):
                return resp(400, {"error": "Нужны версия и файл"})

            # Полная и Lite — одна версия программы, отличается только сборка.
            # Определяем её по названию файла/версии, номер версии чистим.
            edition = (body.get("edition") or "").strip().lower()
            if edition not in ("full", "lite"):
                edition = detect_edition(file_name_raw, version, body.get("source_link"))
            version = clean_version(version)

            # Ссылка на наш бакет → работаем с ним как с локальным файлом:
            # тогда сможем выдавать временную ссылку с нормальным именем.
            s3_key = s3_key or key_from_url(file_url)
            file_name = nice_file_name(file_name_raw, version, edition)
            if s3_key:
                try:
                    s3_key = ensure_named_key(s3_key, file_name)
                    file_url = cdn_url(s3_key)
                except Exception as e:
                    print(f"[RELEASES] переименование не удалось: {e}")

            cur.execute(
                f"INSERT INTO {TABLE} (version, edition, changelog, file_url, file_name, "
                f"file_size, s3_key, is_published, source_link) VALUES ("
                f"{esc(version)}, {esc(edition)}, {esc(body.get('changelog') or '')}, "
                f"{esc(file_url)}, {esc(file_name)}, {int(body.get('file_size') or 0)}, "
                f"{esc(s3_key)}, "
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
                # Номер версии храним «голым» — по нему сверяются сборки.
                new_ver = clean_version(body["version"])
                sets.append(f"version = {esc(new_ver)}")
                # Файл переименовываем следом, чтобы имя совпадало с версией.
                cur.execute(f"SELECT file_name, file_url, s3_key, edition "
                            f"FROM {TABLE} WHERE id = {rid}")
                cur_row = cur.fetchone()
                if cur_row:
                    key = (cur_row[2] or "") or key_from_url(cur_row[1] or "")
                    nice = nice_file_name("", new_ver, cur_row[3] or "full")
                    if key and key.rsplit("/", 1)[-1] != nice:
                        try:
                            new_key = ensure_named_key(key, nice)
                            sets.append(f"s3_key = {esc(new_key)}")
                            sets.append(f"file_url = {esc(cdn_url(new_key))}")
                            sets.append(f"file_name = {esc(nice)}")
                        except Exception as e:
                            print(f"[RELEASES] переименование при правке: {e}")
            if "edition" in body and str(body["edition"]).lower() in ("full", "lite"):
                sets.append(f"edition = {esc(str(body['edition']).lower())}")
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