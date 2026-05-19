import json
import os
import random
import string
import psycopg2
from datetime import date, datetime

SCHEMA = "t_p72635010_quantum_fusion_resea"
cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token, X-Session-Id",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def esc(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def serial(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    return str(obj)


def gen_sku():
    letters = "".join(random.choices(string.ascii_uppercase, k=4))
    digits = "".join(random.choices(string.digits, k=4))
    return letters + digits


def fmt_group(row):
    return {
        "id": row[0], "product_id": row[1], "name": row[2], "sku": row[3],
        "category": row[4], "part_number": row[5], "warranty_months": row[6],
        "price_retail": float(row[7]) if row[7] else 0,
        "price_opt1": float(row[8]) if row[8] else 0,
        "price_opt2": float(row[9]) if row[9] else 0,
        "url_site": row[10], "url_supplier": row[11], "is_archived": row[12],
        "created_at": serial(row[13]), "updated_at": serial(row[14]),
        "qty_total": int(row[15]) if row[15] else 0,
        "qty_reserved": int(row[16]) if row[16] else 0,
        "avg_cost": float(row[17]) if row[17] else 0,
        "cell": row[18] if len(row) > 18 else None,
    }


def fmt_supply(row):
    return {
        "id": row[0], "group_id": row[1], "store_id": row[2], "store_name": row[3],
        "store_code": row[4], "qty": row[5], "qty_reserved": row[6],
        "cost_price": float(row[7]) if row[7] else 0,
        "cell": row[8], "purchase_date": serial(row[9]) if row[9] else None,
        "warranty_until": serial(row[10]) if row[10] else None,
        "created_at": serial(row[11]),
    }


def fmt_store(row):
    return {"id": row[0], "name": row[1], "code": row[2], "created_at": serial(row[3])}


def fmt_movement(row):
    return {
        "id": row[0], "group_id": row[1], "group_name": row[2],
        "supply_id": row[3], "order_id": row[4], "user_id": row[5],
        "type": row[6], "qty_delta": row[7],
        "cost_price": float(row[8]) if row[8] else None,
        "sale_price": float(row[9]) if row[9] else None,
        "margin": float(row[10]) if row[10] else None,
        "note": row[11], "created_at": serial(row[12]),
    }


def log_movement(cur, group_id, supply_id, order_id, user_id, mtype, qty_delta,
                 cost_price=None, sale_price=None, margin=None, note=None):
    cur.execute(
        f"INSERT INTO {SCHEMA}.warehouse_movements "
        f"(group_id, supply_id, order_id, user_id, type, qty_delta, cost_price, sale_price, margin, note) "
        f"VALUES ({group_id or 'NULL'}, {supply_id or 'NULL'}, {order_id or 'NULL'}, "
        f"{user_id or 'NULL'}, {esc(mtype)}, {qty_delta}, "
        f"{'NULL' if cost_price is None else cost_price}, "
        f"{'NULL' if sale_price is None else sale_price}, "
        f"{'NULL' if margin is None else margin}, "
        f"{'NULL' if note is None else esc(note)})"
    )


def calc_avg_cost(cur, group_id):
    cur.execute(
        f"SELECT COALESCE(SUM(cost_price * qty) / NULLIF(SUM(qty), 0), 0) "
        f"FROM {SCHEMA}.warehouse_supplies WHERE group_id = {group_id} AND qty > 0"
    )
    row = cur.fetchone()
    return float(row[0]) if row[0] else 0


