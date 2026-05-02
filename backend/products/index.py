import json
import os
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def handler(event: dict, context) -> dict:
    """
    Товары и компоненты конфигуратора.
    in_stock вычисляется автоматически: stock_qty > 0.

    Товары (products):
      GET /            — список (params: category, featured, search)
      GET /{id}        — один товар
      POST /           — создать
      PUT /            — обновить
      PATCH /          — обновить stock_qty

    Компоненты конфигуратора (configurator_components):
      GET /slots       — все слоты для конфигуратора
      POST /slots      — создать компонент
      PUT /slots       — обновить компонент
      PATCH /slots     — обновить stock_qty компонента
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    # is_slots определяется через query-параметр (путь /slots не поддерживается функциями)
    is_slots = params.get("resource") == "slots"
    product_id = params.get("id")

    conn = get_conn()
    cur = conn.cursor()

    def row_to_product(row):
        stock_qty = row[12] if len(row) > 12 else 0
        return {
            "id": row[0], "name": row[1], "description": row[2],
            "price": float(row[3]), "old_price": float(row[4]) if row[4] else None,
            "image_url": row[5], "specs": row[6] or {},
            "in_stock": (stock_qty > 0),
            "stock_qty": stock_qty,
            "is_featured": row[8], "sort_order": row[9],
            "created_at": row[10].isoformat() if row[10] else None,
            "category": {"id": row[11], "name": row[12 if len(row) <= 13 else 13], "slug": row[14 if len(row) > 14 else 13]} if len(row) > 13 and row[13] else None
        }

    try:
        # ── CONFIGURATOR SLOTS ──
        if is_slots:
            if method == "GET":
                schema = "t_p72635010_quantum_fusion_resea"
                # Берём товары из products, используя category.slug как слот
                cur.execute(
                    f"""SELECT p.id, c.slug, p.name, c.name, p.price, p.specs, p.stock_qty, p.sort_order
                       FROM {schema}.products p
                       JOIN {schema}.categories c ON p.category_id = c.id
                       WHERE c.slug IN ('cpu','gpu','ram','storage','psu','case','motherboard')
                         AND p.in_stock = TRUE
                       ORDER BY c.slug ASC, p.sort_order ASC, p.id ASC"""
                )
                rows = cur.fetchall()
                slots = {}
                for row in rows:
                    slot = row[1]
                    if slot not in slots:
                        slots[slot] = []
                    stock_qty = row[6] or 0
                    slots[slot].append({
                        "id": row[0], "slot": slot, "name": row[2], "brand": row[3],
                        "price": float(row[4]), "specs": row[5] or {},
                        "in_stock": stock_qty > 0,
                        "stock_qty": stock_qty,
                        "sort_order": row[7],
                    })
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"slots": slots})}

            elif method == "POST":
                body = json.loads(event.get("body") or "{}")
                stock_qty = body.get("stock_qty", 0)
                cur.execute(
                    """INSERT INTO configurator_components (slot, name, brand, price, specs, in_stock, stock_qty, sort_order, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW()) RETURNING id""",
                    (body["slot"], body["name"], body.get("brand"), body["price"],
                     json.dumps(body.get("specs", {})), stock_qty > 0, stock_qty, body.get("sort_order", 0))
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "ok": True})}

            elif method == "PUT":
                body = json.loads(event.get("body") or "{}")
                stock_qty = body.get("stock_qty", 0)
                cur.execute(
                    """UPDATE configurator_components
                       SET slot=%s, name=%s, brand=%s, price=%s, specs=%s, in_stock=%s, stock_qty=%s, sort_order=%s
                       WHERE id=%s""",
                    (body["slot"], body["name"], body.get("brand"), body["price"],
                     json.dumps(body.get("specs", {})), stock_qty > 0, stock_qty, body.get("sort_order", 0), body["id"])
                )
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

            elif method == "PATCH":
                body = json.loads(event.get("body") or "{}")
                stock_qty = body.get("stock_qty", 0)
                cur.execute(
                    "UPDATE configurator_components SET stock_qty=%s, in_stock=%s WHERE id=%s",
                    (stock_qty, stock_qty > 0, body["id"])
                )
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── PRODUCTS ──
        elif method == "GET":
            if product_id:
                cur.execute(
                    """SELECT p.id, p.name, p.description, p.price, p.old_price,
                              p.image_url, p.specs, p.in_stock, p.is_featured,
                              p.sort_order, p.created_at, p.stock_qty,
                              c.id, c.name, c.slug
                       FROM products p LEFT JOIN categories c ON p.category_id = c.id
                       WHERE p.id = %s""",
                    (product_id,)
                )
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
                stock_qty = row[11] or 0
                product = {
                    "id": row[0], "name": row[1], "description": row[2],
                    "price": float(row[3]), "old_price": float(row[4]) if row[4] else None,
                    "image_url": row[5], "specs": row[6] or {},
                    "in_stock": stock_qty > 0,
                    "stock_qty": stock_qty,
                    "is_featured": row[8], "sort_order": row[9],
                    "created_at": row[10].isoformat() if row[10] else None,
                    "category": {"id": row[12], "name": row[13], "slug": row[14]} if row[12] else None
                }
                return {"statusCode": 200, "headers": cors, "body": json.dumps(product)}
            else:
                category_slug = params.get("category")
                featured = params.get("featured")
                search = params.get("search")
                where_clauses = []
                args = []
                if category_slug:
                    where_clauses.append("c.slug = %s")
                    args.append(category_slug)
                if featured == "true":
                    where_clauses.append("p.is_featured = TRUE")
                if search:
                    where_clauses.append("LOWER(p.name) LIKE %s")
                    args.append(f"%{search.lower()}%")
                where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
                cur.execute(
                    f"""SELECT p.id, p.name, p.description, p.price, p.old_price,
                               p.image_url, p.specs, p.in_stock, p.is_featured,
                               p.sort_order, p.created_at, p.stock_qty,
                               c.id, c.name, c.slug
                        FROM products p LEFT JOIN categories c ON p.category_id = c.id
                        {where_sql}
                        ORDER BY p.sort_order ASC, p.id ASC""",
                    args
                )
                rows = cur.fetchall()
                products = []
                for row in rows:
                    stock_qty = row[11] or 0
                    products.append({
                        "id": row[0], "name": row[1], "description": row[2],
                        "price": float(row[3]), "old_price": float(row[4]) if row[4] else None,
                        "image_url": row[5], "specs": row[6] or {},
                        "in_stock": stock_qty > 0,
                        "stock_qty": stock_qty,
                        "is_featured": row[8], "sort_order": row[9],
                        "created_at": row[10].isoformat() if row[10] else None,
                        "category": {"id": row[12], "name": row[13], "slug": row[14]} if row[12] else None
                    })
                cur.execute("SELECT id, name, slug, description, sort_order FROM categories ORDER BY sort_order ASC")
                cats = [{"id": r[0], "name": r[1], "slug": r[2], "description": r[3], "sort_order": r[4]} for r in cur.fetchall()]
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"products": products, "categories": cats})}

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")
            stock_qty = body.get("stock_qty", 0)
            cur.execute(
                """INSERT INTO products (category_id, name, description, price, old_price, image_url, specs,
                   in_stock, stock_qty, is_featured, sort_order, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()) RETURNING id""",
                (body.get("category_id"), body["name"], body.get("description"),
                 body["price"], body.get("old_price"), body.get("image_url"),
                 json.dumps(body.get("specs", {})),
                 stock_qty > 0, stock_qty,
                 body.get("is_featured", False), body.get("sort_order", 0))
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "ok": True})}

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            stock_qty = body.get("stock_qty", 0)
            cur.execute(
                """UPDATE products SET category_id=%s, name=%s, description=%s, price=%s,
                   old_price=%s, image_url=%s, specs=%s, in_stock=%s, stock_qty=%s,
                   is_featured=%s, sort_order=%s WHERE id=%s""",
                (body.get("category_id"), body["name"], body.get("description"),
                 body["price"], body.get("old_price"), body.get("image_url"),
                 json.dumps(body.get("specs", {})),
                 stock_qty > 0, stock_qty,
                 body.get("is_featured", False), body.get("sort_order", 0), body["id"])
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            stock_qty = body.get("stock_qty", 0)
            cur.execute(
                "UPDATE products SET stock_qty=%s, in_stock=%s WHERE id=%s",
                (stock_qty, stock_qty > 0, body["id"])
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}