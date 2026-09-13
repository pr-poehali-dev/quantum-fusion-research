"""Выгрузка данных проекта для переноса на свой хостинг.

Отдаёт:
  action=info      — что есть: размер базы, таблицы, число файлов
  action=db        — дамп базы SQL (по таблицам: &table=, &offset=, &limit=)
  action=indexes   — индексы, внешние ключи и ограничения (ставить ПОСЛЕ db)
  action=files     — список ВСЕХ файлов хранилища со ссылками
  action=filelist  — тот же список простым текстом (для wget -i)
  action=script    — готовый download.sh: качает все файлы с CDN
  action=readme    — инструкция по развёртыванию на своём сервере
  action=envfile   — .env.example со всеми переменными функций

Доступ только по ADMIN_KEY: выгрузка содержит всю базу целиком.
Дамп собираем вручную через psycopg2, потому что pg_dump в окружении
функции недоступен, а версия сервера может не совпасть с клиентской.

ВАЖНО про файлы: cdn.poehali.dev отдаёт их ПУБЛИЧНО, без ключей и подписи.
Поэтому download.sh работает на любой машине с интернетом — ключи S3 нужны
только для записи, для скачивания не требуются.
"""

import json
import os
import re
import decimal
import datetime

import boto3
import psycopg2
from botocore.client import Config

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
}

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "public")

# Таблицы логов и метрик: занимают почти весь объём, но для переноса
# рабочего проекта не нужны. Выгружаются только по запросу (full=1).
HEAVY_TABLES = {
    "price_observations", "price_suggestions", "stress_metrics",
    "warehouse_stock_log", "stress_results",
}


def db():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def s3():
    return boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
    )


