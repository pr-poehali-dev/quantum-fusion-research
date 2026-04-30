import json
import os
import psycopg2
from datetime import datetime

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def handler(event: dict, context) -> dict:
    """Заказы: POST создать заказ, GET список для админа, PATCH сменить статус"""
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    }

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")

    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                """INSERT INTO orders (customer_name, customer_phone, customer_email, order_type, items, total, comment, status, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 'new', NOW(), NOW()) RETURNING id""",
                (
                    body["customer_name"], body["customer_phone"],
                    body.get("customer_email"), body.get("order_type", "cart"),
                    json.dumps(body["items"]), body["total"],
                    body.get("comment")
                )
            )
            order_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": order_id, "ok": True})}

        elif method == "GET":
            params = event.get("queryStringParameters") or {}
            status_filter = params.get("status")
            where = "WHERE status = %s" if status_filter else ""
            args = [status_filter] if status_filter else []
            cur.execute(
                f"""SELECT id, customer_name, customer_phone, customer_email,
                           order_type, items, total, comment, status, created_at, updated_at
                    FROM orders
                    {where}
                    ORDER BY created_at DESC
                    LIMIT 200""",
                args
            )
            rows = cur.fetchall()
            orders = []
            for row in rows:
                orders.append({
                    "id": row[0], "customer_name": row[1], "customer_phone": row[2],
                    "customer_email": row[3], "order_type": row[4], "items": row[5],
                    "total": float(row[6]), "comment": row[7], "status": row[8],
                    "created_at": row[9].isoformat() if row[9] else None,
                    "updated_at": row[10].isoformat() if row[10] else None
                })
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"orders": orders})}

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                "UPDATE orders SET status=%s, updated_at=NOW() WHERE id=%s",
                (body["status"], body["id"])
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}
