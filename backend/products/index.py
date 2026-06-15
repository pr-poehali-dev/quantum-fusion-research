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
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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
        # row: id,name,desc,price,old_price,image_url,specs,in_stock,is_featured,sort_order,created_at,stock_qty,image_urls,cat_id,cat_name,cat_slug
        stock_qty = row[11] if len(row) > 11 else 0
        image_urls_raw = row[12] if len(row) > 12 else None
        if isinstance(image_urls_raw, list):
            image_urls = image_urls_raw
        elif image_urls_raw:
            image_urls = image_urls_raw
        else:
            image_urls = [row[5]] if row[5] else []
        return {
            "id": row[0], "name": row[1], "description": row[2],
            "price": float(row[3]), "old_price": float(row[4]) if row[4] else None,
            "image_url": image_urls[0] if image_urls else row[5],
            "image_urls": image_urls,
            "specs": row[6] or {},
            "in_stock": bool(row[7]),
            "stock_qty": stock_qty or 0,
            "is_featured": row[8], "sort_order": row[9],
            "created_at": row[10].isoformat() if row[10] else None,
            "category": {"id": row[13], "name": row[14], "slug": row[15]} if len(row) > 13 and row[13] else None,
            "warehouse_group_id": row[16] if len(row) > 16 else None,
            "avg_cost": float(row[17]) if len(row) > 17 and row[17] else 0,
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
                       WHERE c.slug IN ('cpu','gpu','ram','storage','psu','case','motherboard','cooling','fan')
                       ORDER BY p.in_stock DESC, c.slug ASC, p.sort_order ASC, p.id ASC"""
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
            sel = """SELECT p.id, p.name, p.description, p.price, p.old_price,
                            p.image_url, p.specs, p.in_stock, p.is_featured,
                            p.sort_order, p.created_at,
                            COALESCE((SELECT SUM(s.qty) FROM warehouse_supplies s
                                      JOIN warehouse_groups g ON g.id = s.group_id
                                      WHERE g.product_id = p.id), 0) as stock_qty,
                            p.image_urls,
                            c.id, c.name, c.slug, p.warehouse_group_id,
                            COALESCE((SELECT SUM(s.cost_price * s.qty) / NULLIF(SUM(s.qty), 0)
                                      FROM warehouse_supplies s
                                      JOIN warehouse_groups g ON g.id = s.group_id
                                      WHERE g.product_id = p.id AND s.qty > 0), 0) as avg_cost
                     FROM products p LEFT JOIN categories c ON p.category_id = c.id"""
            if product_id:
                cur.execute(sel + " WHERE p.id = %s", (product_id,))
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
                return {"statusCode": 200, "headers": cors, "body": json.dumps(row_to_product(row))}
            else:
                category_slug = params.get("category")
                featured = params.get("featured")
                search = params.get("search")
                include_archived = params.get("include_archived") == "true"
                where_clauses = []
                args = []
                if not include_archived:
                    where_clauses.append("p.is_archived = FALSE")
                if category_slug:
                    where_clauses.append("c.slug = %s")
                    args.append(category_slug)
                if featured == "true":
                    where_clauses.append("p.is_featured = TRUE")
                if search:
                    where_clauses.append("LOWER(p.name) LIKE %s")
                    args.append(f"%{search.lower()}%")
                where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
                cur.execute(sel + f" {where_sql} ORDER BY p.sort_order ASC, p.id ASC", args)
                rows = cur.fetchall()
                products = []
                for row in rows:
                    products.append(row_to_product(row))
                cur.execute("SELECT id, name, slug, description, sort_order FROM categories ORDER BY sort_order ASC")
                cats = [{"id": r[0], "name": r[1], "slug": r[2], "description": r[3], "sort_order": r[4]} for r in cur.fetchall()]
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"products": products, "categories": cats})}

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")
            image_urls = body.get("image_urls") or ([body["image_url"]] if body.get("image_url") else [])
            image_url = image_urls[0] if image_urls else body.get("image_url")
            in_stock = body.get("in_stock", True)
            cur.execute(
                """INSERT INTO products (category_id, name, description, price, old_price, image_url, image_urls, specs,
                   in_stock, stock_qty, is_featured, sort_order, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()) RETURNING id""",
                (body.get("category_id"), body["name"], body.get("description"),
                 body["price"], body.get("old_price"), image_url,
                 json.dumps(image_urls),
                 json.dumps(body.get("specs", {})),
                 in_stock, 1 if in_stock else 0,
                 body.get("is_featured", False), body.get("sort_order", 0))
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "ok": True})}

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            image_urls = body.get("image_urls") or ([body["image_url"]] if body.get("image_url") else [])
            image_url = image_urls[0] if image_urls else body.get("image_url")
            in_stock = body.get("in_stock", True)
            cur.execute(
                """UPDATE products SET category_id=%s, name=%s, description=%s, price=%s,
                   old_price=%s, image_url=%s, image_urls=%s, specs=%s, in_stock=%s, stock_qty=%s,
                   is_featured=%s, sort_order=%s WHERE id=%s""",
                (body.get("category_id"), body["name"], body.get("description"),
                 body["price"], body.get("old_price"), image_url,
                 json.dumps(image_urls),
                 json.dumps(body.get("specs", {})),
                 in_stock, 1 if in_stock else 0,
                 body.get("is_featured", False), body.get("sort_order", 0), body["id"])
            )
            # синхронизируем цену и название в warehouse_group
            cur.execute(
                "UPDATE warehouse_groups SET price_retail=%s, name=%s, updated_at=NOW() WHERE product_id=%s",
                (body["price"], body["name"], body["id"])
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

        elif method == "DELETE":
            product_id = (event.get("queryStringParameters") or {}).get("id")
            if not product_id:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "id required"})}
            # Архивация вместо физического удаления: товар скрывается, но данные сохраняются
            cur.execute(
                "UPDATE products SET is_archived = TRUE, in_stock = FALSE WHERE id=%s",
                (int(product_id),)
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "archived": True})}

    finally:
        cur.close()
        conn.close()

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}