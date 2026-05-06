import json
import os
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

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
    Заказы: POST создать, GET список (для админа или для пользователя по сессии), PATCH статус.
    При создании заказа автоматически привязывается к пользователю по X-Session-Id.
    GET ?my=true — вернуть заказы текущего пользователя (для ЛК).
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")

    conn = get_conn()
    cur = conn.cursor()

    def fmt_order(row):
        return {
            "id": row[0], "customer_name": row[1], "customer_phone": row[2],
            "customer_email": row[3], "order_type": row[4], "items": row[5],
            "total": float(row[6]), "comment": row[7], "status": row[8],
            "created_at": row[9].isoformat() if row[9] else None,
            "updated_at": row[10].isoformat() if row[10] else None,
            "user_id": row[11],
        }

    try:
        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            user_id = get_user_by_session(cur, session_id)
            cur.execute(
                """INSERT INTO orders (customer_name, customer_phone, customer_email, order_type,
                   items, total, comment, status, user_id, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 'new', %s, NOW(), NOW()) RETURNING id""",
                (body["customer_name"], body["customer_phone"],
                 body.get("customer_email"), body.get("order_type", "cart"),
                 json.dumps(body["items"]), body["total"],
                 body.get("comment"), user_id)
            )
            order_id = cur.fetchone()[0]

            order_type = body.get("order_type", "cart")
            items = body.get("items") or []
            parts_total = float(body["total"])
            customer = body["customer_name"]

            def is_real_id(v):
                try:
                    return int(str(v)) < 10**9
                except Exception:
                    return False

            if order_type == "pc_build":
                build_name = f"BeGraphics, {order_id:05d}"
                description = f"Заказ ПК #{order_id:05d} от {customer}"
                components = []
                asm_type = "percent"
                asm_fee = round(parts_total * 0.07)
                for it in items:
                    # Если item несёт components (из конфигуратора) — берём их напрямую
                    if it.get("components"):
                        components = it["components"]
                        if not it.get("assembly", True):
                            asm_type = "manual"
                            asm_fee = 0
                    elif it.get("item_type") == "config" and it.get("id") and is_real_id(it["id"]):
                        # Берём компоненты из существующей сборки по id
                        cur.execute("SELECT components, assembly_type, assembly_fee FROM pc_builds WHERE id = %s", (it["id"],))
                        row = cur.fetchone()
                        if row:
                            components = row[0] or []
                            asm_type = row[1] or "percent"
                            asm_fee = float(row[2] or 0)
                    else:
                        components.append({"name": it.get("name", ""), "slot": "other",
                                           "price": it.get("price", 0), "source": "order"})
                cur.execute(
                    """INSERT INTO pc_builds (name, description, components, parts_total, assembly_fee,
                       total_price, assembly_type, status, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, 'client', NOW()) RETURNING id""",
                    (build_name, description, json.dumps(components), parts_total, asm_fee, parts_total, asm_type)
                )
            elif order_type == "parts":
                build_name = f"Заказ комплектующих {order_id:05d}"
                description = f"Заказ комплектующих #{order_id:05d} от {customer}"
                components = []
                for it in items:
                    # Если item несёт components (из конфигуратора без сборки)
                    if it.get("components"):
                        components.extend(it["components"])
                    else:
                        sid = it.get("id") if is_real_id(it.get("id", 0)) else None
                        components.append({"name": it.get("name", ""), "slot": "other",
                                           "price": it.get("price", 0), "source": "catalog",
                                           "source_id": sid, "qty": it.get("quantity", 1)})
                cur.execute(
                    """INSERT INTO pc_builds (name, description, components, parts_total, assembly_fee,
                       total_price, assembly_type, status, created_at)
                       VALUES (%s, %s, %s, %s, 0, %s, 'manual', 'client', NOW()) RETURNING id""",
                    (build_name, description, json.dumps(components), parts_total, parts_total)
                )
            else:
                build_name = f"BeGraphics, {order_id:05d}"
                components = [{"name": it.get("name", ""), "slot": "other",
                               "price": it.get("price", 0), "source": "order", "qty": it.get("quantity", 1)}
                              for it in items]
                cur.execute(
                    """INSERT INTO pc_builds (name, description, components, parts_total, assembly_fee,
                       total_price, assembly_type, status, created_at)
                       VALUES (%s, %s, %s, %s, 0, %s, 'manual', 'client', NOW()) RETURNING id""",
                    (build_name, f"Заказ #{order_id:05d} от {customer}", json.dumps(components), parts_total, parts_total)
                )

            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": order_id, "ok": True})}

        elif method == "GET":
            # Заказы текущего пользователя (для ЛК)
            if params.get("my") == "true":
                user_id = get_user_by_session(cur, session_id)
                if not user_id:
                    return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
                cur.execute(
                    """SELECT id, customer_name, customer_phone, customer_email, order_type,
                              items, total, comment, status, created_at, updated_at, user_id
                       FROM orders WHERE user_id = %s ORDER BY created_at DESC""",
                    (user_id,)
                )
                orders = [fmt_order(r) for r in cur.fetchall()]
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"orders": orders})}

            # Все заказы (для админа)
            status_filter = params.get("status")
            where = "WHERE status = %s" if status_filter else ""
            args = [status_filter] if status_filter else []
            cur.execute(
                f"""SELECT id, customer_name, customer_phone, customer_email, order_type,
                           items, total, comment, status, created_at, updated_at, user_id
                    FROM orders {where} ORDER BY created_at DESC LIMIT 200""",
                args
            )
            orders = [fmt_order(r) for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"orders": orders})}

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            cur.execute("UPDATE orders SET status=%s, updated_at=NOW() WHERE id=%s", (body["status"], body["id"]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}