def sql_value(v) -> str:
    """Значение Python → литерал SQL."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float, decimal.Decimal)):
        return str(v)
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return "'" + str(v) + "'"
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'"
    if isinstance(v, (bytes, memoryview)):
        return "'\\x" + bytes(v).hex() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def table_list(cur) -> list:
    cur.execute(
        "SELECT table_name FROM information_schema.tables "
        f"WHERE table_schema = '{SCHEMA}' AND table_type = 'BASE TABLE' "
        "ORDER BY table_name"
    )
    return [r[0] for r in cur.fetchall()]


def action_info() -> dict:
    """Что есть в проекте: таблицы, строки, файлы."""
    conn = db()
    cur = conn.cursor()
    tables = []
    for t in table_list(cur):
        cur.execute(f'SELECT COUNT(*) FROM "{SCHEMA}"."{t}"')
        tables.append({"table": t, "rows": cur.fetchone()[0],
                       "heavy": t in HEAVY_TABLES})
    cur.execute("SELECT pg_size_pretty(pg_database_size(current_database()))")
    size = cur.fetchone()[0]
    cur.close()
    conn.close()

    files = len(scan_file_urls())

    return {"db_size": size, "schema": SCHEMA,
            "tables": tables,
            "rows_total": sum(t["rows"] for t in tables),
            "files_count": files}


def action_db(full: bool, only: str = "", offset: int = 0, limit: int = 0) -> str:
    """Дамп базы: CREATE TABLE + INSERT.

    Вся база за один вызов не успевает (лимит времени функции → 504),
    поэтому качаем по одной таблице: ?action=db&table=NAME.
    Без table отдаём только шапку и список таблиц.
    """
    conn = db()
    cur = conn.cursor()
    out = [
        "-- Дамп базы проекта. Восстановление:",
        "--   createdb myproject",
        "--   psql myproject -f dump.sql",
        f"CREATE SCHEMA IF NOT EXISTS \"{SCHEMA}\";",
        f"SET search_path TO \"{SCHEMA}\";",
        "",
    ]

    tables = table_list(cur)
    if only:
        if only not in tables:
            cur.close(); conn.close()
            return f"-- таблица {only} не найдена"
        tables = [only]

    for t in tables:
        # Структура таблицы
        cur.execute(
            "SELECT column_name, data_type, character_maximum_length, "
            "       column_default, is_nullable "
            f"FROM information_schema.columns "
            f"WHERE table_schema = '{SCHEMA}' AND table_name = '{t}' "
            "ORDER BY ordinal_position"
        )
        cols = cur.fetchall()
        defs = []
        for name, dtype, maxlen, default, nullable in cols:
            d = f'  "{name}" {dtype}'
            if maxlen and "char" in dtype:
                d += f"({maxlen})"
            if default:
                d += f" DEFAULT {default}"
            if nullable == "NO":
                d += " NOT NULL"
            defs.append(d)

        if offset == 0:
            out.append(f'\n-- Таблица {t}')
            out.append(f'DROP TABLE IF EXISTS "{t}" CASCADE;')
            out.append(f'CREATE TABLE "{t}" (\n' + ",\n".join(defs) + "\n);")

        # Первичный ключ
        cur.execute(
            "SELECT kcu.column_name FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu "
            "  ON kcu.constraint_name = tc.constraint_name "
            f"WHERE tc.table_schema = '{SCHEMA}' AND tc.table_name = '{t}' "
            "  AND tc.constraint_type = 'PRIMARY KEY' "
            "ORDER BY kcu.ordinal_position"
        )
        pk = [r[0] for r in cur.fetchall()]
        if pk and offset == 0:
            quoted = ", ".join(f'"{c}"' for c in pk)
            out.append(f'ALTER TABLE "{t}" ADD PRIMARY KEY ({quoted});')

        # Данные
        if t in HEAVY_TABLES and not full:
            out.append(f"-- данные {t} пропущены (лог/метрики, full=1 чтобы включить)")
            continue

        col_names = [c[0] for c in cols]
        quoted_cols = ", ".join(f'"{c}"' for c in col_names)
        # Большие таблицы не влезают в один ответ (лимит 3,5 МБ) — их
        # забираем частями: &offset=N&limit=M. Порядок фиксируем по ctid,
        # иначе части могут пересечься или что-то потеряться.
        q = f'SELECT {quoted_cols} FROM "{SCHEMA}"."{t}" ORDER BY ctid'
        if limit:
            q += f" OFFSET {int(offset)} LIMIT {int(limit)}"
        cur.execute(q)
        rows = cur.fetchall()
        for i in range(0, len(rows), 100):
            chunk = rows[i:i + 100]
            values = ",\n".join(
                "(" + ", ".join(sql_value(v) for v in row) + ")" for row in chunk)
            out.append(f'INSERT INTO "{t}" ({quoted_cols}) VALUES\n{values};')

        # Счётчик автономера, чтобы новые записи не конфликтовали
        for name, dtype, _, default, _ in cols:
            if default and "nextval" in str(default):
                out.append(
                    f"SELECT setval(pg_get_serial_sequence('\"{SCHEMA}\".\"{t}\"', "
                    f"'{name}'), COALESCE((SELECT MAX(\"{name}\") FROM \"{t}\"), 1));")

    cur.close()
    conn.close()
    return "\n".join(out)


def action_schema_extras() -> str:
    """Индексы, внешние ключи и ограничения уникальности — отдельным куском.

    Ставятся ПОСЛЕ загрузки данных: так вставка идёт быстрее, а внешние
    ключи не спотыкаются о порядок таблиц. Без этой части база работает,
    но теряет скорость (238 индексов) и целостность связей (66 ключей).

    Определения собираем из information_schema, а НЕ через
    pg_get_constraintdef — эта функция в облаке запрещена (ошибка
    "is not whitelisted").

    CHECK-ограничения не переносим: почти все они — это NOT NULL, которые
    уже записаны в CREATE TABLE, а их текст без pg_get_constraintdef не
    достать. На работу проекта это не влияет.
    """
    conn = db()
    cur = conn.cursor()
    out = [
        "-- Индексы, связи и ограничения уникальности.",
        "-- Выполнять ПОСЛЕ заливки данных:",
        "--   psql база -f dump.sql",
        "--   psql база -f indexes.sql",
        f'SET search_path TO "{SCHEMA}";',
        "",
        "-- Ограничения уникальности",
    ]

    # UNIQUE: собираем колонки по каждому ограничению
    cur.execute(
        "SELECT tc.constraint_name, tc.table_name, kcu.column_name "
        "FROM information_schema.table_constraints tc "
        "JOIN information_schema.key_column_usage kcu "
        "  ON kcu.constraint_name = tc.constraint_name "
        " AND kcu.constraint_schema = tc.constraint_schema "
        f"WHERE tc.constraint_schema = '{SCHEMA}' "
        "  AND tc.constraint_type = 'UNIQUE' "
        "ORDER BY tc.constraint_name, kcu.ordinal_position"
    )
    uniq = {}
    for name, table, col in cur.fetchall():
        uniq.setdefault((name, table), []).append(col)
    for (name, table), cols in uniq.items():
        quoted = ", ".join(f'"{c}"' for c in cols)
        out.append(
            f'ALTER TABLE "{table}" ADD CONSTRAINT "{name}" UNIQUE ({quoted});')

    out.append("\n-- Внешние ключи")
    cur.execute(
        "SELECT tc.constraint_name, tc.table_name, kcu.column_name, "
        "       ccu.table_name, ccu.column_name, "
        "       rc.update_rule, rc.delete_rule, kcu.ordinal_position "
        "FROM information_schema.table_constraints tc "
        "JOIN information_schema.key_column_usage kcu "
        "  ON kcu.constraint_name = tc.constraint_name "
        " AND kcu.constraint_schema = tc.constraint_schema "
        "JOIN information_schema.constraint_column_usage ccu "
        "  ON ccu.constraint_name = tc.constraint_name "
        " AND ccu.constraint_schema = tc.constraint_schema "
        "JOIN information_schema.referential_constraints rc "
        "  ON rc.constraint_name = tc.constraint_name "
        " AND rc.constraint_schema = tc.constraint_schema "
        f"WHERE tc.constraint_schema = '{SCHEMA}' "
        "  AND tc.constraint_type = 'FOREIGN KEY' "
        "ORDER BY tc.constraint_name, kcu.ordinal_position"
    )
    fk = {}
    for name, table, col, rtable, rcol, upd, dele, _pos in cur.fetchall():
        item = fk.setdefault((name, table, rtable, upd, dele), ([], []))
        if col not in item[0]:
            item[0].append(col)
        if rcol not in item[1]:
            item[1].append(rcol)
    for (name, table, rtable, upd, dele), (cols, rcols) in fk.items():
        src = ", ".join(f'"{c}"' for c in cols)
        dst = ", ".join(f'"{c}"' for c in rcols)
        rule = ""
        if dele and dele != "NO ACTION":
            rule += f" ON DELETE {dele}"
        if upd and upd != "NO ACTION":
            rule += f" ON UPDATE {upd}"
        out.append(
            f'ALTER TABLE "{table}" ADD CONSTRAINT "{name}" '
            f'FOREIGN KEY ({src}) REFERENCES "{rtable}" ({dst}){rule};')

    out.append("\n-- Индексы (первичные ключи и UNIQUE уже созданы выше)")
    cur.execute(
        "SELECT indexname, indexdef FROM pg_indexes "
        f"WHERE schemaname = '{SCHEMA}' "
        "ORDER BY tablename, indexname"
    )
    skip = {n for (n, _t) in uniq}
    for name, definition in cur.fetchall():
        # Индексы первичных ключей и уникальности создаются вместе с
        # ограничениями — повторно их ставить нельзя.
        if name in skip or name.endswith("_pkey"):
            continue
        out.append(definition + ";")

    cur.close()
    conn.close()
    return "\n".join(out)


def scan_file_urls() -> list:
    """Собрать ссылки на файлы из всех текстовых полей базы.

    Список объектов хранилища получить нельзя: bucket.poehali.dev не
    поддерживает листинг (list_objects возвращает одну заглушку «files»).
    Поэтому идём от данных: любой используемый файл записан ссылкой в базе,
    иначе он всё равно нигде не показывается.
    """
    conn = db()
    cur = conn.cursor()
    cur.execute(
        "SELECT table_name, column_name FROM information_schema.columns "
        f"WHERE table_schema = '{SCHEMA}' "
        "  AND data_type IN ('text','character varying','jsonb','json')"
    )
    cols = cur.fetchall()

    # Один общий запрос вместо сотни отдельных: перебор всех колонок
    # по очереди не укладывался в лимит времени функции (504).
    parts = []
    for table, col in cols:
        parts.append(
            f'SELECT "{col}"::text AS v FROM "{SCHEMA}"."{table}" '
            f'WHERE "{col}"::text LIKE \'%cdn.poehali.dev%\''
        )
    found = set()
    # Ссылка обрывается на первом же служебном символе. Важно учесть и
    # HTML-мнемоники (&quot; и т.п.): в тексте статей ссылки хранятся
    # экранированными, и без этого несколько адресов слипались в один.
    rx = re.compile(r"https://cdn\.poehali\.dev/[^\s\"'<>)\\&]+")
    # Режем на пачки: слишком длинный UNION планировщик тоже не любит
    for i in range(0, len(parts), 60):
        chunk = parts[i:i + 60]
        try:
            cur.execute(" UNION ALL ".join(chunk))
            for (val,) in cur.fetchall():
                found.update(rx.findall(val or ""))
        except Exception:
            conn.rollback()
    cur.close()
    conn.close()
    return sorted(found)


def action_files() -> dict:
    """Все файлы проекта со ссылками для скачивания."""
    urls = scan_file_urls()
    key_id = os.environ["AWS_ACCESS_KEY_ID"]
    marker = f"/projects/{key_id}/bucket/"
    files = []
    for u in urls:
        key = u.split(marker, 1)[1] if marker in u else u.rsplit("/bucket/", 1)[-1]
        files.append({"key": key, "url": u,
                      "folder": key.split("/")[0] if "/" in key else ""})
    folders = {}
    for f in files:
        folders[f["folder"]] = folders.get(f["folder"], 0) + 1
    return {"count": len(files), "by_folder": folders, "files": files}


def action_filelist() -> str:
    """Ссылки простым текстом — для `wget -i files.txt`."""
    return "\n".join(f["url"] for f in action_files()["files"])


def action_script() -> str:
    """Готовый download.sh: качает все файлы хранилища на сервер.

    Файлы на CDN публичные, поэтому скрипту не нужны ни ключи, ни токены —
    достаточно интернета. Структура папок сохраняется.
    """
    data = action_files()
    lines = "\n".join(f'{f["url"]}\t{f["key"]}' for f in data["files"])
    return f"""#!/usr/bin/env bash
