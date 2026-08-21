"""Отчёты о нехватке датчиков на тестовом стенде (sensor feedback).

Стенд собирает ZIP с дампом HWiNFO и картой слотов, когда часть обязательных
датчиков не нашлась. Здесь: приём ZIP от EXE (по ingest-токену), хранение в S3
и выдача списка в админку.

Спека: SENSOR_FEEDBACK_UPLOAD.md
"""
import base64
import json
import os
import uuid

TABLE = None  # заполняется из index.py при импорте (schema-aware)

# Ограничение на размер архива: у облачной функции лимит на тело запроса,
# больший ZIP стенд оставляет у себя локально.
MAX_ZIP_BYTES = 9 * 1024 * 1024

COLS = ("id, stand_name, order_number, profile_name, app_version, hwinfo_active, "
        "slots_ok, slots_missing, slots_na, missing_labels, note, file_name, "
        "file_url, file_size, is_resolved, exported_at, created_at")


def _row(r):
    labels = r[9]
    if isinstance(labels, str):
        try:
            labels = json.loads(labels)
        except Exception:
            labels = []
    return {
        "id": r[0], "stand_name": r[1] or "", "order_number": r[2] or "",
        "profile_name": r[3] or "", "app_version": r[4] or "",
        "hwinfo_active": bool(r[5]),
        "slots_ok": int(r[6] or 0), "slots_missing": int(r[7] or 0),
        "slots_na": int(r[8] or 0),
        "missing_labels": labels or [],
        "note": r[10] or "", "file_name": r[11] or "", "file_url": r[12] or "",
        "file_size": int(r[13] or 0), "is_resolved": bool(r[14]),
        "exported_at": str(r[15]) if r[15] else "", "created_at": str(r[16]),
    }


def receive(cur, conn, body, company_id, esc, ok, err, s3_client):
    """Приём ZIP от стенда: файл в S3, запись в БД. Токен уже проверен."""
    b64 = body.get("file_base64") or ""
    file_name = (body.get("file_name") or "sensor-feedback.zip").strip()[:200]

    url, size = "", 0
    if b64:
        try:
            raw = base64.b64decode(b64)
        except Exception:
            return err("bad base64", 400)
        if len(raw) > MAX_ZIP_BYTES:
            return err("payload_too_large", 413)
        key = f"stress_sensor_feedback/{uuid.uuid4().hex}.zip"
        s3_client().put_object(Bucket="files", Key=key, Body=raw,
                               ContentType="application/zip")
        url = (f"https://cdn.poehali.dev/projects/"
               f"{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}")
        size = len(raw)

    labels = body.get("missing_labels") or []
    if not isinstance(labels, list):
        labels = []
    labels = [str(x)[:120] for x in labels][:100]

    exported = (body.get("exported_at") or "").strip()
    exported_sql = esc(exported) if exported else "NULL"

    cur.execute(
        f"INSERT INTO {TABLE} (stand_name, order_number, profile_name, app_version, "
        f"hwinfo_active, slots_ok, slots_missing, slots_na, missing_labels, note, "
        f"file_name, file_url, file_size, sha256, company_id, exported_at) VALUES ("
        f"{esc(str(body.get('stand_name') or body.get('machine') or '')[:200])}, "
        f"{esc(str(body.get('order_number') or '')[:100])}, "
        f"{esc(str(body.get('profile_name') or body.get('profile') or '')[:200])}, "
        f"{esc(str(body.get('app_version') or '')[:60])}, "
        f"{'TRUE' if body.get('hwinfo_active', True) else 'FALSE'}, "
        f"{int(body.get('slots_ok') or 0)}, {int(body.get('slots_missing') or 0)}, "
        f"{int(body.get('slots_na') or 0)}, "
        f"{esc(json.dumps(labels, ensure_ascii=False))}::jsonb, "
        f"{esc(str(body.get('note') or '')[:1000])}, "
        f"{esc(file_name)}, {esc(url)}, {size}, "
        f"{esc(str(body.get('sha256') or '')[:80])}, "
        f"{int(company_id) if company_id else 'NULL'}, "
        f"{exported_sql}) RETURNING id"
    )
    new_id = cur.fetchone()[0]
    conn.commit()
    return ok({"ok": True, "id": new_id, "url": url})


def list_items(cur, ok, limit=200):
    """Список отчётов для админки (свежие сверху)."""
    cur.execute(f"SELECT {COLS} FROM {TABLE} ORDER BY created_at DESC LIMIT {int(limit)}")
    return ok({"items": [_row(r) for r in cur.fetchall()]})


def set_resolved(cur, conn, item_id, resolved, ok, err):
    """Отметка «разобрано» — чтобы список не копил старые обращения."""
    if not item_id:
        return err("id required", 400)
    cur.execute(f"UPDATE {TABLE} SET is_resolved = {'TRUE' if resolved else 'FALSE'} "
                f"WHERE id = {int(item_id)}")
    conn.commit()
    return ok({"ok": True})


def delete_item(cur, conn, item_id, ok, err):
    """Удаление отчёта вместе со ссылкой на архив."""
    if not item_id:
        return err("id required", 400)
    cur.execute(f"DELETE FROM {TABLE} WHERE id = {int(item_id)}")
    conn.commit()
    return ok({"ok": True})
