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
        f"SELECT u.id, u.email, u.username, u.bio, u.phone, u.vk_url, u.telegram_id, u.telegram_username, u.telegram_photo, u.email_verified, u.user_tag, u.is_public, u.avatar_url, u.telegram_tag, u.role, u.is_premium, u.status, u.partner_company_id "
        f"FROM {SCHEMA}.user_sessions s JOIN {SCHEMA}.users u ON s.user_id = u.id "
        f"WHERE s.id = {esc(session_id)} AND s.expires_at > NOW()"
    )
    return cur.fetchone()


def company_access(cur, company_id):
    """Возвращает доступ компании: {company:{...}, access:{b2b, lk, reason}} либо None.
    Правила: basic → только b2b. close/paid → b2b+lk. Активный триал → b2b+lk
    независимо от tier. Если status=suspended — доступа нет."""
    if not company_id:
        return None
    cur.execute(
        f"SELECT id, name, tier, status, trial_ends_at, stress_ingest_token "
        f"FROM {SCHEMA}.partner_companies WHERE id = {int(company_id)}"
    )
    r = cur.fetchone()
    if not r:
        return None
    tier, status, trial_ends = r[2], r[3], r[4]
    # Активен ли триал прямо сейчас
    trial_active = False
    if trial_ends is not None:
        cur.execute(f"SELECT {esc(str(trial_ends))}::timestamptz > NOW()")
        trial_active = bool(cur.fetchone()[0])
    suspended = status == "suspended"
    if suspended:
        b2b = lk = False
        reason = "suspended"
    elif trial_active:
        b2b = lk = True
        reason = "trial"
    elif tier in ("close", "paid"):
        b2b = lk = True
        reason = tier
    else:  # basic
        b2b = True
        lk = False
        reason = "basic"
    return {
        "company": {
            "id": r[0], "name": r[1] or "", "tier": tier, "status": status,
            "trial_ends_at": str(trial_ends) if trial_ends else None,
            "trial_active": trial_active,
            "stress_ingest_token": r[5] or "",
        },
        "access": {"b2b": b2b, "lk": lk, "reason": reason},
    }