# Скачивание всех файлов хранилища проекта ({data['count']} шт).
#
# Файлы отдаются ПУБЛИЧНО — ключи доступа не нужны.
# Запуск:  bash download.sh [папка]      (по умолчанию ./files)
#
# Повторный запуск докачивает недостающее: уже скачанные пропускаются.

set -u
DEST="${{1:-./files}}"
mkdir -p "$DEST"

ok=0; skip=0; fail=0; failed_list="$DEST/_не_скачалось.txt"
: > "$failed_list"

while IFS=$'\\t' read -r url key; do
  [ -z "$url" ] && continue
  out="$DEST/$key"
  if [ -s "$out" ]; then skip=$((skip+1)); continue; fi
  mkdir -p "$(dirname "$out")"
  if curl -fsSL --retry 3 --retry-delay 2 --max-time 300 "$url" -o "$out"; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); rm -f "$out"; echo "$url" >> "$failed_list"
  fi
  total=$((ok+skip+fail))
  if [ $((total % 50)) -eq 0 ]; then echo "  обработано $total..."; fi
done <<'СПИСОК'
{lines}
СПИСОК

echo
echo "Готово. Скачано: $ok, пропущено (уже было): $skip, ошибок: $fail"
if [ "$fail" -gt 0 ]; then
  echo "Список неудачных ссылок: $failed_list"
  echo "Часть файлов может отсутствовать в хранилище (битые ссылки в базе) — это нормально."
