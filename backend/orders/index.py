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

            print(f"ORDER {order_id}: type={order_type}, items={json.dumps(items)}")

            def is_catalog_id(v):
                try:
                    return 0 < int(str(v)) < 10**9
                except Exception:
                    return False

            def extract_components(items_list, with_assembly):
                """Извлечь компоненты из списка items. Приоритет: components в item -> каталог по id -> fallback."""
                result = []
                asm_type = "percent" if with_assembly else "manual"
                asm_fee_val = round(parts_total * 0.07) if with_assembly else 0

                for it in items_list:
                    # Конфигуратор передаёт components прямо в item
                    if it.get("components"):
                        result.extend(it["components"])
                    elif it.get("item_type") == "config" and is_catalog_id(it.get("id")):
                        # Готовая сборка из каталога — берём компоненты из БД
                        cur.execute("SELECT components, assembly_type, assembly_fee FROM pc_builds WHERE id = %s", (it["id"],))
                        row = cur.fetchone()
                        if row and row[0]:
                            result.extend(row[0])
                            asm_type = row[1] or asm_type
                            asm_fee_val = float(row[2] or asm_fee_val)
                        else:
                            result.append({"name": it.get("name", ""), "slot": "other",
                                           "price": it.get("price", 0), "source": "order", "qty": 1})
                    elif it.get("item_type") == "product" and is_catalog_id(it.get("id")):
                        result.append({"name": it.get("name", ""), "slot": "other",
                                       "price": it.get("price", 0), "source": "catalog",
                                       "source_id": it["id"], "qty": it.get("quantity", 1)})
                    else:
                        result.append({"name": it.get("name", ""), "slot": "other",
                                       "price": it.get("price", 0), "source": "order",
                                       "qty": it.get("quantity", 1)})
                return result, asm_type, asm_fee_val

            if order_type == "pc_build":
                build_name = f"BeGraphics, {order_id:05d}"
                description = f"Заказ ПК #{order_id:05d} от {customer}"
                has_assembly = any(it.get("assembly", True) for it in items if it.get("item_type") == "config")
                components, asm_type, asm_fee = extract_components(items, has_assembly)
                cur.execute(
                    """INSERT INTO pc_builds (name, description, components, parts_total, assembly_fee,
                       total_price, assembly_type, status, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, 'client', NOW()) RETURNING id""",
                    (build_name, description, json.dumps(components), parts_total, asm_fee, parts_total, asm_type)
                )
            elif order_type == "parts":
                build_name = f"Заказ комплектующих {order_id:05d}"
                description = f"Заказ комплектующих #{order_id:05d} от {customer}"
                components, _, _ = extract_components(items, False)
                cur.execute(
                    """INSERT INTO pc_builds (name, description, components, parts_total, assembly_fee,
                       total_price, assembly_type, status, created_at)
                       VALUES (%s, %s, %s, %s, 0, %s, 'manual', 'client', NOW()) RETURNING id""",
                    (build_name, description, json.dumps(components), parts_total, parts_total)
                )
            else:
                build_name = f"BeGraphics, {order_id:05d}"
                components, _, _ = extract_components(items, False)
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