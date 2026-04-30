import json
import os
import hashlib
import secrets
import psycopg2
from datetime import datetime, timedelta

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def hash_pw(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def get_user(cur, session_id):
    if not session_id:
        return None
    cur.execute(
        "SELECT u.id, u.email, u.username FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.id = %s AND s.expires_at > NOW()",
        (session_id,)
    )
    return cur.fetchone()

def handler(event: dict, context) -> dict:
    """
    Авторизация и сборки пользователей.
    POST /register, POST /login, GET /me, POST /logout
    GET /builds, GET /builds/community, GET /builds/shared?token=
    POST /builds, PUT /builds
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    path = event.get("path", "")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")

    conn = get_conn()
    cur = conn.cursor()

    def fmt_build(row):
        return {
            "id": row[0], "user_id": row[1], "name": row[2],
            "components": row[3] or [],
            "parts_total": float(row[4]) if row[4] else 0,
            "assembly_fee": float(row[5]) if row[5] else 0,
            "total_price": float(row[6]) if row[6] else 0,
            "share_token": row[7],
            "is_public": row[8] or False,
            "created_at": row[9].isoformat() if row[9] else None,
        }

    try:
        if "/register" in path and method == "POST":
            body = json.loads(event.get("body") or "{}")
            email = body.get("email", "").strip().lower()
            username = body.get("username", "").strip()
            password = body.get("password", "")
            if not email or not password or not username:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Заполните все поля"})}
            if len(password) < 6:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Пароль минимум 6 символов"})}
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            if cur.fetchone():
                return {"statusCode": 409, "headers": cors, "body": json.dumps({"error": "Email уже зарегистрирован"})}
            cur.execute(
                "INSERT INTO users (email, username, password_hash, created_at) VALUES (%s, %s, %s, NOW()) RETURNING id",
                (email, username, hash_pw(password))
            )
            user_id = cur.fetchone()[0]
            sid = secrets.token_hex(32)
            expires = datetime.now() + timedelta(days=30)
            cur.execute("INSERT INTO user_sessions (id, user_id, created_at, expires_at) VALUES (%s, %s, NOW(), %s)", (sid, user_id, expires))
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"session_id": sid, "user": {"id": user_id, "email": email, "username": username}})}

        elif "/login" in path and method == "POST":
            body = json.loads(event.get("body") or "{}")
            email = body.get("email", "").strip().lower()
            password = body.get("password", "")
            cur.execute("SELECT id, email, username FROM users WHERE email = %s AND password_hash = %s", (email, hash_pw(password)))
            user = cur.fetchone()
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Неверный email или пароль"})}
            sid = secrets.token_hex(32)
            expires = datetime.now() + timedelta(days=30)
            cur.execute("INSERT INTO user_sessions (id, user_id, created_at, expires_at) VALUES (%s, %s, NOW(), %s)", (sid, user[0], expires))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"session_id": sid, "user": {"id": user[0], "email": user[1], "username": user[2]}})}

        elif "/me" in path and method == "GET":
            user = get_user(cur, session_id)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"user": {"id": user[0], "email": user[1], "username": user[2]}})}

        elif "/logout" in path and method == "POST":
            if session_id:
                cur.execute("UPDATE user_sessions SET expires_at = NOW() WHERE id = %s", (session_id,))
                conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif "/builds" in path:
            if method == "GET":
                if "community" in path:
                    cur.execute(
                        "SELECT b.id, b.user_id, b.name, b.components, b.parts_total, b.assembly_fee, b.total_price, b.share_token, b.is_public, b.created_at, u.username FROM user_builds b JOIN users u ON b.user_id = u.id WHERE b.is_public = TRUE ORDER BY b.created_at DESC LIMIT 50"
                    )
                    rows = cur.fetchall()
                    builds = []
                    for row in rows:
                        b = fmt_build(row)
                        b["username"] = row[10]
                        builds.append(b)
                    return {"statusCode": 200, "headers": cors, "body": json.dumps({"builds": builds})}

                token = params.get("token")
                if token:
                    cur.execute(
                        "SELECT b.id, b.user_id, b.name, b.components, b.parts_total, b.assembly_fee, b.total_price, b.share_token, b.is_public, b.created_at, u.username FROM user_builds b JOIN users u ON b.user_id = u.id WHERE b.share_token = %s",
                        (token,)
                    )
                    row = cur.fetchone()
                    if not row:
                        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Сборка не найдена"})}
                    b = fmt_build(row)
                    b["username"] = row[10]
                    return {"statusCode": 200, "headers": cors, "body": json.dumps(b)}

                user = get_user(cur, session_id)
                if not user:
                    return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
                cur.execute(
                    "SELECT id, user_id, name, components, parts_total, assembly_fee, total_price, share_token, is_public, created_at FROM user_builds WHERE user_id = %s ORDER BY created_at DESC",
                    (user[0],)
                )
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"builds": [fmt_build(r) for r in cur.fetchall()]})}

            elif method == "POST":
                user = get_user(cur, session_id)
                if not user:
                    return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
                body = json.loads(event.get("body") or "{}")
                token = secrets.token_hex(16)
                cur.execute(
                    "INSERT INTO user_builds (user_id, name, components, parts_total, assembly_fee, total_price, share_token, is_public, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()) RETURNING id",
                    (user[0], body.get("name", "Моя сборка"), json.dumps(body.get("components", [])),
                     body.get("parts_total", 0), body.get("assembly_fee", 0), body.get("total_price", 0),
                     token, body.get("is_public", False))
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "share_token": token, "ok": True})}

            elif method == "PUT":
                user = get_user(cur, session_id)
                if not user:
                    return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
                body = json.loads(event.get("body") or "{}")
                cur.execute(
                    "UPDATE user_builds SET name=%s, components=%s, parts_total=%s, assembly_fee=%s, total_price=%s, is_public=%s, updated_at=NOW() WHERE id=%s AND user_id=%s",
                    (body.get("name"), json.dumps(body.get("components", [])),
                     body.get("parts_total", 0), body.get("assembly_fee", 0), body.get("total_price", 0),
                     body.get("is_public", False), body["id"], user[0])
                )
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif method == "GET":
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()

    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
