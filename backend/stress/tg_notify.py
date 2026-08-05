"""Отправка уведомлений о стресс-тестах в Telegram.

Берёт TELEGRAM_BOT_TOKEN и STRESS_TG_CHAT_ID из окружения.
Никогда не роняет основной поток: при ошибке логирует и возвращает статус.
"""
import os
import http.client
import time
import json
import urllib.request
import urllib.parse
import urllib.error



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


def send_stress(text: str, chat_id: str = None) -> dict:
    """Шлёт сообщение в Telegram. Возвращает {ok, error?} с реальным статусом.

    chat_id=None — общий админский чат из STRESS_TG_CHAT_ID (прежнее поведение).
    chat_id задан — шлём в этот чат (чаты партнёров из stress_notify_chats).

    Логирует ответ Telegram (в т.ч. description ошибки) для диагностики.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if chat_id is None:
        chat_id = os.environ.get("STRESS_TG_CHAT_ID")
    chat_id = str(chat_id or "").strip()
    if not token or not chat_id:
        print("STRESS_TG: пропуск — нет TELEGRAM_BOT_TOKEN / chat_id")
        return {"ok": False, "error": "no_token_or_chat"}
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    last_err = None
    try:
        status, raw = _tg_post(
            url.split("api.telegram.org", 1)[1], data,
            {"Content-Type": "application/x-www-form-urlencoded"})
        body = raw.decode("utf-8", "replace")
        payload = json.loads(body) if body else {}
        if payload.get("ok"):
            return {"ok": True}
        desc = payload.get("description") or body
        print(f"STRESS_TG: Telegram отклонил chat_id={chat_id} — {desc}")
        return {"ok": False, "error": desc if status == 200 else f"http_{status}: {desc}"}
    except Exception as e:
        last_err = str(e)
        print(f"STRESS_TG: сетевая ошибка chat_id={chat_id} — {e}")
    return {"ok": False, "error": str(last_err)}


def notify_stress(text: str) -> bool:
    """Совместимость: True/False."""
    return bool(send_stress(text).get("ok"))