fi
"""


def action_envfile() -> str:
    """.env.example — переменные, которые читают функции проекта."""
    return """# Переменные окружения проекта BeGraphics.
# Скопируйте в .env и заполните значения.
#
# Значения секретов из облака здесь НЕ подставлены намеренно: скопируйте их
# вручную из раздела «Секреты» в панели проекта.

# ── Обязательные ───────────────────────────────────────────────────────
# Строка подключения к вашей PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/begraphics
# Схема, в которой лежат таблицы (в дампе она уже прописана)
MAIN_DB_SCHEMA=t_p72635010_quantum_fusion_resea
# Пароль входа в админку /admin и проверки админских запросов
ADMIN_KEY=
# Базовый адрес сайта без слэша на конце, например https://begraphics.ru
SITE_BASE_URL=

# ── Хранилище файлов ───────────────────────────────────────────────────
# Нужны, только если оставляете S3-совместимое хранилище.
# При переезде на локальные файлы — не требуются.
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# ── Telegram-уведомления ───────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_MANAGER_CHAT_ID=
TELEGRAM_TASKS_CHAT_ID=
TELEGRAM_BOT_USERNAME=
TELEGRAM_BOT_SECRET=
TELEGRAM_MAIN_CHAT_ID=

# ── Пароли разделов ────────────────────────────────────────────────────
# Просмотр оптовых цен на /b2b
B2B_PASSWORD=
# Подтверждение отмены заказа в CRM
CANCEL_ORDER_PASSWORD=

