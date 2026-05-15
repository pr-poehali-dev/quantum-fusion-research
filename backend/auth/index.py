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


def esc(val):
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def get_user(cur, session_id):
    if not session_id:
        return None
    cur.execute(
        f"SELECT u.id, u.email, u.username FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.id = {esc(session_id)} AND s.expires_at > NOW()"
    )
    return cur.fetchone()


def handler(event: dict, context) -> dict:
    """
    Авторизация пользователей.
    POST ?action=register, POST ?action=login, GET ?action=me, POST ?action=logout
    GET ?action=builds, GET ?action=community, GET ?action=build&token=...
    POST ?action=save_build, PUT ?action=update_build
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")
    action = params.get("action", "")

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
        if action == "register" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            email = body.get("email", "").strip().lower()
            username = body.get("username", "").strip()
            password = body.get("password", "")
            if not email or not password or not username:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Заполните все поля"})}
            if len(password) < 6:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Пароль минимум 6 символов"})}
            cur.execute(f"SELECT id FROM users WHERE email = {esc(email)}")
            if cur.fetchone():
                return {"statusCode": 409, "headers": cors, "body": json.dumps({"error": "Email уже зарегистрирован"})}
            pw_hash = hash_pw(password)
            cur.execute(
                f"INSERT INTO users (email, username, password_hash, created_at) VALUES ({esc(email)}, {esc(username)}, {esc(pw_hash)}, NOW()) RETURNING id"
            )
            user_id = cur.fetchone()[0]
            sid = secrets.token_hex(32)
            expires = (datetime.now() + timedelta(days=30)).isoformat()
            cur.execute(
                f"INSERT INTO user_sessions (id, user_id, created_at, expires_at) VALUES ({esc(sid)}, {user_id}, NOW(), {esc(expires)})"
            )
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"session_id": sid, "user": {"id": user_id, "email": email, "username": username}})}

        elif action == "login" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            email = body.get("email", "").strip().lower()
            password = body.get("password", "")
            pw_hash = hash_pw(password)
            cur.execute(f"SELECT id, email, username FROM users WHERE email = {esc(email)} AND password_hash = {esc(pw_hash)}")
            user = cur.fetchone()
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Неверный email или пароль"})}
            sid = secrets.token_hex(32)
            expires = (datetime.now() + timedelta(days=30)).isoformat()
            cur.execute(
                f"INSERT INTO user_sessions (id, user_id, created_at, expires_at) VALUES ({esc(sid)}, {user[0]}, NOW(), {esc(expires)})"
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"session_id": sid, "user": {"id": user[0], "email": user[1], "username": user[2]}})}

        elif action == "me" and method == "GET":
            user = get_user(cur, session_id)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"user": {"id": user[0], "email": user[1], "username": user[2]}})}

        elif action == "logout" and method == "POST":
            if session_id:
                cur.execute(f"UPDATE user_sessions SET expires_at = NOW() WHERE id = {esc(session_id)}")
                conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif action == "community" and method == "GET":
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

        elif action == "build" and method == "GET":
            token = params.get("token")
            cur.execute(
                f"SELECT b.id, b.user_id, b.name, b.components, b.parts_total, b.assembly_fee, b.total_price, b.share_token, b.is_public, b.created_at, u.username FROM user_builds b JOIN users u ON b.user_id = u.id WHERE b.share_token = {esc(token)}"
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Сборка не найдена"})}
            b = fmt_build(row)
            b["username"] = row[10]
            return {"statusCode": 200, "headers": cors, "body": json.dumps(b)}

        elif action == "builds" and method == "GET":
            user = get_user(cur, session_id)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            cur.execute(
                f"SELECT id, user_id, name, components, parts_total, assembly_fee, total_price, share_token, is_public, created_at FROM user_builds WHERE user_id = {user[0]} ORDER BY created_at DESC"
            )
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"builds": [fmt_build(r) for r in cur.fetchall()]})}

        elif action == "save_build" and method == "POST":
            user = get_user(cur, session_id)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            share_token = secrets.token_hex(16)
            name = body.get("name", "Моя сборка")
            components = json.dumps(body.get("components", []))
            parts_total = float(body.get("parts_total", 0))
            assembly_fee = float(body.get("assembly_fee", 0))
            total_price = float(body.get("total_price", 0))
            is_public = "TRUE" if body.get("is_public", False) else "FALSE"
            cur.execute(
                f"INSERT INTO user_builds (user_id, name, components, parts_total, assembly_fee, total_price, share_token, is_public, created_at, updated_at) VALUES ({user[0]}, {esc(name)}, {esc(components)}, {parts_total}, {assembly_fee}, {total_price}, {esc(share_token)}, {is_public}, NOW(), NOW()) RETURNING id"
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "share_token": share_token, "ok": True})}

        elif action == "update_build" and method == "PUT":
            user = get_user(cur, session_id)
            if not user:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            name = body.get("name", "")
            components = json.dumps(body.get("components", []))
            parts_total = float(body.get("parts_total", 0))
            assembly_fee = float(body.get("assembly_fee", 0))
            total_price = float(body.get("total_price", 0))
            is_public = "TRUE" if body.get("is_public", False) else "FALSE"
            build_id = int(body["id"])
            cur.execute(
                f"UPDATE user_builds SET name={esc(name)}, components={esc(components)}, parts_total={parts_total}, assembly_fee={assembly_fee}, total_price={total_price}, is_public={is_public}, updated_at=NOW() WHERE id={build_id} AND user_id={user[0]}"
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        else:
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()
