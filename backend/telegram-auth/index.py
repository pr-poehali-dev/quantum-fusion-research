import json
import os
import hashlib
import hmac
import secrets
import psycopg2
from datetime import datetime, timedelta


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def esc(val):
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def verify_telegram_hash(data: dict, bot_token: str) -> bool:
    """Верифицирует подпись от Telegram Login Widget"""
    check_hash = data.get("hash", "")
    fields = {k: v for k, v in data.items() if k != "hash"}
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    computed = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    return computed == check_hash


def handler(event: dict, context) -> dict:
    """
    Вход через Telegram Login Widget.
    POST ?action=login — верификация данных от Telegram и выдача сессии
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

    if method == "GET":
        return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    if action != "login" or method != "POST":
        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}

    body = json.loads(event.get("body") or "{}")
    tg_data = body.get("tg_data", {})

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not verify_telegram_hash(tg_data, bot_token):
        return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Неверная подпись Telegram"})}

    tg_id = int(tg_data["id"])
    tg_username = tg_data.get("username", "")
    tg_first = tg_data.get("first_name", "")
    tg_last = tg_data.get("last_name", "")
    tg_photo = tg_data.get("photo_url", "")
    display_name = tg_username or f"{tg_first} {tg_last}".strip() or f"tg_{tg_id}"

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute(f"SELECT id, email, username FROM t_p72635010_quantum_fusion_resea.users WHERE telegram_id = {tg_id}")
        user = cur.fetchone()

        if user:
            user_id, email, username = user[0], user[1], user[2]
            if tg_username:
                cur.execute(f"UPDATE t_p72635010_quantum_fusion_resea.users SET telegram_username={esc(tg_username)}, telegram_photo={esc(tg_photo)} WHERE id={user_id}")
        else:
            cur.execute(
                f"INSERT INTO t_p72635010_quantum_fusion_resea.users (telegram_id, telegram_username, telegram_photo, username, password_hash, created_at) "
                f"VALUES ({tg_id}, {esc(tg_username)}, {esc(tg_photo)}, {esc(display_name)}, '', NOW()) RETURNING id, email, username"
            )
            row = cur.fetchone()
            user_id, email, username = row[0], row[1], row[2]

        sid = secrets.token_hex(32)
        expires = (datetime.now() + timedelta(days=30)).isoformat()
        cur.execute(
            f"INSERT INTO t_p72635010_quantum_fusion_resea.user_sessions (id, user_id, created_at, expires_at) VALUES ({esc(sid)}, {user_id}, NOW(), {esc(expires)})"
        )
        conn.commit()

        return {
            "statusCode": 200,
            "headers": cors,
            "body": json.dumps({
                "session_id": sid,
                "user": {
                    "id": user_id,
                    "email": email or "",
                    "username": username,
                    "telegram_username": tg_username,
                    "telegram_photo": tg_photo,
                }
            })
        }

    finally:
        cur.close()
        conn.close()
