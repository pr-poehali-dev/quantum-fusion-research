import json
import os
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _validate_required(body: dict):
    """Проверка обязательных полей товара. Возвращает текст ошибки или None.
    Обязательны: цена продажи (price), категория (category_id), название (name).
    Гарантия (warranty_months) необязательна, по умолчанию 0."""
    if not str(body.get("name") or "").strip():
        return "Укажите название товара"
    price = body.get("price")
    try:
        if price is None or str(price) == "" or float(price) < 0:
            return "Укажите цену продажи"
    except (TypeError, ValueError):
        return "Цена продажи указана неверно"
    if not body.get("category_id"):
        return "Выберите категорию"
    return None


def _apply_vat(base: float, vat: bool) -> float:
    """Цена продажи с НДС: +22% и округление вверх до 250 ₽ (как на фронте)."""
    import math
    if vat:
        return math.ceil(base * 1.22 / 250.0) * 250
    return base


def _recalc_builds_for_product(cur, product_id: int, new_price: float) -> int:
    """Пересчитывает цены ПРОДАЖНЫХ сборок, в которых есть данный товар.
    Обновляет components[].price (для всех позиций slot=catalog с source_id=product_id),
    parts_total и total_price (= железо + сборка, +НДС если sell_with_vat).

    НЕ трогаем сборки из наличия (in_stock=TRUE) и архивные (status='archive').
    Возвращает количество обновлённых сборок.
    """
    cur.execute(
        """SELECT id, components, assembly_fee, sell_with_vat
           FROM pc_builds
           WHERE COALESCE(in_stock, FALSE) = FALSE
             AND COALESCE(status, '') <> 'archive'
             AND components::text LIKE %s""",
        ('%"source_id": ' + str(int(product_id)) + '%',)
    )
    rows = cur.fetchall()
    updated = 0
    for build_id, components, assembly_fee, sell_with_vat in rows:
        comps = components if isinstance(components, list) else json.loads(components or "[]")
        changed = False
        for c in comps:
            if c.get("source") == "catalog" and int(c.get("source_id") or 0) == int(product_id):
                if float(c.get("price") or 0) != float(new_price):
                    c["price"] = float(new_price)
                    changed = True
        if not changed:
            continue
        parts_total = sum(float(c.get("price") or 0) * int(c.get("qty") or 1) for c in comps)
        fee = float(assembly_fee or 0)
        total_price = _apply_vat(parts_total + fee, bool(sell_with_vat))
        cur.execute(
            "UPDATE pc_builds SET components=%s, parts_total=%s, total_price=%s WHERE id=%s",
            (json.dumps(comps), parts_total, total_price, build_id)
        )
        updated += 1
    return updated


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
            "is_archived": bool(row[18]) if len(row) > 18 else False,
            "is_used": bool(row[19]) if len(row) > 19 else False,
            "warranty_months": int(row[20]) if len(row) > 20 and row[20] is not None else 0,
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
                         AND p.is_archived = FALSE
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
                                      WHERE g.product_id = p.id AND s.qty > 0), 0) as avg_cost,
                            p.is_archived, p.is_used, p.warranty_months
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
            # Обязательные поля: цена продажи и категория (гарантия по умолч. 0)
            err = _validate_required(body)
            if err:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": err})}
            image_urls = body.get("image_urls") or ([body["image_url"]] if body.get("image_url") else [])
            image_url = image_urls[0] if image_urls else body.get("image_url")
            in_stock = body.get("in_stock", True)
            warranty = int(body.get("warranty_months") or 0)
            cur.execute(
                """INSERT INTO products (category_id, name, description, price, old_price, image_url, image_urls, specs,
                   in_stock, stock_qty, is_featured, sort_order, is_used, warranty_months, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()) RETURNING id""",
                (body.get("category_id"), body["name"], body.get("description"),
                 body["price"], body.get("old_price"), image_url,
                 json.dumps(image_urls),
                 json.dumps(body.get("specs", {})),
                 in_stock, 1 if in_stock else 0,
                 body.get("is_featured", False), body.get("sort_order", 0),
                 body.get("is_used", False), warranty)
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "ok": True})}

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            err = _validate_required(body)
            if err:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": err})}
            image_urls = body.get("image_urls") or ([body["image_url"]] if body.get("image_url") else [])
            image_url = image_urls[0] if image_urls else body.get("image_url")
            in_stock = body.get("in_stock", True)
            warranty = int(body.get("warranty_months") or 0)
            cur.execute(
                """UPDATE products SET category_id=%s, name=%s, description=%s, price=%s,
                   old_price=%s, image_url=%s, image_urls=%s, specs=%s, in_stock=%s, stock_qty=%s,
                   is_featured=%s, sort_order=%s, is_used=%s, warranty_months=%s WHERE id=%s""",
                (body.get("category_id"), body["name"], body.get("description"),
                 body["price"], body.get("old_price"), image_url,
                 json.dumps(image_urls),
                 json.dumps(body.get("specs", {})),
                 in_stock, 1 if in_stock else 0,
                 body.get("is_featured", False), body.get("sort_order", 0),
                 body.get("is_used", False), warranty, body["id"])
            )
            # синхронизируем цену, название и гарантию в warehouse_group
            cur.execute(
                "UPDATE warehouse_groups SET price_retail=%s, name=%s, warranty_months=%s, updated_at=NOW() WHERE product_id=%s",
                (body["price"], body["name"], warranty, body["id"])
            )
            # Каскадный пересчёт продажных сборок с этим товаром (наличие не трогаем)
            recalc_builds = _recalc_builds_for_product(cur, int(body["id"]), float(body["price"]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "recalc_builds": recalc_builds})}

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            # Восстановление товара из архива
            if body.get("action") == "restore":
                cur.execute(
                    "UPDATE products SET is_archived = FALSE WHERE id=%s",
                    (int(body["id"]),)
                )
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "restored": True})}
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