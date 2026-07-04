"""Отправка сводки по мониторингу цен в Telegram.

Берёт TELEGRAM_BOT_TOKEN и чат из PRICE_ALERT_CHAT_ID (если задан),
иначе — TELEGRAM_MANAGER_CHAT_ID. Никогда не роняет основной поток:
при ошибке логирует и возвращает False.
"""
import os
import urllib.request
import urllib.parse


def notify_price(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("PRICE_ALERT_CHAT_ID") or os.environ.get("TELEGRAM_MANAGER_CHAT_ID")
    if not token or not chat_id:
        print("TG_NOTIFY: пропуск — нет TELEGRAM_BOT_TOKEN / чата")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": "@BeGraphicsPC\n" + text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    last_err = None
    for _ in range(3):
        try:
            req = urllib.request.Request(url, data=data)
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp.read()
            return True
        except Exception as e:
            last_err = e
    print(f"TG_NOTIFY: ошибка отправки на chat_id={chat_id} — {last_err}")
    return False