def fmt_user(u, cur=None):
    company_id = u[17] if len(u) > 17 else None
    data = {
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
        "partner_company_id": company_id,
    }
    if cur is not None and company_id:
        info = company_access(cur, company_id)
        if info:
            data["partner_company"] = info["company"]
            data["partner_access"] = info["access"]
    return data



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
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id, X-Admin-Key",
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
                f"SELECT id, email, username, bio, phone, vk_url, telegram_id, telegram_username, telegram_photo, email_verified, user_tag, is_public, avatar_url, telegram_tag, role, is_premium, status, partner_company_id "
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
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"session_id": sid, "user": fmt_user(u, cur)})}

        elif action == "me" and method == "GET":
            u = get_user(cur, session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"user": fmt_user(u, cur)})}

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
            where = f"WHERE u.username ILIKE {esc('%'+search+'%')} OR u.email ILIKE {esc('%'+search+'%')}" if search else ""
            cur.execute(
                f"SELECT u.id, u.email, u.username, u.user_tag, u.avatar_url, u.role, u.is_premium, u.status, u.warning_count, u.is_muted, u.created_at, u.partner_company_id, c.name "
                f"FROM {SCHEMA}.users u LEFT JOIN {SCHEMA}.partner_companies c ON u.partner_company_id = c.id "
                f"{where} ORDER BY u.created_at DESC LIMIT 100"
            )
            users = []
            for r in cur.fetchall():
                users.append({"id": r[0], "email": r[1] or "", "username": r[2], "user_tag": r[3] or "", "avatar_url": r[4] or "", "role": r[5] or "user", "is_premium": r[6] or False, "status": r[7] or "active", "warning_count": r[8] or 0, "is_muted": r[9] or False, "created_at": r[10].isoformat() if r[10] else None, "partner_company_id": r[11], "partner_company_name": r[12] or ""})
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
            elif op == "set_company":
                cid = body.get("company_id")
                cid_sql = str(int(cid)) if cid not in (None, "", 0, "0") else "NULL"
                cur.execute(f"UPDATE {SCHEMA}.users SET partner_company_id={cid_sql} WHERE id={target_id}")
            elif op == "delete":
                cur.execute(f"DELETE FROM {SCHEMA}.user_sessions WHERE user_id={target_id}")
                cur.execute(f"DELETE FROM {SCHEMA}.users WHERE id={target_id}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── ADMIN: партнёрские компании ──

        elif action == "admin_companies" and method == "GET":
            admin_key = params.get("ak") or headers.get("X-Admin-Key") or headers.get("x-admin-key")
            if admin_key != os.environ.get("ADMIN_KEY", "begraphics2024"):
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}
            cur.execute(
                f"SELECT c.id, c.name, c.tier, c.status, c.trial_ends_at, c.stress_ingest_token, "
                f"c.contact_name, c.contact_phone, c.note, c.created_at, "
                f"(c.trial_ends_at IS NOT NULL AND c.trial_ends_at > NOW()) AS trial_active, "
                f"(SELECT COUNT(*) FROM {SCHEMA}.users u WHERE u.partner_company_id = c.id) AS users_count "
                f"FROM {SCHEMA}.partner_companies c ORDER BY c.created_at DESC"
            )
            companies = []
            for r in cur.fetchall():
                companies.append({
                    "id": r[0], "name": r[1] or "", "tier": r[2], "status": r[3],
                    "trial_ends_at": r[4].isoformat() if r[4] else None,
                    "stress_ingest_token": r[5] or "", "contact_name": r[6] or "",
                    "contact_phone": r[7] or "", "note": r[8] or "",
                    "created_at": r[9].isoformat() if r[9] else None,
                    "trial_active": bool(r[10]), "users_count": r[11],
                })
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"companies": companies})}

        elif action == "admin_company_save" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            admin_key = body.get("ak") or headers.get("X-Admin-Key") or headers.get("x-admin-key")
            if admin_key != os.environ.get("ADMIN_KEY", "begraphics2024"):
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}
            cid = body.get("id")
            name = (body.get("name") or "").strip()
            tier = body.get("tier") or "basic"
            if tier not in ("basic", "close", "paid"):
                tier = "basic"
            status = body.get("status") or "active"
            if status not in ("active", "suspended"):
                status = "active"
            token = (body.get("stress_ingest_token") or "").strip()
            contact_name = body.get("contact_name") or ""
            contact_phone = body.get("contact_phone") or ""
            note = body.get("note") or ""
            # Триал: trial_days (запустить/продлить на N дней) или trial_ends_at=null (сброс)
            trial_sql = None  # None → не трогаем
            if "trial_days" in body and body.get("trial_days") not in (None, ""):
                days = int(body.get("trial_days") or 0)
                trial_sql = f"NOW() + INTERVAL '{days} days'" if days > 0 else "NULL"
            elif body.get("clear_trial"):
                trial_sql = "NULL"
            # Уникальность токена
            if token:
                cur.execute(
                    f"SELECT id FROM {SCHEMA}.partner_companies WHERE stress_ingest_token = {esc(token)}"
                    + (f" AND id <> {int(cid)}" if cid else "")
                )
                if cur.fetchone():
                    return {"statusCode": 409, "headers": cors, "body": json.dumps({"error": "Токен уже используется другой компанией"})}
            if cid:
                sets = (
                    f"name={esc(name)}, tier={esc(tier)}, status={esc(status)}, "
                    f"stress_ingest_token={esc(token)}, contact_name={esc(contact_name)}, "
                    f"contact_phone={esc(contact_phone)}, note={esc(note)}, updated_at=NOW()"
                )
                if trial_sql is not None:
                    sets += f", trial_ends_at={trial_sql}"
                cur.execute(f"UPDATE {SCHEMA}.partner_companies SET {sets} WHERE id={int(cid)} RETURNING id")
            else:
                trial_val = trial_sql if trial_sql is not None else "NULL"
                cur.execute(
                    f"INSERT INTO {SCHEMA}.partner_companies (name, tier, status, stress_ingest_token, "
                    f"contact_name, contact_phone, note, trial_ends_at) VALUES "
                    f"({esc(name)}, {esc(tier)}, {esc(status)}, {esc(token)}, "
                    f"{esc(contact_name)}, {esc(contact_phone)}, {esc(note)}, {trial_val}) RETURNING id"
                )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "id": new_id})}

        elif action == "admin_company_delete" and method == "DELETE":
            admin_key = params.get("ak") or headers.get("X-Admin-Key") or headers.get("x-admin-key")
            if admin_key != os.environ.get("ADMIN_KEY", "begraphics2024"):
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}
            cid = int(params.get("id") or 0)
            if not cid:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "id required"})}
            # Отвязываем юзеров и прогоны, компанию удаляем
            cur.execute(f"UPDATE {SCHEMA}.users SET partner_company_id=NULL WHERE partner_company_id={cid}")
            cur.execute(f"UPDATE {SCHEMA}.stress_runs SET partner_company_id=NULL WHERE partner_company_id={cid}")
            cur.execute(f"DELETE FROM {SCHEMA}.partner_companies WHERE id={cid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        else:
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()