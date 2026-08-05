"""Админский API Telegram-бота: чаты, маршруты событий, журнал отправок.

Всё, что видно во вкладке «Telegram-бот» админки, обслуживается здесь.
Доступ — только по админскому ключу (заголовок X-Admin-Token).
"""
import os
import json


def _esc(v):
    """Экранирование строки для Simple Query (параметров тут нет)."""
    return str(v).replace("'", "''")


def _row_chat(r):
    return {
        "id": r[0], "chat_id": r[1], "title": r[2], "thread_id": r[3],
        "kind": r[4], "is_active": r[5], "note": r[6],
        "created_at": r[7].isoformat() if r[7] else None,
    }


def list_chats(cur, schema):
    cur.execute(
        f"""SELECT id, chat_id, title, thread_id, kind, is_active, note, created_at
            FROM {schema}.tg_chats ORDER BY is_active DESC, id""")
    return [_row_chat(r) for r in cur.fetchall()]


def save_chat(cur, conn, schema, body):
    """Добавить или изменить чат."""
    cid = body.get("chat_id")
    title = (body.get("title") or "").strip()
    if cid in (None, "") or not title:
        return {"error": "chat_id и title обязательны"}, 400
    try:
        cid = int(cid)
    except (TypeError, ValueError):
        return {"error": "chat_id должен быть числом"}, 400

    thread = body.get("thread_id")
    thread_sql = str(int(thread)) if str(thread or "").strip().lstrip("-").isdigit() else "NULL"
    kind = (body.get("kind") or "group").strip()[:20]
    note = (body.get("note") or "").strip()
    active = "TRUE" if body.get("is_active", True) else "FALSE"
    rid = body.get("id")

    if rid:
        cur.execute(
            f"""UPDATE {schema}.tg_chats
                SET chat_id={cid}, title='{_esc(title[:200])}', thread_id={thread_sql},
                    kind='{_esc(kind)}', is_active={active}, note='{_esc(note)}'
                WHERE id={int(rid)}""")
    else:
        cur.execute(
            f"""INSERT INTO {schema}.tg_chats (chat_id, title, thread_id, kind, is_active, note)
                VALUES ({cid}, '{_esc(title[:200])}', {thread_sql}, '{_esc(kind)}', {active}, '{_esc(note)}')
                ON CONFLICT (chat_id) DO UPDATE
                SET title=EXCLUDED.title, thread_id=EXCLUDED.thread_id,
                    kind=EXCLUDED.kind, is_active=EXCLUDED.is_active, note=EXCLUDED.note""")
    conn.commit()
    return {"ok": True, "chats": list_chats(cur, schema)}, 200


def delete_chat(cur, conn, schema, body):
    rid = body.get("id")
    if not rid:
        return {"error": "id обязателен"}, 400
    cur.execute(f"SELECT chat_id FROM {schema}.tg_chats WHERE id={int(rid)}")
    row = cur.fetchone()
    if row:
        # События, смотревшие на этот чат, возвращаем на чат по умолчанию
        cur.execute(f"UPDATE {schema}.tg_event_routes SET chat_id=NULL WHERE chat_id={row[0]}")
    cur.execute(f"DELETE FROM {schema}.tg_chats WHERE id={int(rid)}")
    conn.commit()
    return {"ok": True, "chats": list_chats(cur, schema)}, 200


def list_routes(cur, schema):
    cur.execute(
        f"""SELECT r.event_key, r.title, r.category, r.enabled, r.chat_id, c.title
            FROM {schema}.tg_event_routes r
            LEFT JOIN {schema}.tg_chats c ON c.chat_id = r.chat_id
            ORDER BY r.category, r.title""")
    return [{
        "event_key": r[0], "title": r[1], "category": r[2],
        "enabled": r[3], "chat_id": r[4], "chat_title": r[5],
    } for r in cur.fetchall()]


