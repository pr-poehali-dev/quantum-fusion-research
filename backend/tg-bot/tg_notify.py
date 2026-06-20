"""Отправка уведомлений менеджерам в общий Telegram-чат.

Берёт TELEGRAM_BOT_TOKEN и TELEGRAM_MANAGER_CHAT_ID из окружения.
Никогда не роняет основной поток: при ошибке просто логирует и возвращает False.
В начало каждого сообщения добавляется тег @BeGraphicsPC.
"""
import os
import urllib.request
import urllib.parse

NOTIFY_PREFIX = "@BeGraphicsPC"


def notify_managers(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_MANAGER_CHAT_ID")
    if not token or not chat_id:
        print("TG_NOTIFY: пропуск — нет TELEGRAM_BOT_TOKEN / TELEGRAM_MANAGER_CHAT_ID")
        return False
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        data = urllib.parse.urlencode({
            "chat_id": chat_id,
            "text": f"{NOTIFY_PREFIX}\n{text}",
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
        }).encode()
        req = urllib.request.Request(url, data=data)
        with urllib.request.urlopen(req, timeout=8) as resp:
            resp.read()
        return True
    except Exception as e:
        print(f"TG_NOTIFY: ошибка отправки на chat_id={chat_id} — {e}")
        return False