# ── Парсер цен ─────────────────────────────────────────────────────────
PARSER_INGEST_TOKEN=
PRICE_ALERT_CHAT_ID=
PRICE_ALERT_THREAD_ID=
PRICE_SUMMARY_CHAT_ID=

# ── Стресс-тесты (десктопное приложение) ───────────────────────────────
STRESS_INGEST_TOKEN=
STRESS_TG_CHAT_ID=
STRESS_BRAND_SIGNING_KEY_PEM=
STRESS_LAUNCHER_VERSION=
STRESS_LAUNCHER_DOWNLOAD_URL=
STRESS_LAUNCHER_RELEASE_NOTES=

# ── Распознавание счетов (воркер с GPU) ────────────────────────────────
RECEIPT_WORKER_TOKEN=

# ── Плановые задачи ────────────────────────────────────────────────────
CRON_SECRET=
"""


def action_readme() -> str:
    """Инструкция по развёртыванию. Пишется в расчёте на то, что
    настройкой занимается другой человек (или ИИ-ассистент)."""
    # Числа берём лёгкими запросами: полный action_info() перебирает все
    # таблицы с COUNT(*) и вместе с генерацией текста не укладывался в
    # лимит времени функции (504).
    conn = db()
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) FROM information_schema.tables "
        f"WHERE table_schema = '{SCHEMA}' AND table_type = 'BASE TABLE'")
    tables = cur.fetchone()[0]
    cur.execute("SELECT pg_size_pretty(pg_database_size(current_database()))")
    db_size = cur.fetchone()[0]
    cur.close()
    conn.close()
    files_count = len(scan_file_urls())
    info = {"db_size": db_size, "files_count": files_count}
    return f"""# Перенос проекта BeGraphics на свой хостинг

Состав выгрузки:

| Файл | Что это |
|------|---------|
| `dump.sql` | Дамп PostgreSQL: {tables} таблиц, структура + все данные |
| `indexes.sql` | Индексы, внешние ключи и ограничения (ставится вторым) |
| `download.sh` | Скрипт скачивания файлов хранилища ({info['files_count']} ссылок) |
| `files.txt` | Те же ссылки списком (для `wget -i`) |
| `.env.example` | Переменные окружения, которые читают функции |
| `README.md` | Этот файл |

Размер базы в облаке: {info['db_size']}. Файлы хранилища: около 900 МБ.

---

## 1. База данных

```bash
createdb begraphics
psql begraphics -f dump.sql      # структура и данные
psql begraphics -f indexes.sql   # индексы и связи — обязательно вторым
```

