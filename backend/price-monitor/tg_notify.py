"""Отправка сводки по мониторингу цен в Telegram.

Берёт TELEGRAM_BOT_TOKEN и чат из PRICE_ALERT_CHAT_ID (если задан),
иначе — TELEGRAM_MANAGER_CHAT_ID. Никогда не роняет основной поток:
при ошибке логирует и возвращает False.
"""
import os
import http.client
import time
import urllib.request
import urllib.parse



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


def _send(text: str, chat_id: str, prefix: str = "@BeGraphicsPC\n",
          thread_id: str = "") -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token or not chat_id:
        print("TG_NOTIFY: пропуск — нет TELEGRAM_BOT_TOKEN / чата")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": prefix + text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }
    if thread_id:
        payload["message_thread_id"] = thread_id
    data = urllib.parse.urlencode(payload).encode()
    try:
        status, _raw = _tg_post(
            url.split("api.telegram.org", 1)[1], data,
            {"Content-Type": "application/x-www-form-urlencoded"})
        if status == 200:
            return True
        last_err = f"HTTP {status}"
    except Exception as e:
        last_err = e
    print(f"TG_NOTIFY: ошибка отправки на chat_id={chat_id} — {last_err}")
    return False


def notify_price(text: str) -> bool:
    """Изменение цен. Событие можно выключить/перенаправить в админке."""
    enabled, route_chat = _tg_route("price_change")
    if not enabled:
        print("TG_NOTIFY: событие price_change выключено в админке")
        return False
    chat_id = route_chat or os.environ.get("PRICE_ALERT_CHAT_ID") or os.environ.get("TELEGRAM_MANAGER_CHAT_ID")
    thread_id = "" if route_chat else os.environ.get("PRICE_ALERT_THREAD_ID", "")
    ok = _send(text, chat_id or "", thread_id=thread_id)
    _tg_log("price_change", chat_id, ok, None if ok else "Telegram не принял сообщение", text)
    return ok


def notify_main(text: str) -> bool:
    """Итоговая сводка парсера в основной рабочий чат."""
    chat_id = (os.environ.get("PRICE_SUMMARY_CHAT_ID")
               or os.environ.get("TELEGRAM_MAIN_CHAT_ID")
               or "-1002809968150")
    return _send(text, chat_id)