# ТЗ для Cursor: сверка price-monitor с облаком (устранить расхождения)

> Задача Cursor: привести ЛОКАЛЬНЫЙ код `backend/price-monitor/` в соответствие
> с тем, что РЕАЛЬНО развёрнуто в облаке poehali.dev, и добавить отправку в ветку
> форума Telegram (thread_id). Ниже — фактическое состояние облака на момент сверки.
> Не выдумывать структуры из старого ТЗ — сверяться с этим документом.

Дата сверки: 2026-07-06
Функция: `backend/price-monitor/`
URL: `https://functions.poehali.dev/505d6a55-4cdb-4d30-9e46-3292ad49b4ab`

---

## 0. Главный вывод (прочитать первым)

Старое ТЗ («секреты и деплой — парсер цен») описывает БОЛЕЕ РАННЮЮ версию, чем
та, что в облаке. НЕ делать по нему:
- ❌ НЕ применять миграцию `V0156__price_parser_session.sql` — её в проекте НЕТ и
  она НЕ нужна. Счётчики прогона уже считаются через таблицу `price_run_stats`.
- ❌ НЕ создавать таблицы `price_parser_session` / `price_parser_counters`.
- ❌ НЕ искать функцию `notify_price_alert()` — её нет. Есть `notify_price()` и
  `notify_main()` (см. §2).
- ❌ НЕ пересоздавать секрет `PRICE_ALERT_CHAT_ID` — он УЖЕ существует в проекте.

Реально осталось сделать ОДНО: научить бота писать в ВЕТКУ форума (thread_id 2158)
через новый секрет `PRICE_ALERT_THREAD_ID` + правку `tg_notify.py`.

---

## 1. Секреты в облаке (фактическое состояние)

Существуют и заданы (НЕ трогать имена/значения):
```
TELEGRAM_BOT_TOKEN
TELEGRAM_MANAGER_CHAT_ID
PARSER_INGEST_TOKEN
DATABASE_URL
ADMIN_KEY
MAIN_DB_SCHEMA               # = t_p72635010_quantum_fusion_resea
PRICE_ALERT_CHAT_ID          # ⚠️ УЖЕ существует, значение должно быть -1003007397543
```
Добавляется сейчас (заявка создана, пользователь вписывает значение):
```
PRICE_ALERT_THREAD_ID = 2158     # ID ветки форума t.me/c/3007397543/2158
```

Cursor: в коде НЕ хардкодить значения секретов, только читать `os.environ`.

---

## 2. Фактическая структура кода в облаке (эталон для сверки)

### 2.1. `backend/price-monitor/index.py`
Проверить, что локально совпадает:
- Импорт из tg_notify именно такой:
  ```python
  from tg_notify import notify_price, notify_main
  ```
  (с fallback-заглушками в try/except). НЕ `notify_price_alert`.
- Константы: `SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p72635010_quantum_fusion_resea")`,
  `ADMIN_PASSWORD`, `ROUND_STEP = 250`, `MARKUP = 0.93`, `MATCH_THRESHOLD = 0.45`.
- Контур парсера: авторизация по заголовку `X-Parser-Token` == `PARSER_INGEST_TOKEN`.
  Действия `ingest` (по умолчанию) и `finish`.
- `finish` вызывает `_finish(cur)`, который собирает счётчики из `price_run_stats`
  (НЕ из price_parser_session/counters).
- Контур админа: `X-Session-Id` (роль admin) или `X-Admin-Token` == `ADMIN_KEY`.
  Действия: `list`, `match`, `link_product`, `accept`, `reject`, `reject_all`,
  `accept_all`.
- CORS-заголовки, обработка OPTIONS первым — присутствуют.

### 2.2. `backend/price-monitor/tg_notify.py` (ЭТАЛОН — текущее облако)
```python
"""Отправка сводки по мониторингу цен в Telegram."""
import os
import urllib.request
import urllib.parse


def _send(text: str, chat_id: str, prefix: str = "@BeGraphicsPC\n") -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token or not chat_id:
        print("TG_NOTIFY: пропуск — нет TELEGRAM_BOT_TOKEN / чата")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": prefix + text,
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


def notify_price(text: str) -> bool:
    chat_id = os.environ.get("PRICE_ALERT_CHAT_ID") or os.environ.get("TELEGRAM_MANAGER_CHAT_ID")
    return _send(text, chat_id or "")


def notify_main(text: str) -> bool:
    """Итоговая сводка парсера в основной рабочий чат."""
    chat_id = (os.environ.get("PRICE_SUMMARY_CHAT_ID")
               or os.environ.get("TELEGRAM_MAIN_CHAT_ID")
               or "-1002809968150")
    return _send(text, chat_id)
```

