import json
import os
import hashlib
import hmac
import random
import string
import psycopg2
from datetime import datetime, timedelta


SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p72635010_quantum_fusion_resea")


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def esc(val):
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def gen_code():
    return "".join(random.choices(string.digits, k=6))


def handler(event: dict, context) -> dict:
    """
    Привязка Telegram аккаунта к профилю.
    GET ?action=generate — генерация кода привязки (требует X-Session-Id)
    POST ?action=confirm — подтверждение кода ботом (требует bot_secret + tg_data)
    GET ?action=check — проверка статуса привязки по session_id
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    action = params.get("action", "")
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")

    conn = get_conn()
    cur = conn.cursor()

    try:
        # --- Генерация кода привязки ---
        if action == "generate" and method == "GET":
            if not session_id:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}

            cur.execute(f"SELECT user_id FROM {SCHEMA}.user_sessions WHERE id={esc(session_id)} AND expires_at > NOW()")
            row = cur.fetchone()
            if not row:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия не найдена"})}
            user_id = row[0]

            # Проверяем — вдруг уже привязан
            cur.execute(f"SELECT telegram_id FROM {SCHEMA}.users WHERE id={user_id}")
            user = cur.fetchone()
            if user and user[0]:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Telegram уже привязан"})}

            # Деактивируем старые коды
            cur.execute(f"UPDATE {SCHEMA}.telegram_link_codes SET used=TRUE WHERE user_id={user_id} AND used=FALSE")

            code = gen_code()
            expires = (datetime.now() + timedelta(minutes=10)).isoformat()
            cur.execute(
                f"INSERT INTO {SCHEMA}.telegram_link_codes (code, user_id, expires_at) VALUES ({esc(code)}, {user_id}, {esc(expires)})"
            )
            conn.commit()

            bot_username = os.environ.get("TELEGRAM_BOT_USERNAME", "BeGraphicsPC_Bot")
            return {
                "statusCode": 200,
                "headers": cors,
                "body": json.dumps({
                    "code": code,
                    "bot_username": bot_username,
                    "expires_in": 600,
                })
            }

        # --- Подтверждение кода ботом ---
        if action == "confirm" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            bot_secret = body.get("bot_secret", "")
            expected = os.environ.get("TELEGRAM_BOT_SECRET", "")
            if not expected or bot_secret != expected:
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Неверный секрет"})}

            code = str(body.get("code", "")).strip()
            tg_id = body.get("tg_id")
            tg_username = body.get("tg_username", "")
            tg_first = body.get("tg_first", "")
            tg_photo = body.get("tg_photo", "")

            if not code or not tg_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Не хватает данных"})}

            cur.execute(
                f"SELECT user_id FROM {SCHEMA}.telegram_link_codes WHERE code={esc(code)} AND used=FALSE AND expires_at > NOW()"
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Код не найден или истёк"})}

            user_id = row[0]
            cur.execute(
                f"UPDATE {SCHEMA}.users SET telegram_id={tg_id}, telegram_username={esc(tg_username)}, telegram_photo={esc(tg_photo)} WHERE id={user_id}"
            )
            cur.execute(f"UPDATE {SCHEMA}.telegram_link_codes SET used=TRUE WHERE code={esc(code)}")
            conn.commit()

            return {
                "statusCode": 200,
                "headers": cors,
                "body": json.dumps({"ok": True, "user_id": user_id, "tg_first": tg_first})
            }

        # --- Проверка статуса привязки ---
        if action == "check" and method == "GET":
            if not session_id:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}

            cur.execute(f"SELECT user_id FROM {SCHEMA}.user_sessions WHERE id={esc(session_id)} AND expires_at > NOW()")
            row = cur.fetchone()
            if not row:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия не найдена"})}
            user_id = row[0]

            cur.execute(f"SELECT telegram_id, telegram_username, telegram_photo FROM {SCHEMA}.users WHERE id={user_id}")
            user = cur.fetchone()
            if user and user[0]:
                return {
                    "statusCode": 200,
                    "headers": cors,
                    "body": json.dumps({
                        "linked": True,
                        "telegram_id": user[0],
                        "telegram_username": user[1],
                        "telegram_photo": user[2],
                    })
                }
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"linked": False})}

        return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()
