import json
import os
import hashlib
import secrets
import re
import psycopg2
from datetime import datetime, timedelta


SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p72635010_quantum_fusion_resea")


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def hash_pw(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def esc(val):
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


_SHORT_ALPHABET = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789"


def gen_short_code(cur, length=6):
    """Генерирует уникальный короткий код для user_builds.short_code."""
    for _ in range(20):
        code = "".join(secrets.choice(_SHORT_ALPHABET) for _ in range(length))
        cur.execute(
            f"SELECT 1 FROM {SCHEMA}.user_builds WHERE short_code = {esc(code)}"
        )
        if not cur.fetchone():
            return code
    return secrets.token_urlsafe(6)


def get_user(cur, session_id):
    if not session_id:
        return None
    cur.execute(
        f"SELECT u.id, u.email, u.username, u.bio, u.phone, u.vk_url, u.telegram_id, u.telegram_username, u.telegram_photo, u.email_verified, u.user_tag, u.is_public, u.avatar_url, u.telegram_tag, u.role, u.is_premium, u.status "
        f"FROM {SCHEMA}.user_sessions s JOIN {SCHEMA}.users u ON s.user_id = u.id "
        f"WHERE s.id = {esc(session_id)} AND s.expires_at > NOW()"
    )
    return cur.fetchone()


def fmt_user(u):
    return {
        "id": u[0],
        "email": u[1] or "",
        "username": u[2],
        "bio": u[3] or "",
        "phone": u[4] or "",
        "vk_url": u[5] or "",
        "telegram_id": u[6],
        "telegram_username": u[7] or "",
        "telegram_photo": u[8] or "",
        "email_verified": u[9] or False,
        "user_tag": u[10] or "",
        "is_public": u[11] if u[11] is not None else True,
        "avatar_url": u[12] or "",
        "telegram_tag": u[13] or "",
        "role": u[14] or "user",
        "is_premium": u[15] or False,
        "status": u[16] or "active",
    }



def handler(event: dict, context) -> dict:
    """
    Авторизация пользователей.
    POST ?action=register, POST ?action=login, GET ?action=me, POST ?action=logout
    POST ?action=update_profile — обновление профиля (bio, phone, vk_url, email, username, user_tag, is_public, avatar_url, telegram_tag)
    GET ?action=view&tag=... — публичный просмотр профиля по тегу
    GET ?action=builds, GET ?action=community, GET ?action=build&token=...
    POST ?action=save_build, PUT ?action=update_build
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
            cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE email = {esc(email)}")
            if cur.fetchone():
                return {"statusCode": 409, "headers": cors, "body": json.dumps({"error": "Email уже зарегистрирован"})}
            pw_hash = hash_pw(password)
            cur.execute(
                f"INSERT INTO {SCHEMA}.users (email, username, password_hash, created_at) VALUES ({esc(email)}, {esc(username)}, {esc(pw_hash)}, NOW()) RETURNING id"
            )
            user_id = cur.fetchone()[0]
            sid = secrets.token_hex(32)
            expires = (datetime.now() + timedelta(days=30)).isoformat()
            cur.execute(
                f"INSERT INTO {SCHEMA}.user_sessions (id, user_id, created_at, expires_at) VALUES ({esc(sid)}, {user_id}, NOW(), {esc(expires)})"
            )
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"session_id": sid, "user": {"id": user_id, "email": email, "username": username, "bio": "", "phone": "", "vk_url": "", "telegram_id": None, "telegram_username": "", "telegram_photo": "", "email_verified": False, "user_tag": "", "is_public": True, "avatar_url": "", "telegram_tag": ""}})}

        elif action == "login" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            email = body.get("email", "").strip().lower()
            password = body.get("password", "")
            pw_hash = hash_pw(password)
            cur.execute(
                f"SELECT id, email, username, bio, phone, vk_url, telegram_id, telegram_username, telegram_photo, email_verified, user_tag, is_public, avatar_url, telegram_tag, role, is_premium, status "
                f"FROM {SCHEMA}.users WHERE email = {esc(email)} AND password_hash = {esc(pw_hash)}"
            )
            u = cur.fetchone()
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Неверный email или пароль"})}
            sid = secrets.token_hex(32)
            expires = (datetime.now() + timedelta(days=30)).isoformat()
            cur.execute(
                f"INSERT INTO {SCHEMA}.user_sessions (id, user_id, created_at, expires_at) VALUES ({esc(sid)}, {u[0]}, NOW(), {esc(expires)})"
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"session_id": sid, "user": fmt_user(u)})}

        elif action == "me" and method == "GET":
            u = get_user(cur, session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"user": fmt_user(u)})}

        elif action == "public":
            tag = params.get("utag", params.get("tag", "")).strip().lstrip("@").lower()
            if not tag:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Тег не указан"})}
            cur.execute(
                f"SELECT id, username, bio, vk_url, avatar_url, user_tag, is_public, telegram_tag FROM {SCHEMA}.users WHERE LOWER(user_tag) = {esc(tag)}"
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Пользователь не найден"})}
            user_id, username, bio, vk_url, avatar_url, user_tag, is_public, telegram_tag = row
            if not is_public:
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Профиль закрыт"})}
            cur.execute(
                f"SELECT id, name, components, parts_total, assembly_fee, total_price, share_token, created_at, short_code "
                f"FROM {SCHEMA}.user_builds WHERE user_id = {user_id} AND is_public = TRUE ORDER BY created_at DESC LIMIT 20"
            )
            builds = []
            for b in cur.fetchall():
                builds.append({
                    "id": b[0], "name": b[1],
                    "components": b[2] or [],
                    "parts_total": float(b[3]) if b[3] else 0,
                    "assembly_fee": float(b[4]) if b[4] else 0,
                    "total_price": float(b[5]) if b[5] else 0,
                    "share_token": b[6],
                    "created_at": b[7].isoformat() if b[7] else None,
                    "short_code": b[8] or "",
                })
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "id": user_id, "username": username, "bio": bio or "",
                "vk_url": vk_url or "", "avatar_url": avatar_url or "",
                "user_tag": user_tag or "", "telegram_tag": telegram_tag or "",
                "builds": builds,
            })}

        elif action == "update_profile" and method == "POST":
            u = get_user(cur, session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            user_id = u[0]

            updates = []
            if "username" in body and body["username"].strip():
                updates.append(f"username = {esc(body['username'].strip())}")
            if "bio" in body:
                updates.append(f"bio = {esc(body['bio'])}")
            if "phone" in body:
                updates.append(f"phone = {esc(body['phone'])}")
            if "vk_url" in body:
                updates.append(f"vk_url = {esc(body['vk_url'])}")
            if "telegram_tag" in body:
                updates.append(f"telegram_tag = {esc(body['telegram_tag'])}")
            if "avatar_url" in body:
                updates.append(f"avatar_url = {esc(body['avatar_url'])}")
            if "is_public" in body:
                updates.append(f"is_public = {'TRUE' if body['is_public'] else 'FALSE'}")
            if "user_tag" in body:
                tag = body["user_tag"].strip().lstrip("@").lower()
                if tag:
                    if not re.match(r'^[a-z0-9_]{3,32}$', tag):
                        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Тег: только латиница, цифры и _, от 3 до 32 символов"})}
                    cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE LOWER(user_tag) = {esc(tag)} AND id != {user_id}")
                    if cur.fetchone():
                        return {"statusCode": 409, "headers": cors, "body": json.dumps({"error": "Этот тег уже занят"})}
                    updates.append(f"user_tag = {esc(tag)}")
                else:
                    updates.append("user_tag = NULL")
            if "email" in body and body["email"].strip():
                new_email = body["email"].strip().lower()
                cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE email = {esc(new_email)} AND id != {user_id}")
                if cur.fetchone():
                    return {"statusCode": 409, "headers": cors, "body": json.dumps({"error": "Email уже занят"})}
                updates.append(f"email = {esc(new_email)}")
                updates.append("email_verified = FALSE")

            if updates:
                cur.execute(f"UPDATE {SCHEMA}.users SET {', '.join(updates)} WHERE id = {user_id}")
                conn.commit()

            cur.execute(
                f"SELECT id, email, username, bio, phone, vk_url, telegram_id, telegram_username, telegram_photo, email_verified, user_tag, is_public, avatar_url, telegram_tag FROM {SCHEMA}.users WHERE id = {user_id}"
            )
            updated = cur.fetchone()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"user": fmt_user(updated)})}

        elif action == "logout" and method == "POST":
            if session_id:
                cur.execute(f"UPDATE {SCHEMA}.user_sessions SET expires_at = NOW() WHERE id = {esc(session_id)}")
                conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif action == "community" and method == "GET":
            cur.execute(
                f"SELECT b.id, b.user_id, b.name, b.components, b.parts_total, b.assembly_fee, b.total_price, b.share_token, b.is_public, b.created_at, u.username, u.avatar_url, u.user_tag, b.short_code FROM {SCHEMA}.user_builds b JOIN {SCHEMA}.users u ON b.user_id = u.id WHERE b.is_public = TRUE ORDER BY b.created_at DESC LIMIT 50"
            )
            rows = cur.fetchall()
            builds = []
            for row in rows:
                b = fmt_build(row)
                b["username"] = row[10]
                b["author_avatar"] = row[11] or ""
                b["author_tag"] = row[12] or ""
                b["short_code"] = row[13] or ""
                builds.append(b)
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"builds": builds})}

        elif action == "build" and method == "GET":
            token = params.get("token")
            code = params.get("code")
            where = f"b.short_code = {esc(code)}" if code else f"b.share_token = {esc(token)}"
            cur.execute(
                f"SELECT b.id, b.user_id, b.name, b.components, b.parts_total, b.assembly_fee, b.total_price, b.share_token, b.is_public, b.created_at, u.username, u.avatar_url, u.user_tag, b.short_code FROM {SCHEMA}.user_builds b JOIN {SCHEMA}.users u ON b.user_id = u.id WHERE {where}"
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Сборка не найдена"})}
            b = fmt_build(row)
            b["username"] = row[10]
            b["author_avatar"] = row[11] or ""
            b["author_tag"] = row[12] or ""
            b["short_code"] = row[13] or ""
            return {"statusCode": 200, "headers": cors, "body": json.dumps(b)}

        elif action == "builds" and method == "GET":
            u = get_user(cur, session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            cur.execute(
                f"SELECT id, user_id, name, components, parts_total, assembly_fee, total_price, share_token, is_public, created_at, short_code FROM {SCHEMA}.user_builds WHERE user_id = {u[0]} ORDER BY created_at DESC"
            )
            out = []
            for r in cur.fetchall():
                b = fmt_build(r)
                b["short_code"] = r[10] or ""
                out.append(b)
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"builds": out})}

        elif action == "save_build" and method == "POST":
            u = get_user(cur, session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            share_token = secrets.token_hex(16)
            short_code = gen_short_code(cur)
            name = body.get("name", "Моя сборка")
            components = json.dumps(body.get("components", []))
            parts_total = float(body.get("parts_total", 0))
            assembly_fee = float(body.get("assembly_fee", 0))
            total_price = float(body.get("total_price", 0))
            is_public = "TRUE" if body.get("is_public", False) else "FALSE"
            description = esc(body.get("description", "") or "")
            raw_urls = body.get("image_urls", []) or []
            image_urls = esc(json.dumps(raw_urls[:3]))
            cur.execute(
                f"INSERT INTO {SCHEMA}.user_builds (user_id, name, components, parts_total, assembly_fee, total_price, share_token, short_code, is_public, description, image_urls, created_at, updated_at) "
                f"VALUES ({u[0]}, {esc(name)}, {esc(components)}, {parts_total}, {assembly_fee}, {total_price}, {esc(share_token)}, {esc(short_code)}, {is_public}, {description}, {image_urls}, NOW(), NOW()) RETURNING id"
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "share_token": share_token, "short_code": short_code, "ok": True})}

        elif action == "update_build" and method == "PUT":
            u = get_user(cur, session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            name = body.get("name", "")
            components = json.dumps(body.get("components", []))
            parts_total = float(body.get("parts_total", 0))
            assembly_fee = float(body.get("assembly_fee", 0))
            total_price = float(body.get("total_price", 0))
            is_public = "TRUE" if body.get("is_public", False) else "FALSE"
            build_id = int(body["id"])
            description = esc(body.get("description", "") or "")
            raw_urls = body.get("image_urls", []) or []
            image_urls = esc(json.dumps(raw_urls[:3]))
            cur.execute(
                f"UPDATE {SCHEMA}.user_builds SET name={esc(name)}, components={esc(components)}, parts_total={parts_total}, assembly_fee={assembly_fee}, total_price={total_price}, is_public={is_public}, description={description}, image_urls={image_urls}, updated_at=NOW() WHERE id={build_id} AND user_id={u[0]}"
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif action == "delete_build" and method == "DELETE":
            u = get_user(cur, session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            build_id = int(body["id"])
            cur.execute(f"DELETE FROM {SCHEMA}.user_builds WHERE id={build_id} AND user_id={u[0]}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif action == "user-build" and method == "GET":
            # Публичная страница сборки по токену или короткому коду — полная информация
            token = params.get("token")
            code = params.get("code")
            where = f"b.short_code = {esc(code)}" if code else f"b.share_token = {esc(token)}"
            cur.execute(
                f"SELECT b.id, b.user_id, b.name, b.components, b.parts_total, b.assembly_fee, b.total_price, b.share_token, b.is_public, b.created_at, u.username, u.avatar_url, u.user_tag, b.description, b.image_urls, b.short_code "
                f"FROM {SCHEMA}.user_builds b JOIN {SCHEMA}.users u ON b.user_id = u.id "
                f"WHERE {where}"
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Сборка не найдена"})}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "id": row[0], "user_id": row[1], "name": row[2],
                "components": row[3] or [],
                "parts_total": float(row[4]) if row[4] else 0,
                "assembly_fee": float(row[5]) if row[5] else 0,
                "total_price": float(row[6]) if row[6] else 0,
                "share_token": row[7], "is_public": row[8] or False,
                "created_at": row[9].isoformat() if row[9] else None,
                "username": row[10], "author_avatar": row[11] or "",
                "author_tag": row[12] or "",
                "description": row[13] or "",
                "image_urls": row[14] or [],
                "short_code": row[15] or "",
            })}

        # ── ADMIN: проверка пароля входа в админку ──
        # Сверяет присланный пароль с секретом ADMIN_KEY. Возвращает ok=true/false.
        elif action == "admin_login":
            if method == "POST":
                body_login = json.loads(event.get("body") or "{}")
                admin_key = body_login.get("ak") or ""
            else:
                admin_key = params.get("ak") or ""
            ok = bool(admin_key) and admin_key == os.environ.get("ADMIN_KEY", "begraphics2024")
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": ok})}

        # ── ADMIN: управление пользователями ──

        elif action == "admin_users" and method == "GET":
            admin_key = params.get("ak") or headers.get("X-Admin-Key") or headers.get("x-admin-key")
            if admin_key != os.environ.get("ADMIN_KEY", "begraphics2024"):
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}
            search = params.get("search", "")
            where = f"WHERE username ILIKE {esc('%'+search+'%')} OR email ILIKE {esc('%'+search+'%')}" if search else ""
            cur.execute(f"SELECT id, email, username, user_tag, avatar_url, role, is_premium, status, warning_count, is_muted, created_at FROM {SCHEMA}.users {where} ORDER BY created_at DESC LIMIT 100")
            users = []
            for r in cur.fetchall():
                users.append({"id": r[0], "email": r[1] or "", "username": r[2], "user_tag": r[3] or "", "avatar_url": r[4] or "", "role": r[5] or "user", "is_premium": r[6] or False, "status": r[7] or "active", "warning_count": r[8] or 0, "is_muted": r[9] or False, "created_at": r[10].isoformat() if r[10] else None})
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"users": users})}

        elif action == "admin_user_update" and method == "POST":
            body_pre = json.loads(event.get("body") or "{}")
            admin_key = body_pre.get("ak") or headers.get("X-Admin-Key") or headers.get("x-admin-key")
            if admin_key != os.environ.get("ADMIN_KEY", "begraphics2024"):
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}
            body = body_pre
            target_id = int(body["user_id"])
            op = body.get("op")  # set_role, set_premium, set_status, warn, mute, delete
            if op == "set_role":
                role = body.get("role", "user")
                cur.execute(f"UPDATE {SCHEMA}.users SET role={esc(role)} WHERE id={target_id}")
            elif op == "set_premium":
                val = "TRUE" if body.get("value") else "FALSE"
                cur.execute(f"UPDATE {SCHEMA}.users SET is_premium={val} WHERE id={target_id}")
            elif op == "set_status":
                status = body.get("status", "active")  # active, blocked
                cur.execute(f"UPDATE {SCHEMA}.users SET status={esc(status)} WHERE id={target_id}")
            elif op == "warn":
                cur.execute(f"UPDATE {SCHEMA}.users SET warning_count=warning_count+1 WHERE id={target_id}")
            elif op == "mute":
                val = "TRUE" if body.get("value") else "FALSE"
                cur.execute(f"UPDATE {SCHEMA}.users SET is_muted={val} WHERE id={target_id}")
            elif op == "delete":
                cur.execute(f"DELETE FROM {SCHEMA}.user_sessions WHERE user_id={target_id}")
                cur.execute(f"DELETE FROM {SCHEMA}.users WHERE id={target_id}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        else:
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()