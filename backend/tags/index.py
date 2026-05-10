import json
import os
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

def resp(status, data):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data, ensure_ascii=False, default=str)}

def handler(event: dict, context) -> dict:
    """CRUD для тегов сборок: GET список, POST создать, PUT обновить, DELETE удалить."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}

    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "GET":
            cur.execute("SELECT id, name, color, sort_order FROM tags ORDER BY sort_order ASC, id ASC")
            tags = [{"id": r[0], "name": r[1], "color": r[2], "sort_order": r[3]} for r in cur.fetchall()]
            return resp(200, {"tags": tags})

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                "INSERT INTO tags (name, color, sort_order) VALUES (%s, %s, %s) RETURNING id",
                (body["name"], body.get("color", "primary"), body.get("sort_order", 0))
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return resp(201, {"id": new_id, "ok": True})

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                "UPDATE tags SET name=%s, color=%s, sort_order=%s WHERE id=%s",
                (body["name"], body.get("color", "primary"), body.get("sort_order", 0), body["id"])
            )
            conn.commit()
            return resp(200, {"ok": True})

        elif method == "DELETE":
            tag_id = params.get("id")
            if not tag_id:
                return resp(400, {"error": "Нет id"})
            cur.execute("DELETE FROM tags WHERE id=%s", (tag_id,))
            conn.commit()
            return resp(200, {"ok": True})

    finally:
        cur.close()
        conn.close()

    return resp(405, {"error": "Method not allowed"})
