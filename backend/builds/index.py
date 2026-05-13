import json
import os
import secrets
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
}

def resp(status, data):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data, ensure_ascii=False, default=str)}

def fmt_build(row, tags=None):
    return {
        "id": row[0], "name": row[1], "description": row[2],
        "image_urls": row[3] or [],
        "components": row[4] or [],
        "parts_total": float(row[5]) if row[5] else 0,
        "assembly_type": row[6],
        "assembly_fee": float(row[7]) if row[7] else 0,
        "total_price": float(row[8]) if row[8] else 0,
        "status": row[9],
        "is_featured": row[10],
        "sort_order": row[11],
        "created_at": row[12].isoformat() if row[12] else None,
        "client_token": row[13],
        "client_user_id": row[14],
        "parent_id": row[15],
        "in_stock": row[16] if len(row) > 16 else False,
        "tags": tags or [],
    }

def get_tags_for_builds(cur, build_ids):
    if not build_ids:
        return {}
    ids_str = ",".join(str(i) for i in build_ids)
    cur.execute(
        f"SELECT bt.build_id, t.id, t.name, t.color FROM build_tags bt JOIN tags t ON bt.tag_id = t.id WHERE bt.build_id IN ({ids_str})"
    )
    result = {}
    for build_id, tag_id, name, color in cur.fetchall():
        result.setdefault(build_id, []).append({"id": tag_id, "name": name, "color": color})
    return result

def get_user_by_session(cur, session_id):
    if not session_id:
        return None
    cur.execute(
        "SELECT u.id FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.id = %s AND s.expires_at > NOW()",
        (session_id,)
    )
    row = cur.fetchone()
    return row[0] if row else None

def handler(event: dict, context) -> dict:
    """
    Сборки ПК: GET список/одна, POST создать, PUT обновить, PATCH действие, DELETE удалить.
    Поддерживает фильтры: status, id, client_token, parent_id, user_id.
    PATCH actions: generate_client_link, claim.
    """
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")

    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "GET":
            build_id = params.get("id")
            client_token = params.get("client_token")
            parent_id = params.get("parent_id")
            user_id = params.get("user_id")
            status = params.get("status")

            base = """SELECT id, name, description, image_urls, components, parts_total,
                             assembly_type, assembly_fee, total_price, status, is_featured,
                             sort_order, created_at, client_token, client_user_id, parent_id, in_stock
                      FROM pc_builds"""

            if build_id:
                cur.execute(base + " WHERE id = %s", (build_id,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                tags_map = get_tags_for_builds(cur, [row[0]])
                return resp(200, fmt_build(row, tags_map.get(row[0], [])))

            if client_token:
                cur.execute(base + " WHERE client_token = %s", (client_token,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                tags_map = get_tags_for_builds(cur, [row[0]])
                return resp(200, fmt_build(row, tags_map.get(row[0], [])))

            if parent_id:
                cur.execute(base + " WHERE parent_id = %s ORDER BY id", (parent_id,))
                rows = cur.fetchall()
                tags_map = get_tags_for_builds(cur, [r[0] for r in rows])
                return resp(200, [fmt_build(r, tags_map.get(r[0], [])) for r in rows])

            if user_id:
                cur.execute(base + " WHERE client_user_id = %s ORDER BY id DESC", (user_id,))
                rows = cur.fetchall()
                tags_map = get_tags_for_builds(cur, [r[0] for r in rows])
                return resp(200, {"builds": [fmt_build(r, tags_map.get(r[0], [])) for r in rows]})

            where = "WHERE status = %s" if status else ""
            args = [status] if status else []
            cur.execute(base + f" {where} ORDER BY sort_order ASC NULLS LAST, id DESC", args)
            rows = cur.fetchall()
            tags_map = get_tags_for_builds(cur, [r[0] for r in rows])
            return resp(200, {"builds": [fmt_build(r, tags_map.get(r[0], [])) for r in rows]})

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                """INSERT INTO pc_builds (name, description, image_urls, components, parts_total,
                   assembly_type, assembly_fee, total_price, status, is_featured, in_stock, sort_order, created_at, parent_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s) RETURNING id""",
                (body.get("name", "Новая сборка"), body.get("description"),
                 json.dumps(body.get("image_urls", [])), json.dumps(body.get("components", [])),
                 body.get("parts_total", 0), body.get("assembly_type", "manual"),
                 body.get("assembly_fee", 0), body.get("total_price", 0),
                 body.get("status", "draft"), body.get("is_featured", False),
                 body.get("in_stock", False),
                 body.get("sort_order"), body.get("parent_id"))
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return resp(201, {"id": new_id, "ok": True})

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                """UPDATE pc_builds SET name=%s, description=%s, image_urls=%s, components=%s,
                   parts_total=%s, assembly_type=%s, assembly_fee=%s, total_price=%s,
                   status=%s, is_featured=%s, in_stock=%s, sort_order=%s, parent_id=%s
                   WHERE id=%s""",
                (body.get("name"), body.get("description"),
                 json.dumps(body.get("image_urls", [])), json.dumps(body.get("components", [])),
                 body.get("parts_total", 0), body.get("assembly_type", "manual"),
                 body.get("assembly_fee", 0), body.get("total_price", 0),
                 body.get("status", "draft"), body.get("is_featured", False),
                 body.get("in_stock", False),
                 body.get("sort_order"), body.get("parent_id"), body["id"])
            )
            conn.commit()
            return resp(200, {"ok": True})

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            action = body.get("action")

            if action == "generate_client_link":
                token = secrets.token_urlsafe(32)
                cur.execute("UPDATE pc_builds SET client_token=%s WHERE id=%s", (token, body["id"]))
                conn.commit()
                return resp(200, {"ok": True, "client_token": token})

            if action == "claim":
                user_id = get_user_by_session(cur, session_id)
                if not user_id:
                    return resp(401, {"error": "Не авторизован"})
                cur.execute(
                    "UPDATE pc_builds SET client_user_id=%s WHERE client_token=%s",
                    (user_id, body["client_token"])
                )
                conn.commit()
                return resp(200, {"ok": True})

            if action == "set_tags":
                build_id = body.get("id")
                tag_ids = body.get("tag_ids", [])
                cur.execute("DELETE FROM build_tags WHERE build_id=%s", (build_id,))
                for tag_id in tag_ids:
                    cur.execute("INSERT INTO build_tags (build_id, tag_id) VALUES (%s, %s)", (build_id, tag_id))
                conn.commit()
                return resp(200, {"ok": True})

            # Обычный PATCH — обновить отдельные поля
            build_id = body.get("id")
            allowed = ["name", "description", "status", "is_featured", "sort_order",
                       "assembly_fee", "assembly_type", "total_price", "components", "image_urls"]
            updates = {k: body[k] for k in allowed if k in body}
            if not updates or not build_id:
                return resp(400, {"error": "Нет данных для обновления"})
            set_parts = []
            values = []
            for k, v in updates.items():
                set_parts.append(f"{k}=%s")
                values.append(json.dumps(v) if isinstance(v, (list, dict)) else v)
            values.append(build_id)
            cur.execute(f"UPDATE pc_builds SET {', '.join(set_parts)} WHERE id=%s", values)
            conn.commit()
            return resp(200, {"ok": True})

        elif method == "DELETE":
            build_id = params.get("id")
            if not build_id:
                return resp(400, {"error": "Нет id"})
            cur.execute("DELETE FROM pc_builds WHERE id=%s", (build_id,))
            conn.commit()
            return resp(200, {"ok": True})

    finally:
        cur.close()
        conn.close()

    return resp(405, {"error": "Method not allowed"})