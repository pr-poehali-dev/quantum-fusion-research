"""Отправка уведомлений менеджерам в Telegram.

Берёт TELEGRAM_BOT_TOKEN, TELEGRAM_MANAGER_CHAT_ID и TELEGRAM_TASKS_CHAT_ID
из окружения. Никогда не роняет основной поток: при ошибке логирует и
возвращает False.
"""
import os
import urllib.request
import urllib.parse


def _send(chat_id: str, text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token or not chat_id:
        print("TG_NOTIFY: пропуск — нет TELEGRAM_BOT_TOKEN / chat_id")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": "@BeGraphicsPC\n" + text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    last_err = None
    for _ in range(3):  # ретраи на случай сетевого таймаута / холодного старта
        try:
            req = urllib.request.Request(url, data=data)
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp.read()
            return True
        except Exception as e:
            last_err = e
    print(f"TG_NOTIFY: ошибка отправки на chat_id={chat_id} — {last_err}")
    return False


def notify_managers(text: str) -> bool:
    """Уведомления о заказах/заявках — в общий чат менеджеров."""
    return _send(os.environ.get("TELEGRAM_MANAGER_CHAT_ID"), text)


def notify_tasks(text: str) -> bool:
    """Уведомления о задачах/событиях/задержках — в отдельную беседу задач.
    Если TELEGRAM_TASKS_CHAT_ID не задан — падаем обратно на общий чат."""
    chat_id = os.environ.get("TELEGRAM_TASKS_CHAT_ID") or os.environ.get("TELEGRAM_MANAGER_CHAT_ID")
    return _send(chat_id, text)