def handler(event: dict, context) -> dict:
    """Управление складом: группы, поставки, магазины, движения, инвентаризация."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    body = {}
    if event.get("body"):
        body = json.loads(event["body"])

    action = params.get("action") or body.get("action", "")
    conn = get_conn()
    cur = conn.cursor()

    try:
        # ── МАГАЗИНЫ ──────────────────────────────────────────────────────────
        if action == "stores" and method == "GET":
            cur.execute(f"SELECT id, name, code, created_at FROM {SCHEMA}.warehouse_stores ORDER BY name")
            stores = [fmt_store(r) for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps(stores)}

        if action == "store_create" and method == "POST":
            name = body.get("name", "").strip()
            code = str(body.get("code", "")).strip().upper()
            if not name or len(code) != 3:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Название и 3-значный код обязательны"})}
            cur.execute(f"INSERT INTO {SCHEMA}.warehouse_stores (name, code) VALUES ({esc(name)}, {esc(code)}) RETURNING id, name, code, created_at")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps(fmt_store(cur.fetchone()))}

        if action == "store_update" and method == "PUT":
            sid = body.get("id")
            name = body.get("name", "").strip()
            code = str(body.get("code", "")).strip().upper()
            cur.execute(f"UPDATE {SCHEMA}.warehouse_stores SET name={esc(name)}, code={esc(code)} WHERE id={sid} RETURNING id, name, code, created_at")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps(fmt_store(cur.fetchone()))}

        # ── ГРУППЫ ────────────────────────────────────────────────────────────
        if action == "groups" and method == "GET":
            search = params.get("search", "")
            category = params.get("category", "")
            archived = params.get("archived", "false")
            limit = int(params.get("limit", 50))
            offset = int(params.get("offset", 0))

            where = [f"g.is_archived = {'TRUE' if archived == 'true' else 'FALSE'}"]
            if search:
                where.append(f"(LOWER(g.name) LIKE LOWER('%{search}%') OR g.sku LIKE UPPER('%{search}%') OR g.part_number ILIKE '%{search}%')")
            if category:
                where.append(f"g.category = {esc(category)}")
            where_sql = "WHERE " + " AND ".join(where)

            cur.execute(
                f"SELECT g.id, g.product_id, g.name, g.sku, g.category, g.part_number, "
                f"g.warranty_months, g.price_retail, g.price_opt1, g.price_opt2, "
                f"g.url_site, g.url_supplier, g.is_archived, g.created_at, g.updated_at, "
                f"COALESCE(SUM(s.qty), COALESCE(p.stock_qty, 0)) as qty_total, "
                f"COALESCE(SUM(s.qty_reserved), 0) as qty_reserved, "
                f"COALESCE(SUM(s.cost_price * s.qty) / NULLIF(SUM(s.qty), 0), 0) as avg_cost, "
                f"g.cell "
                f"FROM {SCHEMA}.warehouse_groups g "
                f"LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id "
                f"LEFT JOIN {SCHEMA}.products p ON p.id = g.product_id "
                f"{where_sql} GROUP BY g.id, p.stock_qty ORDER BY g.name LIMIT {limit} OFFSET {offset}"
            )
            groups = [fmt_group(r) for r in cur.fetchall()]

            cur.execute(
                f"SELECT COUNT(*) FROM {SCHEMA}.warehouse_groups g {where_sql}"
            )
            total = cur.fetchone()[0]

            # история цен за 7 дней для каждой группы
            if groups:
                gids = ",".join(str(g["id"]) for g in groups)
                cur.execute(
                    f"SELECT group_id, price_retail, avg_cost, recorded_at "
                    f"FROM {SCHEMA}.warehouse_price_history "
                    f"WHERE group_id IN ({gids}) AND recorded_at >= NOW() - INTERVAL '7 days' "
                    f"ORDER BY recorded_at ASC"
                )
                ph_rows = cur.fetchall()
                ph_map = {}
                for r in ph_rows:
                    gid = r[0]
                    if gid not in ph_map:
                        ph_map[gid] = []
                    ph_map[gid].append({"price_retail": float(r[1]) if r[1] else 0, "avg_cost": float(r[2]) if r[2] else 0, "recorded_at": serial(r[3])})
                for g in groups:
                    g["price_history"] = ph_map.get(g["id"], [])

            return {"statusCode": 200, "headers": cors, "body": json.dumps({"groups": groups, "total": total})}

        if action == "group_get" and method == "GET":
            gid = params.get("id")
            cur.execute(
                f"SELECT g.id, g.product_id, g.name, g.sku, g.category, g.part_number, "
                f"g.warranty_months, g.price_retail, g.price_opt1, g.price_opt2, "
                f"g.url_site, g.url_supplier, g.is_archived, g.created_at, g.updated_at, "
                f"COALESCE(SUM(s.qty), 0), COALESCE(SUM(s.qty_reserved), 0), "
                f"COALESCE(SUM(s.cost_price * s.qty) / NULLIF(SUM(s.qty), 0), 0) "
                f"FROM {SCHEMA}.warehouse_groups g "
                f"LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id "
                f"WHERE g.id = {gid} GROUP BY g.id"
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Группа не найдена"})}
            group = fmt_group(row)

            cur.execute(
                f"SELECT s.id, s.group_id, s.store_id, st.name, st.code, s.qty, s.qty_reserved, "
                f"s.cost_price, s.cell, s.purchase_date, s.warranty_until, s.created_at "
                f"FROM {SCHEMA}.warehouse_supplies s "
                f"LEFT JOIN {SCHEMA}.warehouse_stores st ON st.id = s.store_id "
                f"WHERE s.group_id = {gid} ORDER BY s.purchase_date DESC"
            )
            group["supplies"] = [fmt_supply(r) for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps(group)}

        if action == "group_create" and method == "POST":
            name = body.get("name", "").strip()
            if not name:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Название обязательно"})}
            # генерируем уникальный SKU
            sku = gen_sku()
            for _ in range(10):
                cur.execute(f"SELECT id FROM {SCHEMA}.warehouse_groups WHERE sku = {esc(sku)}")
                if not cur.fetchone():
                    break
                sku = gen_sku()

            product_id = body.get("product_id")
            category = body.get("category", "")
            part_number = body.get("part_number", "")
            warranty_months = body.get("warranty_months", 12)
            price_retail = body.get("price_retail", 0)
            price_opt1 = body.get("price_opt1", 0)
            price_opt2 = body.get("price_opt2", 0)
            url_site = body.get("url_site", "")
            url_supplier = body.get("url_supplier", "")

            cell = body.get("cell", "")
            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_groups "
                f"(product_id, name, sku, category, part_number, warranty_months, "
                f"price_retail, price_opt1, price_opt2, url_site, url_supplier, cell) "
                f"VALUES ({product_id or 'NULL'}, {esc(name)}, {esc(sku)}, {esc(category)}, "
                f"{esc(part_number)}, {warranty_months}, {price_retail}, {price_opt1}, {price_opt2}, "
                f"{esc(url_site)}, {esc(url_supplier)}, {esc(cell)}) RETURNING id"
            )
            new_id = cur.fetchone()[0]

            # синхронизируем цену на сайте если привязан product
            if product_id and price_retail:
                cur.execute(f"UPDATE {SCHEMA}.products SET price = {price_retail} WHERE id = {product_id}")

            log_movement(cur, new_id, None, None, None, "group_created", 0, note=f"Создана группа: {name}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"id": new_id, "sku": sku})}

        if action == "group_update" and method == "PUT":
            gid = body.get("id")
            fields = []
            for f in ["name", "category", "part_number", "url_site", "url_supplier", "cell"]:
                if f in body:
                    fields.append(f"{f} = {esc(body[f])}")
            for f in ["warranty_months", "price_retail", "price_opt1", "price_opt2", "product_id"]:
                if f in body:
                    fields.append(f"{f} = {body[f]}")
            if not fields:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нет полей для обновления"})}
            fields.append("updated_at = NOW()")
            cur.execute(f"UPDATE {SCHEMA}.warehouse_groups SET {', '.join(fields)} WHERE id = {gid}")

            # синхронизируем цену на сайте
            if "price_retail" in body:
                cur.execute(
                    f"UPDATE {SCHEMA}.products p SET price = {body['price_retail']} "
                    f"FROM {SCHEMA}.warehouse_groups g WHERE g.id = {gid} AND p.id = g.product_id"
                )
                # пишем в историю цен
                cur.execute(
                    f"SELECT COALESCE(SUM(cost_price * qty) / NULLIF(SUM(qty), 0), 0) "
                    f"FROM {SCHEMA}.warehouse_supplies WHERE group_id = {gid} AND qty > 0"
                )
                avg_cost = float((cur.fetchone() or [0])[0])
                cur.execute(
                    f"INSERT INTO {SCHEMA}.warehouse_price_history (group_id, price_retail, avg_cost) "
                    f"VALUES ({gid}, {body['price_retail']}, {avg_cost})"
                )

            log_movement(cur, gid, None, None, None, "group_updated", 0, note="Обновлена карточка группы")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "group_archive" and method == "PUT":
            gid = body.get("id")
            cur.execute(f"UPDATE {SCHEMA}.warehouse_groups SET is_archived = TRUE, updated_at = NOW() WHERE id = {gid}")
            log_movement(cur, gid, None, None, None, "group_archived", 0, note="Группа архивирована")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── ПОСТАВКИ ──────────────────────────────────────────────────────────
        if action == "supply_create" and method == "POST":
            group_id = body.get("group_id")
            store_id = body.get("store_id")
            qty = int(body.get("qty", 0))
            cost_price = float(body.get("cost_price", 0))
            cell = body.get("cell", "")
            purchase_date = body.get("purchase_date")
            warranty_until = body.get("warranty_until")

            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_supplies "
                f"(group_id, store_id, qty, cost_price, cell, purchase_date, warranty_until) "
                f"VALUES ({group_id}, {store_id or 'NULL'}, {qty}, {cost_price}, "
                f"{esc(cell)}, {esc(purchase_date) if purchase_date else 'NULL'}, "
                f"{esc(warranty_until) if warranty_until else 'NULL'}) RETURNING id"
            )
            supply_id = cur.fetchone()[0]

            avg_cost = calc_avg_cost(cur, group_id)
            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_price_history (group_id, price_retail, avg_cost) "
                f"SELECT {group_id}, price_retail, {avg_cost} FROM {SCHEMA}.warehouse_groups WHERE id = {group_id}"
            )

            log_movement(cur, group_id, supply_id, None, None, "supply_in", qty,
                         cost_price=cost_price, note=f"Приёмка {qty} шт. по {cost_price} ₽")

            # синхронизируем in_stock и stock_qty в products
            cur.execute(
                f"UPDATE {SCHEMA}.products SET "
                f"stock_qty = (SELECT COALESCE(SUM(s2.qty), 0) FROM {SCHEMA}.warehouse_supplies s2 "
                f"  JOIN {SCHEMA}.warehouse_groups g2 ON g2.id = s2.group_id WHERE g2.product_id = products.id), "
                f"in_stock = (SELECT COALESCE(SUM(s2.qty), 0) > 0 FROM {SCHEMA}.warehouse_supplies s2 "
                f"  JOIN {SCHEMA}.warehouse_groups g2 ON g2.id = s2.group_id WHERE g2.product_id = products.id) "
                f"WHERE id = (SELECT product_id FROM {SCHEMA}.warehouse_groups WHERE id = {group_id})"
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"id": supply_id})}

        if action == "supply_update" and method == "PUT":
            sid = body.get("id")
            fields = []
            for f in ["cell"]:
                if f in body:
                    fields.append(f"{f} = {esc(body[f])}")
            for f in ["store_id", "qty", "cost_price"]:
                if f in body:
                    fields.append(f"{f} = {body[f]}")
            for f in ["purchase_date", "warranty_until"]:
                if f in body:
                    fields.append(f"{f} = {esc(body[f]) if body[f] else 'NULL'}")
            if fields:
                fields.append("updated_at = NOW()")
                cur.execute(f"UPDATE {SCHEMA}.warehouse_supplies SET {', '.join(fields)} WHERE id = {sid}")
                cur.execute(f"SELECT group_id FROM {SCHEMA}.warehouse_supplies WHERE id = {sid}")
                gid = cur.fetchone()[0]
                log_movement(cur, gid, sid, None, None, "supply_updated", 0, note="Обновлена поставка")
                cur.execute(
                    f"UPDATE {SCHEMA}.products SET "
                    f"stock_qty = (SELECT COALESCE(SUM(s2.qty), 0) FROM {SCHEMA}.warehouse_supplies s2 "
                    f"  JOIN {SCHEMA}.warehouse_groups g2 ON g2.id = s2.group_id WHERE g2.product_id = products.id), "
                    f"in_stock = (SELECT COALESCE(SUM(s2.qty), 0) > 0 FROM {SCHEMA}.warehouse_supplies s2 "
                    f"  JOIN {SCHEMA}.warehouse_groups g2 ON g2.id = s2.group_id WHERE g2.product_id = products.id) "
                    f"WHERE id = (SELECT product_id FROM {SCHEMA}.warehouse_groups WHERE id = {gid})"
                )
                conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── РЕЗЕРВ / СПИСАНИЕ ─────────────────────────────────────────────────
        if action == "reserve" and method == "POST":
            supply_id = body.get("supply_id")
            qty = int(body.get("qty", 0))
            order_id = body.get("order_id")
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies SET qty_reserved = qty_reserved + {qty} "
                f"WHERE id = {supply_id} AND qty - qty_reserved >= {qty} RETURNING group_id"
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Недостаточно свободного остатка"})}
            log_movement(cur, row[0], supply_id, order_id, None, "reserved", qty, note=f"Резерв {qty} шт.")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "unreserve" and method == "POST":
            supply_id = body.get("supply_id")
            qty = int(body.get("qty", 0))
            order_id = body.get("order_id")
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies SET qty_reserved = GREATEST(0, qty_reserved - {qty}) "
                f"WHERE id = {supply_id} RETURNING group_id"
            )
            row = cur.fetchone()
            if row:
                log_movement(cur, row[0], supply_id, order_id, None, "unreserved", -qty, note=f"Снят резерв {qty} шт.")
                conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "writeoff" and method == "POST":
            supply_id = body.get("supply_id")
            qty = int(body.get("qty", 0))
            sale_price = float(body.get("sale_price", 0))
            order_id = body.get("order_id")
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies "
                f"SET qty = qty - {qty}, qty_reserved = GREATEST(0, qty_reserved - {qty}), updated_at = NOW() "
                f"WHERE id = {supply_id} AND qty >= {qty} RETURNING group_id, cost_price"
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Недостаточно товара для списания"})}
            group_id, cost_price = row[0], float(row[1]) if row[1] else 0
            margin = (sale_price - cost_price) * qty if sale_price else None
            log_movement(cur, group_id, supply_id, order_id, None, "writeoff", -qty,
                         cost_price=cost_price, sale_price=sale_price, margin=margin,
                         note=f"Списание {qty} шт.")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── ИСТОРИЯ ДВИЖЕНИЙ ──────────────────────────────────────────────────
        if action == "movements" and method == "GET":
            gid = params.get("group_id")
            limit = int(params.get("limit", 50))
            offset = int(params.get("offset", 0))
            where = f"WHERE m.group_id = {gid}" if gid else ""
            cur.execute(
                f"SELECT m.id, m.group_id, g.name, m.supply_id, m.order_id, m.user_id, "
                f"m.type, m.qty_delta, m.cost_price, m.sale_price, m.margin, m.note, m.created_at "
                f"FROM {SCHEMA}.warehouse_movements m "
                f"LEFT JOIN {SCHEMA}.warehouse_groups g ON g.id = m.group_id "
                f"{where} ORDER BY m.created_at DESC LIMIT {limit} OFFSET {offset}"
            )
            movements = [fmt_movement(r) for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps(movements)}

        # ── КАТЕГОРИИ ─────────────────────────────────────────────────────────
        if action == "categories" and method == "GET":
            cur.execute(
                f"SELECT DISTINCT category FROM {SCHEMA}.warehouse_groups "
                f"WHERE category IS NOT NULL AND category != '' ORDER BY category"
            )
            cats = [r[0] for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps(cats)}

        # ── ПОИСК ДЛЯ ПРИВЯЗКИ PRODUCT ───────────────────────────────────────
        if action == "search_products" and method == "GET":
            q = params.get("q", "").strip()
            if len(q) < 2:
                return {"statusCode": 200, "headers": cors, "body": json.dumps([])}
            cur.execute(
                f"SELECT p.id, p.name, p.price, c.name as cat_name "
                f"FROM {SCHEMA}.products p "
                f"LEFT JOIN {SCHEMA}.categories c ON c.id = p.category_id "
                f"WHERE LOWER(p.name) LIKE LOWER('%{q}%') LIMIT 20"
            )
            products = [{"id": r[0], "name": r[1], "price": float(r[2]) if r[2] else 0, "category": r[3]} for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps(products)}

        # ── СИНХРОНИЗАЦИЯ: создать группы для всех товаров без группы ─────────
        if action == "sync_products" and method == "POST":
            cur.execute(
                f"SELECT p.id, p.name, p.price, c.name "
                f"FROM {SCHEMA}.products p "
                f"LEFT JOIN {SCHEMA}.categories c ON c.id = p.category_id "
                f"WHERE p.warehouse_group_id IS NULL"
            )
            rows = cur.fetchall()
            created = 0
            for row in rows:
                pid, pname, pprice, pcat = row
                sku = gen_sku()
                for _ in range(20):
                    cur.execute(f"SELECT id FROM {SCHEMA}.warehouse_groups WHERE sku = {esc(sku)}")
                    if not cur.fetchone():
                        break
                    sku = gen_sku()
                cur.execute(
                    f"INSERT INTO {SCHEMA}.warehouse_groups (product_id, name, sku, category, price_retail) "
                    f"VALUES ({pid}, {esc(pname)}, {esc(sku)}, {esc(pcat) if pcat else 'NULL'}, {float(pprice) if pprice else 0}) "
                    f"RETURNING id"
                )
                gid = cur.fetchone()[0]
                cur.execute(f"UPDATE {SCHEMA}.products SET warehouse_group_id = {gid} WHERE id = {pid}")
                created += 1
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"created": created})}

        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": f"Неизвестное действие: {action}"})}

    finally:
        cur.close()
        conn.close()