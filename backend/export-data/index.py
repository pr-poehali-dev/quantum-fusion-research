"""Выгрузка данных проекта для переноса на локальную машину.

Отдаёт три вещи:
  action=info    — что вообще есть: размер базы, таблицы, число файлов
  action=db      — дамп базы одним SQL-файлом (схема + данные)
  action=files   — список ВСЕХ файлов хранилища со ссылками для скачивания

Доступ только по ADMIN_KEY: выгрузка содержит всю базу целиком.
Дамп собираем вручную через psycopg2, потому что pg_dump в окружении
функции недоступен, а версия сервера может не совпасть с клиентской.
"""

import json
import os
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

    cli = s3()
    files, total_bytes = 0, 0
    token = None
    while True:
        kw = {"Bucket": "files", "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        r = cli.list_objects_v2(**kw)
        for o in r.get("Contents", []):
            files += 1
            total_bytes += o["Size"]
        if not r.get("IsTruncated"):
            break
        token = r.get("NextContinuationToken")

    return {"db_size": size, "schema": SCHEMA,
            "tables": tables,
            "rows_total": sum(t["rows"] for t in tables),
            "files_count": files,
            "files_size_mb": round(total_bytes / 1024 / 1024, 1)}


def action_db(full: bool) -> str:
    """Дамп базы: CREATE TABLE + INSERT. Возвращает готовый SQL-текст."""
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

    for t in table_list(cur):
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
        if pk:
            quoted = ", ".join(f'"{c}"' for c in pk)
            out.append(f'ALTER TABLE "{t}" ADD PRIMARY KEY ({quoted});')

        # Данные
        if t in HEAVY_TABLES and not full:
            out.append(f"-- данные {t} пропущены (лог/метрики, full=1 чтобы включить)")
            continue

        col_names = [c[0] for c in cols]
        quoted_cols = ", ".join(f'"{c}"' for c in col_names)
        cur.execute(f'SELECT {quoted_cols} FROM "{SCHEMA}"."{t}"')
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


def action_files() -> dict:
    """Все файлы хранилища со ссылками для скачивания."""
    cli = s3()
    key_id = os.environ["AWS_ACCESS_KEY_ID"]
    items, token = [], None
    while True:
        kw = {"Bucket": "files", "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        r = cli.list_objects_v2(**kw)
        for o in r.get("Contents", []):
            items.append({
                "key": o["Key"],
                "size": o["Size"],
                "url": f"https://cdn.poehali.dev/projects/{key_id}/bucket/{o['Key']}",
            })
        if not r.get("IsTruncated"):
            break
        token = r.get("NextContinuationToken")
    return {"count": len(items),
            "total_mb": round(sum(i["size"] for i in items) / 1024 / 1024, 1),
            "files": items}


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
        sql = action_db(full=params.get("full") == "1")
        return {"statusCode": 200,
                "headers": {**cors, "Content-Type": "text/plain; charset=utf-8"},
                "body": sql}

    if action == "files":
        return {"statusCode": 200, "headers": cors,
                "body": json.dumps(action_files(), ensure_ascii=False)}

    return {"statusCode": 400, "headers": cors,
            "body": json.dumps({"error": "action: info | db | files"})}