Если локальная версия tg_notify.py ОТЛИЧАЕТСЯ от этого — синхронизировать с эталоном
ПЕРЕД внесением правки из §3 (иначе перезапишешь облако старой версией).

---

## 3. Единственная правка, которую нужно внести (thread_id)

Цель: `notify_price()` должна отправлять сообщение в ВЕТКУ форума 2158, если задан
`PRICE_ALERT_THREAD_ID`. `notify_main()` (рабочий чат менеджеров) — НЕ ТРОГАТЬ.

### 3.1. Правка `_send` — принять и передать `message_thread_id`
```python
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
        payload["message_thread_id"] = thread_id   # ветка форума (topic)
    data = urllib.parse.urlencode(payload).encode()
    # ... остальное без изменений (retry x3)
```

### 3.2. Правка `notify_price` — прокинуть thread_id
```python
def notify_price(text: str) -> bool:
    chat_id = os.environ.get("PRICE_ALERT_CHAT_ID") or os.environ.get("TELEGRAM_MANAGER_CHAT_ID")
    thread_id = os.environ.get("PRICE_ALERT_THREAD_ID", "")
    return _send(text, chat_id or "", thread_id=thread_id)
```

### 3.3. `notify_main` — БЕЗ ИЗМЕНЕНИЙ
Рабочий чат менеджеров форумом не является, thread_id туда НЕ передавать.

Важно: `message_thread_id` работает ТОЛЬКО если целевой чат — супергруппа с
включёнными Топиками (форумом) и бот имеет право писать в этот топик. Если
`PRICE_ALERT_THREAD_ID` не задан — поведение как раньше (в общий чат).

---

## 4. Чеклист для Cursor (что перепроверить, чтобы не было расхождений)

- [ ] `index.py`: импорт `from tg_notify import notify_price, notify_main` (НЕ notify_price_alert).
- [ ] `index.py`: `finish` использует `price_run_stats`, НЕ price_parser_session/counters.
- [ ] `tg_notify.py` локально идентичен эталону §2.2 ДО внесения правки §3.
- [ ] В проекте НЕТ файла `db_migrations/V0156__price_parser_session.sql` и он НЕ создаётся.
- [ ] Внесена правка §3 (message_thread_id в `_send` + `notify_price`).
- [ ] `notify_main` НЕ изменён.
- [ ] Нигде не захардкожены значения секретов (chat_id/токены) кроме дефолта
      рабочего чата `-1002809968150`, который уже был в облаке.
- [ ] `requirements.txt` не содержит лишних зависимостей (используется только
      стандартная библиотека + psycopg2).
- [ ] `tests.json` присутствует; каждый тест имеет поле `method`.
- [ ] Ничего не менять в других функциях (tg-bot, quiz, builds и т.д.).

---

## 5. Как проверить после деплоя (ручной finish)
```bash
curl -X POST "https://functions.poehali.dev/505d6a55-4cdb-4d30-9e46-3292ad49b4ab?action=finish" \
  -H "Content-Type: application/json" \
  -H "X-Parser-Token: <PARSER_INGEST_TOKEN>" \
  -d '{"action":"finish"}'
```
Ожидание: `{"ok": true, "sent": true/false, "sources": N}`.
- В рабочий чат менеджеров — краткая сводка (как раньше).
- В ветку 2158 группы -1003007397543 — полный список (если были изменения и
  бот имеет право писать в топик).

Если в ветку не пришло:
| Симптом | Проверить |
|---|---|
| В рабочий чат пришло, в ветку нет | Задан ли PRICE_ALERT_THREAD_ID? Задеплоен ли новый код? |
| Ошибка Telegram в логах | Бот в группе -1003007397543? Право писать в topic 2158? Форум включён? |
| "message thread not found" | Верный ли thread_id (2158)? Топик не удалён? |

---

## 6. Границы задачи (что НЕ делать)
- НЕ применять миграции. НЕ менять схему БД.
- НЕ трогать локальный парсер на ПК заказчика.
- НЕ менять/переименовывать существующие секреты.
- НЕ править `notify_main` и рабочий чат менеджеров.
- НЕ трогать другие backend-функции.
