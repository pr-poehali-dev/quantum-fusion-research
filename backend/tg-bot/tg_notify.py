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
    TLS-хендшейк из облака дорогой и иногда виснет, поэтому держим один
    открытый канал и при сбое переоткрываем его, а не ждём долгий таймаут."""
    global _tg_conn
    last_err = None
    for _ in range(6):
        try:
            if _tg_conn is None:
                _tg_conn = http.client.HTTPSConnection("api.telegram.org", timeout=0.6)
            _tg_conn.request("POST", path, data, headers)
            resp = _tg_conn.getresponse()
            raw = resp.read()
            return resp.status, raw
        except Exception as e:
            last_err = e
            try:
                if _tg_conn is not None:
                    _tg_conn.close()
            except Exception:
                pass
            _tg_conn = None
            time.sleep(0.25)
    raise last_err if last_err else RuntimeError("telegram unreachable")


def notify_managers(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_MANAGER_CHAT_ID")
    if not token or not chat_id:
        print("TG_NOTIFY: пропуск — нет TELEGRAM_BOT_TOKEN / TELEGRAM_MANAGER_CHAT_ID")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": f"{NOTIFY_PREFIX}\n{text}",
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
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