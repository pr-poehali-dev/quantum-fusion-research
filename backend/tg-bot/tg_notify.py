"""Отправка уведомлений менеджерам в общий Telegram-чат.

Берёт TELEGRAM_BOT_TOKEN и TELEGRAM_MANAGER_CHAT_ID из окружения.
Никогда не роняет основной поток: при ошибке просто логирует и возвращает False.
В начало каждого сообщения добавляется тег @BeGraphicsPC.
"""
import os
import http.client
import time
import urllib.request
import urllib.parse

NOTIFY_PREFIX = "@BeGraphicsPC"



_tg_conn = None


def _tg_post(path: str, data: bytes, headers: dict):
    """POST в Telegram по переиспользуемому соединению.

    Важно про дубли: таймаут ОТВЕТА не означает, что сообщение не дошло —
    Telegram мог принять его и не успеть ответить. Поэтому повторяем только
    то, что заведомо не доставлено:
      * не удалось установить соединение — сообщение точно не ушло;
      * оборвалось переиспользованное соединение (сервер закрыл его по
        таймауту) — запрос до Telegram тоже не дошёл.
    А вот сбой на СВЕЖЕМ соединении уже после отправки не повторяем никогда:
    именно такой ретрай и слал одно и то же сообщение по несколько раз.
    """
    global _tg_conn
    last_err = None
    for _ in range(5):
        fresh = False
        try:
            if _tg_conn is None:
                c = http.client.HTTPSConnection("api.telegram.org", timeout=1.0)
                c.connect()
                # Соединение поднято — ответ ждём спокойно, без спешки
                c.sock.settimeout(3.0)
                _tg_conn = c
                fresh = True
        except Exception as e:
            last_err = e
            _tg_conn = None
            time.sleep(0.2)
            continue
        try:
            _tg_conn.request("POST", path, data, headers)
            resp = _tg_conn.getresponse()
            raw = resp.read()
            return resp.status, raw
        except Exception as e:
            last_err = e
            try:
                _tg_conn.close()
            except Exception:
                pass
            _tg_conn = None
            if fresh:
                # Запрос мог дойти до Telegram — повтор создаст дубль
                raise
            time.sleep(0.2)
    raise last_err if last_err else RuntimeError("telegram unreachable")


# ── Маршрутизация событий из админки (вкладка «Telegram-бот») ──────────────
SCHEMA_TG = os.environ.get("MAIN_DB_SCHEMA") or "t_p72635010_quantum_fusion_resea"


def _tg_route(event_key: str):
    """Настройки события: включено ли и в какой чат слать.
    Настроек нет или БД недоступна — работаем как раньше (чат по умолчанию)."""
    if not event_key:
        return True, None
    try:
        import psycopg2
        with psycopg2.connect(os.environ["DATABASE_URL"]) as c:
            with c.cursor() as cur:
                cur.execute(
                    f"SELECT enabled, chat_id FROM {SCHEMA_TG}.tg_event_routes "
                    f"WHERE event_key = '" + event_key.replace("'", "''") + "'")
                row = cur.fetchone()
        if not row:
            return True, None
        return bool(row[0]), (str(row[1]) if row[1] is not None else None)
    except Exception as e:
        print(f"TG_ROUTE: {e}")
        return True, None


def _tg_log(event_key, chat_id, ok, error=None, preview=None):
    """Журнал отправок для админки. Никогда не роняет основной поток."""
    try:
        import psycopg2
        def q(v):
            return "NULL" if v is None else "'" + str(v)[:300].replace("'", "''") + "'"
        cid = str(chat_id or "").strip()
        cid_sql = cid if cid.lstrip("-").isdigit() else "NULL"
        with psycopg2.connect(os.environ["DATABASE_URL"]) as c:
            with c.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {SCHEMA_TG}.tg_send_log "
                    f"(event_key, chat_id, status, error, preview) VALUES "
                    f"({q(event_key)}, {cid_sql}, '{'ok' if ok else 'error'}', "
                    f"{q(error)}, {q(preview)})")
            c.commit()
    except Exception as e:
        print(f"TG_LOG: {e}")


def _tg_log_conn(conn, event_key, chat_id, ok, error=None, preview=None):
    """Запись в журнал по уже открытому подключению."""
    try:
        def q(v):
            return "NULL" if v is None else "'" + str(v)[:300].replace("'", "''") + "'"
        cid = str(chat_id or "").strip()
        cid_sql = cid if cid.lstrip("-").isdigit() else "NULL"
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {SCHEMA_TG}.tg_send_log "
                f"(event_key, chat_id, status, error, preview) VALUES "
                f"({q(event_key)}, {cid_sql}, '{'ok' if ok else 'error'}', "
                f"{q(error)}, {q(preview)})")
        conn.commit()
    except Exception as e:
        print(f"TG_LOG: {e}")


def _send_raw(chat_id, text: str, thread_id=None) -> bool:
    """Низкоуровневая отправка в конкретный чат."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = str(chat_id or "").strip()
    if not token or not chat_id:
        print("TG_NOTIFY: пропуск — нет TELEGRAM_BOT_TOKEN / chat_id")
        return False
    fields = {
        "chat_id": chat_id,
        "text": "@BeGraphicsPC\n" + text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }
    if str(thread_id or "").strip().lstrip("-").isdigit():
        fields["message_thread_id"] = str(thread_id)
    data = urllib.parse.urlencode(fields).encode()
    try:
        status, raw = _tg_post(f"/bot{token}/sendMessage", data,
                               {"Content-Type": "application/x-www-form-urlencoded"})
        if status == 200:
            return True
        print(f"TG_NOTIFY: HTTP {status} chat_id={chat_id} {raw[:200]}")
    except Exception as e:
        print(f"TG_NOTIFY: ошибка отправки на chat_id={chat_id} — {e}")
    return False


def _send_routed(default_chat, text: str, event_key: str = None) -> bool:
    """Отправка с учётом настроек админки: событие можно выключить или
    перенаправить в другой чат. Результат пишем в журнал отправок.
    Маршрут и журнал — одно подключение к БД, чтобы не тормозить отправку."""
    conn = None
    enabled, route_chat = True, None
    if event_key:
        try:
            import psycopg2
            conn = psycopg2.connect(os.environ["DATABASE_URL"])
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT enabled, chat_id FROM {SCHEMA_TG}.tg_event_routes "
                    f"WHERE event_key = '" + event_key.replace("'", "''") + "'")
                row = cur.fetchone()
            if row:
                enabled = bool(row[0])
                route_chat = str(row[1]) if row[1] is not None else None
        except Exception as e:
            print(f"TG_ROUTE: {e}")

    try:
        if not enabled:
            print(f"TG_NOTIFY: событие {event_key} выключено в админке")
            return False
        chat_id = route_chat or default_chat
        ok = _send_raw(chat_id, text)
        if conn is not None:
            _tg_log_conn(conn, event_key, chat_id, ok,
                         None if ok else "Telegram не принял сообщение", text)
        return ok
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def notify_managers(text: str, event_key: str = None) -> bool:
    """Заявки, заказы, склад — в рабочий чат менеджеров."""
    return _send_routed(os.environ.get("TELEGRAM_MANAGER_CHAT_ID"), text, event_key)


def notify_tasks(text: str, event_key: str = None) -> bool:
    """Задачи, календарь, задержки — в чат задач (если задан)."""
    default = os.environ.get("TELEGRAM_TASKS_CHAT_ID") or os.environ.get("TELEGRAM_MANAGER_CHAT_ID")
    return _send_routed(default, text, event_key)
