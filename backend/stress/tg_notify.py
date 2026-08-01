"""Отправка уведомлений о стресс-тестах в Telegram.

Берёт TELEGRAM_BOT_TOKEN и STRESS_TG_CHAT_ID из окружения.
Никогда не роняет основной поток: при ошибке логирует и возвращает статус.
"""
import os
import json
import urllib.request
import urllib.parse
import urllib.error


def send_stress(text: str) -> dict:
    """Шлёт сообщение в Telegram. Возвращает {ok, error?} с реальным статусом.

    Логирует ответ Telegram (в т.ч. description ошибки) для диагностики.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("STRESS_TG_CHAT_ID")
    if not token or not chat_id:
        print("STRESS_TG: пропуск — нет TELEGRAM_BOT_TOKEN / STRESS_TG_CHAT_ID")
        return {"ok": False, "error": "no_token_or_chat"}
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    last_err = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=data)
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = resp.read().decode("utf-8", "replace")
            payload = json.loads(body) if body else {}
            if payload.get("ok"):
                return {"ok": True}
            # Telegram ответил ok:false — логируем описание и не ретраим (это не сетевой сбой)
            desc = payload.get("description") or body
            print(f"STRESS_TG: Telegram отклонил chat_id={chat_id} — {desc}")
            return {"ok": False, "error": desc}
        except urllib.error.HTTPError as e:
            # 400/403 и т.п. — тело содержит description с причиной
            try:
                err_body = e.read().decode("utf-8", "replace")
            except Exception:
                err_body = str(e)
            try:
                desc = json.loads(err_body).get("description") or err_body
            except Exception:
                desc = err_body
            print(f"STRESS_TG: HTTP {e.code} от Telegram chat_id={chat_id} — {desc}")
            # 4xx не лечится ретраем — выходим сразу
            if 400 <= e.code < 500:
                return {"ok": False, "error": f"http_{e.code}: {desc}"}
            last_err = desc
        except Exception as e:
            last_err = str(e)
            print(f"STRESS_TG: сетевая ошибка (попытка {attempt + 1}/3) chat_id={chat_id} — {e}")
    return {"ok": False, "error": str(last_err)}


def notify_stress(text: str) -> bool:
    """Совместимость: True/False."""
    return bool(send_stress(text).get("ok"))