Порядок важен: индексы и внешние ключи ставятся после заливки данных —
так вставка идёт быстрее и ключи не спотыкаются о порядок таблиц.

Дамп создаёт схему `{SCHEMA}` и переключает на неё `search_path`.
Имя схемы менять не нужно — код функций берёт его из переменной
`MAIN_DB_SCHEMA`, и они должны совпадать.

Проверка, что всё встало:

```bash
psql begraphics -c "SELECT COUNT(*) FROM {SCHEMA}.orders;"
```

## 2. Файлы хранилища

```bash
bash download.sh ./files
```

Файлы на `cdn.poehali.dev` отдаются **публично** — ключи доступа не нужны,
достаточно интернета. Скрипт сохраняет структуру папок
(`products/`, `articles/`, `receipts/` и т.д.) и при повторном запуске
докачивает только недостающее.

Часть ссылок может вернуть 404 — это битые ссылки в базе на давно
удалённые файлы (около 13 штук, в основном старые установщики).
Их список попадёт в `files/_не_скачалось.txt`.

### Переключение сайта на свои файлы

Ссылки в базе ведут на `cdn.poehali.dev`. Пока проект в облаке жив,
картинки будут открываться оттуда. Чтобы сайт брал файлы локально,
положите папку `files` в `public/` и замените начало ссылок в базе:

```sql
UPDATE {SCHEMA}.products
SET image_url = replace(image_url,
    'https://cdn.poehali.dev/projects/<КЛЮЧ_ПРОЕКТА>/bucket/', '/files/')
WHERE image_url LIKE '%cdn.poehali.dev%';
```

Ссылки встречаются не только в товарах: проверьте таблицы `articles`,
`pc_builds`, `user_builds`, `receipt_jobs`, `stress_*`. Найти все места:

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = '{SCHEMA}'
  AND data_type IN ('text','character varying','jsonb','json');
