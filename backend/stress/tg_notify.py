"""Отправка уведомлений о стресс-тестах в Telegram.

Берёт TELEGRAM_BOT_TOKEN и STRESS_TG_CHAT_ID из окружения.
Никогда не роняет основной поток: при ошибке логирует и возвращает False.
"""
import os
import urllib.request
import urllib.parse


def notify_stress(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("STRESS_TG_CHAT_ID")
    if not token or not chat_id:
        print("STRESS_TG: пропуск — нет TELEGRAM_BOT_TOKEN / STRESS_TG_CHAT_ID")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
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
    print(f"STRESS_TG: ошибка отправки на chat_id={chat_id} — {last_err}")
    return False
