import json
import os
import uuid
import psycopg2

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def resp(status, data):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data, ensure_ascii=False, default=str)}

def fmt(row):
    return {
        "id": row[0], "name": row[1],
        "cpu_type": row[2], "gpu_type": row[3],
        "pin_colors": row[4],
        "client_token": row[5],
        "created_at": row[6].isoformat() if row[6] else None,
        "updated_at": row[7].isoformat() if row[7] else None,
    }

def handler(event: dict, context) -> dict:
    """Конфигурации кастомных кабелей: CRUD + генерация клиентской ссылки."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "GET":
            token = params.get("client_token")
            cid = params.get("id")
            if token:
                cur.execute(
                    "SELECT id, name, cpu_type, gpu_type, pin_colors, client_token, created_at, updated_at FROM cable_configs WHERE client_token = %s",
                    (token,)
                )
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                return resp(200, fmt(row))
            if cid:
                cur.execute(
                    "SELECT id, name, cpu_type, gpu_type, pin_colors, client_token, created_at, updated_at FROM cable_configs WHERE id = %s",
                    (cid,)
                )
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                return resp(200, fmt(row))
            cur.execute(
                "SELECT id, name, cpu_type, gpu_type, pin_colors, client_token, created_at, updated_at FROM cable_configs ORDER BY id DESC"
            )
            return resp(200, {"cables": [fmt(r) for r in cur.fetchall()]})

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")
            name = body.get("name", "Набор кабелей")
            cpu_type = body.get("cpu_type", "8-pin")
            gpu_type = body.get("gpu_type", "8-pin")
            pin_colors = json.dumps(body.get("pin_colors", {}), ensure_ascii=False)
            cur.execute(
                "INSERT INTO cable_configs (name, cpu_type, gpu_type, pin_colors) VALUES (%s,%s,%s,%s) RETURNING id",
                (name, cpu_type, gpu_type, pin_colors)
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return resp(201, {"id": new_id, "ok": True})

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            cid = body.get("id")
            pin_colors = json.dumps(body.get("pin_colors", {}), ensure_ascii=False)
            cur.execute(
                "UPDATE cable_configs SET name=%s, cpu_type=%s, gpu_type=%s, pin_colors=%s, updated_at=NOW() WHERE id=%s",
                (body.get("name"), body.get("cpu_type"), body.get("gpu_type"), pin_colors, cid)
            )
            conn.commit()
            return resp(200, {"ok": True})

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            cid = body.get("id")
            if body.get("action") == "generate_client_link":
                token = uuid.uuid4().hex
                cur.execute("UPDATE cable_configs SET client_token=%s, updated_at=NOW() WHERE id=%s", (token, cid))
                conn.commit()
                return resp(200, {"client_token": token})
            if body.get("action") == "revoke_client_link":
                cur.execute("UPDATE cable_configs SET client_token=NULL, updated_at=NOW() WHERE id=%s", (cid,))
                conn.commit()
                return resp(200, {"ok": True})
            return resp(400, {"error": "Неизвестное действие"})

        elif method == "DELETE":
            cid = params.get("id")
            cur.execute("DELETE FROM cable_configs WHERE id=%s", (cid,))
            conn.commit()
            return resp(200, {"ok": True})

    finally:
        cur.close()
        conn.close()

    return resp(405, {"error": "Method not allowed"})