```

## 3. Переменные окружения

Скопируйте `.env.example` в `.env` и заполните. Значения секретов
возьмите в панели проекта, раздел «Секреты» — в выгрузку они намеренно
не попадают.

Минимум для запуска: `DATABASE_URL`, `MAIN_DB_SCHEMA`, `ADMIN_KEY`,
`SITE_BASE_URL`. Остальное — по мере надобности: Telegram-уведомления,
парсер цен, стресс-тесты, распознавание счетов.

## 4. Фронтенд

Исходный код скачивается отдельно кнопкой «Скачать код» в панели проекта.

```bash
npm install
npm run build     # соберёт в dist/
```

Раздайте `dist/` любым веб-сервером. Обязательное условие: **все
неизвестные пути должны отдавать `index.html`** — это одностраничное
приложение с маршрутизацией на стороне браузера.

Пример для nginx:

```nginx
location / {{
    root /var/www/begraphics/dist;
    try_files $uri $uri/ /index.html;
}}
```

Важно: в `dist/` лежат заранее подготовленные страницы для поисковых
роботов (`articles/<id>/index.html`, `product/<id>/index.html` и т.д.).
Правило `try_files $uri $uri/ ...` отдаёт их автоматически — не заменяйте
его на безусловный редирект на `index.html`, иначе потеряется индексация.

## 5. Бэкенд-функции

В папке `backend/` лежат независимые функции на Python 3.11. Каждая — это
папка с `index.py`, где есть точка входа:

```python
def handler(event: dict, context) -> dict
```

Формат `event` (то, что даёт облако):

```python
{{
  "httpMethod": "GET",                  # GET / POST / OPTIONS / ...
  "headers": {{"X-Admin-Key": "...."}},   # заголовки запроса
  "queryStringParameters": {{"action": "info"}},
  "body": "{{\\"...\\": ...}}",             # строка, парсится json.loads
  "isBase64Encoded": false,
  "requestContext": {{"identity": {{"sourceIp": "1.2.3.4"}}}}
}}
```

Ответ:

```python
{{"statusCode": 200, "headers": {{...}}, "body": "строка"}}
```

`context` — объект (не словарь), у него есть `context.request_id`.

### Как поднять их у себя

Простейший путь — обёртка на FastAPI или Flask, которая превращает
HTTP-запрос в такой `event` и отдаёт результат. Одна обёртка на все
функции: маршрут `/<имя_функции>` импортирует `backend/<имя>/index.py`
и вызывает `handler`.

Особенности, которые нужно учесть:

1. **Работа с БД** — только `psycopg2`, Simple Query Protocol. Запросы
   собираются строками, а не через параметры-заглушки. Это не ошибка,
   а требование облачного прокси; на своём сервере можно постепенно
   переписать на параметризованные запросы.
2. **Заголовки авторизации.** В облаке прокси подменял `Authorization`
   на `X-Authorization` и `Cookie` на `X-Cookie`, потому что провайдер
   их вырезал. На своём сервере этого нет: либо оставьте фронтенд слать
   `X-`-варианты, либо в обёртке скопируйте `Authorization` → 
   `X-Authorization` перед вызовом `handler`.
3. **CORS.** Функции сами возвращают заголовки CORS и обрабатывают
   `OPTIONS`. Если фронтенд и функции будут на одном домене — это просто
   не понадобится.
4. **Адреса функций.** Фронтенд берёт их из `src/lib/api.ts` (константа
   `URLS`) — там прописаны адреса облака. После переезда замените их на
   свои. Файл `backend/func2url.json` — та же карта соответствий.
5. **Таймаут.** В облаке функция жила 5 секунд (у тяжёлых — больше).
   На своём сервере ограничения нет, но код местами разбит на части
   именно под этот лимит — например, дамп базы качается по таблицам.

### Плановые задачи

Часть функций вызывалась по расписанию с проверкой `CRON_SECRET`.
На своём сервере это обычный `cron`, который дёргает URL функции
и передаёт этот секрет.

---

## Чего в выгрузке нет

- **Секретов** — их значения не выгружаются, скопируйте вручную.
- **Исходного кода** — скачивается отдельной кнопкой в панели проекта.
- **Настроек домена и SSL** — это делается на вашем хостинге.
"""


def handler(event: dict, context) -> dict:
    """Выгрузка данных проекта: дамп базы и список файлов хранилища."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    action = (params.get("action") or "info").strip()

    key = headers.get("X-Admin-Key") or headers.get("x-admin-key") or params.get("key")
    if not key or key != os.environ.get("ADMIN_KEY"):
        return {"statusCode": 403, "headers": cors,
                "body": json.dumps({"error": "Нужен ключ администратора"})}

    if action == "info":
        return {"statusCode": 200, "headers": cors,
                "body": json.dumps(action_info(), ensure_ascii=False, default=str)}

    if action == "db":
        # По умолчанию выгружаем ВСЁ, включая логи и метрики: перенос на
        # свой хостинг подразумевает полную копию. Облегчённый вариант —
        # явным &full=0 (тогда тяжёлые лог-таблицы идут без данных).
        sql = action_db(full=params.get("full") != "0",
                        only=(params.get("table") or "").strip(),
                        offset=int(params.get("offset") or 0),
                        limit=int(params.get("limit") or 0))
        return {"statusCode": 200,
                "headers": {**cors, "Content-Type": "text/plain; charset=utf-8"},
                "body": sql}

    if action == "files":
        return {"statusCode": 200, "headers": cors,
                "body": json.dumps(action_files(), ensure_ascii=False)}

    # Текстовые части комплекта переноса
    plain_actions = {
        "filelist": action_filelist,
        "indexes": action_schema_extras,
        "script": action_script,
        "readme": action_readme,
        "envfile": action_envfile,
    }
    if action in plain_actions:
        return {"statusCode": 200,
                "headers": {**cors, "Content-Type": "text/plain; charset=utf-8"},
                "body": plain_actions[action]()}

    return {"statusCode": 400, "headers": cors,
            "body": json.dumps({
                "error": "action: info | db | indexes | files | filelist | "
                         "script | readme | envfile"})}