def save_route(cur, conn, schema, body):
    """Включить/выключить событие и задать чат-получатель."""
    key = (body.get("event_key") or "").strip()
    if not key:
        return {"error": "event_key обязателен"}, 400
    sets = []
    if "enabled" in body:
        sets.append(f"enabled={'TRUE' if body['enabled'] else 'FALSE'}")
    if "chat_id" in body:
        cid = body.get("chat_id")
        sets.append(f"chat_id={int(cid)}" if str(cid or "").strip().lstrip("-").isdigit() else "chat_id=NULL")
    if not sets:
        return {"error": "нечего сохранять"}, 400
    cur.execute(
        f"""UPDATE {schema}.tg_event_routes
            SET {', '.join(sets)}, updated_at=now()
            WHERE event_key='{_esc(key)}'""")
    conn.commit()
    return {"ok": True, "routes": list_routes(cur, schema)}, 200


def list_log(cur, schema, params):
    limit = min(int(params.get("limit") or 100), 500)
    where = []
    if params.get("event_key"):
        where.append(f"l.event_key='{_esc(params['event_key'])}'")
    if params.get("status"):
        where.append(f"l.status='{_esc(params['status'])}'")
    w = f"WHERE {' AND '.join(where)}" if where else ""
    cur.execute(
        f"""SELECT l.id, l.event_key, l.chat_id, l.status, l.error, l.preview,
                   l.duration_ms, l.created_at, c.title, r.title
            FROM {schema}.tg_send_log l
            LEFT JOIN {schema}.tg_chats c ON c.chat_id = l.chat_id
            LEFT JOIN {schema}.tg_event_routes r ON r.event_key = l.event_key
            {w} ORDER BY l.id DESC LIMIT {limit}""")
    return [{
        "id": r[0], "event_key": r[1], "chat_id": r[2], "status": r[3],
        "error": r[4], "preview": r[5], "duration_ms": r[6],
        "created_at": r[7].isoformat() if r[7] else None,
        "chat_title": r[8], "event_title": r[9],
    } for r in cur.fetchall()]


def clear_log(cur, conn, schema):
    cur.execute(f"DELETE FROM {schema}.tg_send_log")
    conn.commit()
    return {"ok": True}, 200


def stats(cur, schema):
    """Сводка за сутки: сколько ушло, сколько сбоев."""
    cur.execute(
        f"""SELECT status, COUNT(*) FROM {schema}.tg_send_log
            WHERE created_at > now() - interval '24 hours' GROUP BY status""")
    by = {r[0]: r[1] for r in cur.fetchall()}
    cur.execute(f"SELECT COUNT(*) FROM {schema}.tg_chats WHERE is_active")
    chats = cur.fetchone()[0]
    cur.execute(f"SELECT COUNT(*) FROM {schema}.tg_event_routes WHERE enabled")
    events = cur.fetchone()[0]
    return {
        "sent_24h": by.get("ok", 0),
        "errors_24h": by.get("error", 0),
        "skipped_24h": by.get("skipped", 0),
        "active_chats": chats,
        "enabled_events": events,
    }


DEFAULT_TITLES = {
    "manager": ("Рабочий чат менеджеров", "Заявки, заказы, склад"),
    "tasks": ("Задачи и календарь", "Напоминания, планы на день"),
    "price": ("Цены поставщиков", "Изменения закупочных цен"),
    "stress": ("Стресс-тесты", "Отчёты тестирования сборок"),
}


def seed_chats_from_env(cur, conn, schema):
    """Первый вход в админку: подтянуть чаты, заданные секретами,
    чтобы список не был пустым и всё сразу работало как раньше."""
    added = 0
    for key, cid in env_defaults().items():
        cid = str(cid or "").strip()
        if not cid.lstrip("-").isdigit():
            continue
        title, note = DEFAULT_TITLES.get(key, (f"Чат {key}", ""))
        cur.execute(
            f"""INSERT INTO {schema}.tg_chats (chat_id, title, kind, note)
                VALUES ({int(cid)}, '{_esc(title)}', 'group', '{_esc(note)}')
                ON CONFLICT (chat_id) DO NOTHING""")
        added += cur.rowcount or 0
    if added:
        conn.commit()
    return added


def env_defaults():
    """Чаты, заданные секретами — их показываем как «по умолчанию»."""
    return {
        "manager": os.environ.get("TELEGRAM_MANAGER_CHAT_ID") or "",
        "tasks": os.environ.get("TELEGRAM_TASKS_CHAT_ID") or "",
        "price": os.environ.get("PRICE_ALERT_CHAT_ID") or "",
        "stress": os.environ.get("STRESS_TG_CHAT_ID") or "",
    }