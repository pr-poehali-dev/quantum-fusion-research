import json
import os
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def handler(event: dict, context) -> dict:
    """Компоненты конфигуратора: GET список по слотам, POST/PUT/PATCH для админа"""
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    }

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")

    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "GET":
            cur.execute(
                """SELECT id, slot, name, brand, price, specs, in_stock, sort_order
                   FROM configurator_components
                   WHERE in_stock = TRUE
                   ORDER BY slot ASC, sort_order ASC"""
            )
            rows = cur.fetchall()
            slots = {}
            for row in rows:
                slot = row[1]
                if slot not in slots:
                    slots[slot] = []
                slots[slot].append({
                    "id": row[0], "slot": row[1], "name": row[2], "brand": row[3],
                    "price": float(row[4]), "specs": row[5] or {}, "in_stock": row[6],
                    "sort_order": row[7]
                })
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"slots": slots})}

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                """INSERT INTO configurator_components (slot, name, brand, price, specs, in_stock, sort_order, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, NOW()) RETURNING id""",
                (
                    body["slot"], body["name"], body.get("brand"),
                    body["price"], json.dumps(body.get("specs", {})),
                    body.get("in_stock", True), body.get("sort_order", 0)
                )
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "ok": True})}

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                """UPDATE configurator_components SET slot=%s, name=%s, brand=%s, price=%s, specs=%s, in_stock=%s, sort_order=%s
                   WHERE id=%s""",
                (
                    body["slot"], body["name"], body.get("brand"),
                    body["price"], json.dumps(body.get("specs", {})),
                    body.get("in_stock", True), body.get("sort_order", 0), body["id"]
                )
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            cur.execute("UPDATE configurator_components SET in_stock=%s WHERE id=%s", (body["in_stock"], body["id"]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}
