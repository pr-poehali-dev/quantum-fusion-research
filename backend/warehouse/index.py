import json
import os
import random
import string
import urllib.request
import psycopg2
from datetime import date, datetime

# URL функции finance (для авто-расходов «Закупка товара»).
# finance имеет права на finance_* таблицы, warehouse — нет.
FINANCE_URL = "https://functions.poehali.dev/c96c7960-8abb-43f1-bdf1-191c8f3250fc"


def notify_finance_supply_expense(store_id=None, exp_date=None):
    """Просит функцию finance пересчитать авто-расход «Закупка товара».
    Без store_id/date — пересчёт всех групп. Ошибки не критичны для приёмки."""
    payload = {"action": "sync_supply_expense"}
    if store_id is not None:
        payload["store_id"] = int(store_id)
    if exp_date is not None:
        payload["date"] = str(exp_date)
    try:
        req = urllib.request.Request(
            FINANCE_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10).read()
    except Exception:
        pass  # приёмку не блокируем, расход можно пересчитать кнопкой

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


def get_setting_num(cur, key, default=0.0):
    """Читает числовую настройку из app_settings."""
    cur.execute(f"SELECT value FROM {SCHEMA}.app_settings WHERE key = {esc(key)}")
    r = cur.fetchone()
    if not r:
        return float(default)
    try:
        return float(r[0])
    except (ValueError, TypeError):
        return float(default)


# Слоты компонентов WIP-сборки: поле названия → поле статуса
WIP_SLOTS = [
    ("cpu", "cpu_status"), ("gpu", "gpu_status"), ("ram", "ram_status"),
    ("storage", "storage_status"), ("psu", "psu_status"),
    ("case_name", "case_status"), ("motherboard", "motherboard_status"),
    ("cooling", "cooling_status"),
]


def _set_wip_component_ready(cur, order_id, prod_name):
    """
    Товар поступил и погасил минус-резерв заказа → переводим соответствующий
    компонент в WIP-сборке заказа в статус 'ready' (получено/в наличии).
    Компонент ищем по совпадению названия товара со слотом сборки.
    Также чистим дату ETA по этому слоту, чтобы не висел «заказан/едет».
    """
    cur.execute(
        f"SELECT id, cpu, gpu, ram, storage, psu, case_name, motherboard, cooling "
        f"FROM {SCHEMA}.wip_builds WHERE order_id = %s",
        (order_id,),
    )
    for row in cur.fetchall():
        wip_id = row[0]
        names = {
            "cpu": row[1], "gpu": row[2], "ram": row[3], "storage": row[4],
            "psu": row[5], "case_name": row[6], "motherboard": row[7], "cooling": row[8],
        }
        for name_field, status_field in WIP_SLOTS:
            val = names.get(name_field)
            if val and val.strip().lower() == (prod_name or "").strip().lower():
                slot = "case" if name_field == "case_name" else name_field
                cur.execute(
                    f"UPDATE {SCHEMA}.wip_builds SET {status_field} = 'ready', updated_at = NOW() "
                    f"WHERE id = %s AND {status_field} <> 'ready'",
                    (wip_id,),
                )
                cur.execute(
                    f"DELETE FROM {SCHEMA}.wip_component_eta WHERE wip_id = %s AND slot = %s",
                    (wip_id, slot),
                )


# Все слоты WIP с учётом extra (для пересчёта этапа)
_STAGE_SLOTS = WIP_SLOTS + [("extra", "extra_status")]
_ORDERED = ("ordered_transit", "ordered_delay", "need_order")


def _recompute_wip_stage(cur, order_id):
    """
    Пересчёт этапа сборки по статусам железок после приёмки товара:
      • все заполненные слоты ready/pending → 'Ожидание сборки' (всё приехало)
      • есть хотя бы один заказанный/в пути → 'Ожидание железа'
    Переход только из рабочих этапов. Синхронизирует orders.status.
    """
    cur.execute(
        f"SELECT id, stage, cpu, gpu, ram, storage, psu, case_name, motherboard, cooling, extra, "
        f"cpu_status, gpu_status, ram_status, storage_status, psu_status, case_status, "
        f"motherboard_status, cooling_status, extra_status "
        f"FROM {SCHEMA}.wip_builds WHERE order_id = %s",
        (order_id,),
    )
    for row in cur.fetchall():
        wip_id, stage = row[0], row[1]
        if stage not in ("Заказ", "Ожидание железа", "Ожидание сборки"):
            continue
        names = row[2:11]
        statuses = row[11:20]
        filled = [(nm, st) for nm, st in zip(names, statuses) if nm and str(nm).strip()]
        if not filled:
            continue
        all_ready = all(st in ("ready", "pending") for _, st in filled)
        all_ordered_or_ready = all(st in ("ready", "pending") + _ORDERED for _, st in filled)
        has_ordered = any(st in _ORDERED for _, st in filled)
        new_stage = None
        if all_ready:
            new_stage = "Ожидание сборки"
        elif all_ordered_or_ready and has_ordered:
            new_stage = "Ожидание железа"
        if not new_stage or new_stage == stage:
            continue
        cur.execute(
            f"UPDATE {SCHEMA}.wip_builds SET stage=%s, updated_at=NOW() WHERE id=%s",
            (new_stage, wip_id),
        )
        ostatus = {"Ожидание железа": "ordering", "Ожидание сборки": "waiting_assembly"}.get(new_stage)
        if ostatus:
            cur.execute(
                f"UPDATE {SCHEMA}.orders SET status=%s, updated_at=NOW() WHERE id=%s",
                (ostatus, order_id),
            )


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
        "qty_negative": int(row[19]) if len(row) > 19 and row[19] else 0,
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
                f"g.cell, "
                f"COALESCE(SUM(s.qty_negative), 0) as qty_negative "
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
            price_retail = float(body.get("price_retail") or 0)
            price_opt1 = float(body.get("price_opt1") or 0)
            price_opt2 = float(body.get("price_opt2") or 0)
            url_site = body.get("url_site", "")
            url_supplier = body.get("url_supplier", "")
            cell = body.get("cell", "")

            # Автоматически создаём карточку товара если не привязана
            if not product_id:
                # Ищем category_id по названию категории
                cat_id = None
                if category:
                    cur.execute(
                        f"SELECT id FROM {SCHEMA}.categories WHERE LOWER(name) = LOWER({esc(category)}) LIMIT 1"
                    )
                    cat_row = cur.fetchone()
                    if cat_row:
                        cat_id = cat_row[0]

                cur.execute(
                    f"INSERT INTO {SCHEMA}.products (name, category_id, price, in_stock, created_at) "
                    f"VALUES ({esc(name)}, {cat_id if cat_id else 'NULL'}, {price_retail or 0}, FALSE, NOW()) "
                    f"RETURNING id"
                )
                product_id = cur.fetchone()[0]

            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_groups "
                f"(product_id, name, sku, category, part_number, warranty_months, "
                f"price_retail, price_opt1, price_opt2, url_site, url_supplier, cell) "
                f"VALUES ({product_id or 'NULL'}, {esc(name)}, {esc(sku)}, {esc(category)}, "
                f"{esc(part_number)}, {warranty_months}, {price_retail}, {price_opt1}, {price_opt2}, "
                f"{esc(url_site)}, {esc(url_supplier)}, {esc(cell)}) RETURNING id"
            )
            new_id = cur.fetchone()[0]

            # Обновляем product.warehouse_group_id
            cur.execute(f"UPDATE {SCHEMA}.products SET warehouse_group_id = {new_id} WHERE id = {product_id}")

            # Синхронизируем цену
            if price_retail:
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

        if action == "category_rename" and method == "PUT":
            old_name = body.get("old_name", "").strip()
            new_name = body.get("new_name", "").strip()
            if not old_name or not new_name:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нужны old_name и new_name"})}
            cur.execute(f"UPDATE {SCHEMA}.warehouse_groups SET category = {esc(new_name)} WHERE category = {esc(old_name)}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "category_delete" and method == "PUT":
            name = body.get("name", "").strip()
            if not name:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нужно name"})}
            cur.execute(f"UPDATE {SCHEMA}.warehouse_groups SET category = NULL WHERE category = {esc(name)}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "group_archive" and method == "PUT":
            gid = body.get("id")
            cur.execute(f"UPDATE {SCHEMA}.warehouse_groups SET is_archived = TRUE, updated_at = NOW() WHERE id = {gid}")
            log_movement(cur, gid, None, None, None, "group_archived", 0, note="Группа архивирована")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "group_unarchive" and method == "PUT":
            gid = int(body.get("id"))
            cur.execute(f"UPDATE {SCHEMA}.warehouse_groups SET is_archived = FALSE, updated_at = NOW() WHERE id = {gid}")
            log_movement(cur, gid, None, None, None, "group_unarchived", 0, note="Группа восстановлена из архива")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── ПОСТАВКИ ──────────────────────────────────────────────────────────
        if action == "supply_create" and method == "POST":
            group_id = body.get("group_id")
            store_id = body.get("store_id")
            qty = int(body.get("qty", 0))
            cell = body.get("cell", "")
            purchase_date = body.get("purchase_date")
            warranty_until = body.get("warranty_until")

            # НДС: фронт шлёт price_with_vat (введённая цена) и has_vat.
            # Себестоимость:
            #   с НДС  → cost_price = цена × (1 − скидка%/100)
            #            (поставщик даёт скидку по текущей ставке)
            #   без НДС → cost_price = введённая цена как есть
            # Поддержка legacy: если пришло только cost_price — берём его.
            has_vat = body.get("has_vat")
            price_with_vat = body.get("price_with_vat")
            if price_with_vat is not None:
                price_in = float(price_with_vat)
            else:
                price_in = float(body.get("cost_price", 0))
            if has_vat is True:
                discount = get_setting_num(cur, "purchase_discount_percent", 0.0)
                cost_price = round(price_in * (1.0 - discount / 100.0), 2)
            else:
                cost_price = round(price_in, 2)

            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_supplies "
                f"(group_id, store_id, qty, cost_price, cell, purchase_date, warranty_until, has_vat, price_with_vat) "
                f"VALUES ({group_id}, {store_id or 'NULL'}, {qty}, {cost_price}, "
                f"{esc(cell)}, {esc(purchase_date) if purchase_date else 'NULL'}, "
                f"{esc(warranty_until) if warranty_until else 'NULL'}, "
                f"{'TRUE' if has_vat is True else 'FALSE' if has_vat is False else 'NULL'}, "
                f"{price_in if price_with_vat is not None else 'NULL'}) RETURNING id"
            )
            supply_id = cur.fetchone()[0]

            # ── Авто-расход офиса при приходе товара ──────────────────────────
            # Обобщается в ОДНО событие расхода на день + магазин. Запись делает
            # функция finance (после commit, см. ниже), т.к. у неё есть права
            # на finance_*; источник истины — сами поставки.
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

            # Получаем product_id и название товара группы
            cur.execute(f"SELECT product_id FROM {SCHEMA}.warehouse_groups WHERE id = {group_id}")
            grp_row = cur.fetchone()
            grp_product_id = grp_row[0] if grp_row else None

            prod_name = "Товар"
            if grp_product_id:
                cur.execute(f"SELECT name FROM {SCHEMA}.products WHERE id = %s", (grp_product_id,))
                prow = cur.fetchone()
                if prow:
                    prod_name = prow[0]

            # Гасим NEGATIVE-резервы FIFO по дате заказа: товар приехал → закрываем
            # минус-резерв, переводим его в POSITIVE под заказ и уведомляем заказчика.
            negative_alerts = []
            affected_orders = []  # заказы, затронутые авто-резервом при поставке
            avail = qty  # сколько из новой поставки можно зарезервировать
            cur.execute(
                f"SELECT r.id, r.order_id, r.supply_id, r.qty, o.user_id, o.customer_name, o.status, r.slot "
                f"FROM {SCHEMA}.warehouse_reserves r "
                f"LEFT JOIN {SCHEMA}.orders o ON o.id = r.order_id "
                f"WHERE r.group_id = {group_id} AND r.type = 'NEGATIVE' AND r.status = 'ACTIVE' "
                f"AND (o.status IS NULL OR o.status NOT IN ('cancelled', 'archived', 'done')) "
                f"ORDER BY (o.created_at IS NULL), o.created_at ASC, r.id ASC "
                f"FOR UPDATE OF r"
            )
            neg_reserves = cur.fetchall()
            fulfilled_by_order = {}  # order_id -> кол-во погашенного
            for (rid, neg_order_id, neg_supply_id, neg_qty, neg_user_id, neg_cust, neg_ostatus, neg_slot) in neg_reserves:
                if avail <= 0:
                    break
                clear = min(neg_qty, avail)
                # Снимаем минус с партии-буфера
                if neg_supply_id:
                    cur.execute(
                        f"UPDATE {SCHEMA}.warehouse_supplies "
                        f"SET qty_negative = GREATEST(0, qty_negative - %s), updated_at = NOW() WHERE id = %s",
                        (clear, neg_supply_id)
                    )
                # Кладём пришедший товар в резерв под заказ
                cur.execute(
                    f"UPDATE {SCHEMA}.warehouse_supplies "
                    f"SET qty = qty - %s, qty_reserved = qty_reserved + %s, updated_at = NOW() WHERE id = %s",
                    (clear, clear, supply_id)
                )
                # Переводим NEGATIVE → POSITIVE (полностью или частично)
                if clear == neg_qty:
                    cur.execute(
                        f"UPDATE {SCHEMA}.warehouse_reserves "
                        f"SET type = 'POSITIVE', status = 'ACTIVE', supply_id = %s, updated_at = NOW() WHERE id = %s",
                        (supply_id, rid)
                    )
                else:
                    cur.execute(
                        f"UPDATE {SCHEMA}.warehouse_reserves SET qty = qty - %s, updated_at = NOW() WHERE id = %s",
                        (clear, rid)
                    )
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.warehouse_reserves "
                        f"(order_id, group_id, supply_id, slot, qty, type, status) "
                        f"SELECT order_id, group_id, %s, slot, %s, 'POSITIVE', 'ACTIVE' "
                        f"FROM {SCHEMA}.warehouse_reserves WHERE id = %s",
                        (supply_id, clear, rid)
                    )
                cur.execute(
                    f"INSERT INTO {SCHEMA}.warehouse_movements "
                    f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
                    f"VALUES (%s, %s, %s, 'fulfilled', %s, %s, NOW())",
                    (group_id, supply_id, neg_order_id, clear,
                     f"Гашение минус-резерва заказа #{neg_order_id} приходом: {prod_name}")
                )
                avail -= clear
                # Товар приехал и погасил долг → статус компонента в WIP = 'ready'
                # (в наличии/получено). Находим WIP заказа и слот по названию товара.
                if neg_order_id:
                    _set_wip_component_ready(cur, neg_order_id, prod_name)
                if neg_order_id:
                    fulfilled_by_order[neg_order_id] = fulfilled_by_order.get(neg_order_id, 0) + clear
                    # Уведомление заказчику, что товар приехал
                    if neg_user_id:
                        link = f"/orders/{neg_order_id}"
                        txt = f"Товар «{prod_name}» поступил на склад и зарезервирован под ваш заказ №{str(neg_order_id).zfill(4)}"
                        cur.execute(
                            f"INSERT INTO {SCHEMA}.notifications (user_id, type, text, link) "
                            f"VALUES (%s, 'order', %s, %s)",
                            (neg_user_id, txt, link)
                        )
                        try:
                            from tg_notify import notify_managers
                            notify_managers(
                                f"📦 <b>Товар приехал под заказ №{str(neg_order_id).zfill(4)}</b>\n"
                                f"«{prod_name}» поступил на склад и зарезервирован."
                            )
                        except Exception as _e:
                            print(f"TG_NOTIFY backorder: {_e}")

            # Если что-то погасили — переводим позицию корзины закупки в 'RECEIVED'
            # (получено). Резервы и корзина независимы, но статус «получено» нужен
            # для контроля закупки.
            if fulfilled_by_order:
                cur.execute(
                    f"UPDATE {SCHEMA}.warehouse_purchase_basket "
                    f"SET status = 'RECEIVED', updated_at = NOW() WHERE group_id = {group_id}"
                )

            for ord_id, cnt in fulfilled_by_order.items():
                negative_alerts.append({"product": prod_name, "reserved": cnt, "orders": [ord_id]})

            # Подчищаем «сиротские» долги в qty_negative без записей в резервах (рассинхрон)
            if avail > 0:
                cur.execute(
                    f"SELECT s.id, s.qty_negative FROM {SCHEMA}.warehouse_supplies s "
                    f"WHERE s.group_id = {group_id} AND s.id != {supply_id} AND s.qty_negative > 0 ORDER BY s.id ASC"
                )
                for (neg_sid, neg_qty) in cur.fetchall():
                    if avail <= 0:
                        break
                    to_clear = min(neg_qty, avail)
                    cur.execute(
                        f"UPDATE {SCHEMA}.warehouse_supplies "
                        f"SET qty_negative = GREATEST(0, qty_negative - %s) WHERE id = %s",
                        (to_clear, neg_sid)
                    )
                    avail -= to_clear

            # Ищем активные wip_builds где компонент ещё не получен (need_order /
            # ordered_transit / ordered_delay — «надо заказать» или «едет/заказано»)
            # и резервируем под них пришедший товар. 'ready' пропускаем — уже получен.
            if grp_product_id and avail > 0:
                pn = prod_name.replace("'", "''")
                NEED = "('need_order','ordered_transit','ordered_delay')"
                cur.execute(f"""
                    SELECT wip_id, order_id, slot FROM (
                        SELECT wb.id as wip_id, wb.order_id,
                            CASE
                                WHEN LOWER(wb.cpu) = LOWER('{pn}') AND wb.cpu_status IN {NEED} THEN 'cpu'
                                WHEN LOWER(wb.gpu) = LOWER('{pn}') AND wb.gpu_status IN {NEED} THEN 'gpu'
                                WHEN LOWER(wb.ram) = LOWER('{pn}') AND wb.ram_status IN {NEED} THEN 'ram'
                                WHEN LOWER(wb.storage) = LOWER('{pn}') AND wb.storage_status IN {NEED} THEN 'storage'
                                WHEN LOWER(wb.psu) = LOWER('{pn}') AND wb.psu_status IN {NEED} THEN 'psu'
                                WHEN LOWER(wb.case_name) = LOWER('{pn}') AND wb.case_status IN {NEED} THEN 'case'
                                WHEN LOWER(wb.motherboard) = LOWER('{pn}') AND wb.motherboard_status IN {NEED} THEN 'motherboard'
                                WHEN LOWER(wb.cooling) = LOWER('{pn}') AND wb.cooling_status IN {NEED} THEN 'cooling'
                                ELSE NULL
                            END as slot
                        FROM {SCHEMA}.wip_builds wb
                        JOIN {SCHEMA}.orders o ON o.id = wb.order_id
                        WHERE o.status NOT IN ('cancelled','done')
                    ) sub WHERE slot IS NOT NULL
                    ORDER BY wip_id ASC
                """)
                wip_rows = cur.fetchall()
                for (wip_id_r, order_id_r, slot_r) in wip_rows:
                    if avail <= 0:
                        break
                    status_field = f"{slot_r}_status"
                    cur.execute(
                        f"UPDATE {SCHEMA}.wip_builds SET {status_field}='ready', updated_at=NOW() WHERE id=%s",
                        (wip_id_r,)
                    )
                    cur.execute(
                        f"UPDATE {SCHEMA}.warehouse_supplies SET qty=qty-1, qty_reserved=qty_reserved+1 WHERE id=%s",
                        (supply_id,)
                    )
                    # Создаём POSITIVE-резерв в таблице резервов (иначе рассинхрон:
                    # qty_reserved растёт, а записи о резерве под заказ нет)
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.warehouse_reserves "
                        f"(order_id, group_id, supply_id, slot, qty, type, status) "
                        f"VALUES (%s, %s, %s, %s, 1, 'POSITIVE', 'ACTIVE')",
                        (order_id_r, group_id, supply_id, slot_r)
                    )
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.warehouse_movements "
                        f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
                        f"VALUES (%s, %s, %s, 'reserved', 1, %s, NOW())",
                        (group_id, supply_id, order_id_r, f"Авторезерв при поставке: {pn}")
                    )
                    affected_orders.append(order_id_r)
                    avail -= 1

                if affected_orders:
                    # Позиция корзины закупки → 'RECEIVED' (получено)
                    cur.execute(
                        f"UPDATE {SCHEMA}.warehouse_purchase_basket "
                        f"SET status = 'RECEIVED', updated_at = NOW() WHERE group_id = {group_id}"
                    )
                    negative_alerts.append({
                        "product": prod_name,
                        "reserved": len(affected_orders),
                        "orders": affected_orders
                    })

            # Пересчёт этапа сборки для всех заказов, которых коснулась приёмка:
            # если все железки приехали → этап «Ожидание сборки» автоматически.
            touched_orders = set(fulfilled_by_order.keys()) | set(affected_orders)
            for oid in touched_orders:
                if oid:
                    _recompute_wip_stage(cur, oid)

            conn.commit()
            # После commit просим finance записать/обновить авто-расход офиса
            # «Закупка товара» за этот день+магазин (у finance есть права).
            notify_finance_supply_expense(store_id, purchase_date)
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "id": supply_id,
                "negative_alerts": negative_alerts
            })}

        if action == "supply_update" and method == "PUT":
            sid = body.get("id")
            # Запоминаем старые магазин+дату поставки (для пересчёта расхода)
            cur.execute(
                f"SELECT store_id, purchase_date FROM {SCHEMA}.warehouse_supplies WHERE id = {int(sid)}"
            )
            old_row = cur.fetchone()
            old_store, old_date = (old_row[0], old_row[1]) if old_row else (None, None)
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
                cur.execute(f"SELECT group_id, store_id, purchase_date FROM {SCHEMA}.warehouse_supplies WHERE id = {sid}")
                grow = cur.fetchone()
                gid, new_store, new_date = grow[0], grow[1], grow[2]
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
                # После commit просим finance пересчитать авто-расход для старой
                # и новой группы день+магазин (источник истины — поставки).
                notify_finance_supply_expense(old_store, old_date)
                if (old_store, old_date) != (new_store, new_date):
                    notify_finance_supply_expense(new_store, new_date)
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

        # ── ЗАКАЗНОЙ СПИСОК: только need_order из активных сборок ────────────────
        if action == "order_list" and method == "GET":
            cur.execute(f"""
                SELECT
                    p.id as product_id,
                    p.name as product_name,
                    wg.id as group_id,
                    wg.sku,
                    wg.url_supplier,
                    wg.url_site,
                    SUM((comp->>'qty')::int) AS need_total,
                    COALESCE((
                        SELECT SUM(m.qty_delta)
                        FROM {SCHEMA}.warehouse_movements m
                        JOIN {SCHEMA}.warehouse_groups mg ON mg.id = m.group_id
                        WHERE mg.product_id = p.id
                          AND m.order_id = o.id
                          AND m.type IN ('reserved','unreserved')
                    ), 0) AS reserved_for_order,
                    o.id as order_id,
                    o.customer_name
                FROM {SCHEMA}.wip_builds wb
                JOIN {SCHEMA}.orders o ON o.id = wb.order_id
                JOIN {SCHEMA}.pc_builds pb ON pb.id = wb.build_id,
                jsonb_array_elements(pb.components::jsonb) comp
                JOIN {SCHEMA}.products p ON p.id = (comp->>'source_id')::int
                JOIN {SCHEMA}.warehouse_groups wg ON wg.product_id = p.id AND wg.is_archived = false
                WHERE o.status NOT IN ('cancelled','done')
                  AND (
                    (LOWER(wb.cpu) = LOWER(p.name) AND wb.cpu_status = 'need_order') OR
                    (LOWER(wb.gpu) = LOWER(p.name) AND wb.gpu_status = 'need_order') OR
                    (LOWER(wb.ram) = LOWER(p.name) AND wb.ram_status = 'need_order') OR
                    (LOWER(wb.storage) = LOWER(p.name) AND wb.storage_status = 'need_order') OR
                    (LOWER(wb.psu) = LOWER(p.name) AND wb.psu_status = 'need_order') OR
                    (LOWER(wb.case_name) = LOWER(p.name) AND wb.case_status = 'need_order') OR
                    (LOWER(wb.motherboard) = LOWER(p.name) AND wb.motherboard_status = 'need_order') OR
                    (LOWER(wb.cooling) = LOWER(p.name) AND wb.cooling_status = 'need_order')
                  )
                GROUP BY p.id, p.name, wg.id, wg.sku, wg.url_supplier, wg.url_site, o.id, o.customer_name
                ORDER BY p.name, o.id
            """)
            rows = cur.fetchall()
            # Группируем по product_id: суммируем shortage по всем заказам
            from collections import defaultdict
            by_product = defaultdict(lambda: {"need_total": 0, "reserved_total": 0, "orders": [], "group_id": None, "sku": None, "url_supplier": None, "url_site": None, "name": None})
            for r in rows:
                pid, pname, gid, sku, url_sup, url_site, need, reserved, oid, cname = r
                shortage = max(0, int(need) - int(reserved))
                if shortage == 0:
                    continue
                by_product[pid]["name"] = pname
                by_product[pid]["group_id"] = gid
                by_product[pid]["sku"] = sku
                by_product[pid]["url_supplier"] = url_sup
                by_product[pid]["url_site"] = url_site
                by_product[pid]["need_total"] += int(need)
                by_product[pid]["reserved_total"] += int(reserved)
                by_product[pid]["orders"].append({"order_id": oid, "customer_name": cname, "shortage": shortage})

            items = []
            for pid, data in by_product.items():
                total_shortage = data["need_total"] - data["reserved_total"]
                if total_shortage <= 0:
                    continue
                items.append({
                    "product_id": pid,
                    "name": data["name"],
                    "group_id": data["group_id"],
                    "sku": data["sku"],
                    "url_supplier": data["url_supplier"],
                    "url_site": data["url_site"],
                    "shortage": total_shortage,
                    "orders": data["orders"],
                })
            items.sort(key=lambda x: x["name"])
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"items": items})}

        # ── РЕЗЕРВЫ ПО ГРУППЕ ─────────────────────────────────────────────────
        if action == "group_reserves" and method == "GET":
            """Возвращает активные резервы и отрицательные резервы по group_id с разбивкой по заказам"""
            gid = params.get("group_id")
            if not gid:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "group_id required"})}

            # Обычные резервы — из новой таблицы warehouse_reserves (с wip_stage)
            cur.execute(
                f"SELECT r.order_id, SUM(r.qty) AS qty, o.customer_name, "
                f"wb.stage AS wip_stage "
                f"FROM {SCHEMA}.warehouse_reserves r "
                f"LEFT JOIN {SCHEMA}.orders o ON o.id = r.order_id "
                f"LEFT JOIN {SCHEMA}.wip_builds wb ON wb.order_id = r.order_id "
                f"WHERE r.group_id = {gid} AND r.type = 'POSITIVE' AND r.status = 'ACTIVE' "
                f"AND r.order_id IS NOT NULL "
                f"AND (o.status IS NULL OR o.status NOT IN ('cancelled', 'done')) "
                f"GROUP BY r.order_id, o.customer_name, wb.stage "
                f"HAVING SUM(r.qty) > 0 "
                f"ORDER BY r.order_id ASC"
            )
            rows = cur.fetchall()
            reserves_new = [{"order_id": r[0], "qty": int(r[1]), "customer_name": r[2], "wip_stage": r[3]} for r in rows]

            # Fallback: старые резервы из movements (до перехода на warehouse_reserves)
            if not reserves_new:
                cur.execute(
                    f"SELECT m.order_id, SUM(m.qty_delta) as qty, o.customer_name, wb.stage "
                    f"FROM {SCHEMA}.warehouse_movements m "
                    f"LEFT JOIN {SCHEMA}.orders o ON o.id = m.order_id "
                    f"LEFT JOIN {SCHEMA}.wip_builds wb ON wb.order_id = m.order_id "
                    f"WHERE m.group_id = {gid} AND m.type IN ('reserved', 'unreserved') AND m.order_id IS NOT NULL "
                    f"AND (o.status IS NULL OR o.status NOT IN ('cancelled', 'done')) "
                    f"GROUP BY m.order_id, o.customer_name, wb.stage "
                    f"HAVING SUM(m.qty_delta) > 0 "
                    f"ORDER BY m.order_id ASC"
                )
                rows = cur.fetchall()
                reserves_new = [{"order_id": r[0], "qty": int(r[1]), "customer_name": r[2], "wip_stage": r[3]} for r in rows]

            reserves = reserves_new

            # Отрицательные резервы — берём прямо из warehouse_reserves (там order_id всегда есть)
            negative_reserves = []
            cur.execute(
                f"SELECT r.order_id, SUM(r.qty) AS qty, o.customer_name "
                f"FROM {SCHEMA}.warehouse_reserves r "
                f"LEFT JOIN {SCHEMA}.orders o ON o.id = r.order_id "
                f"WHERE r.group_id = {gid} AND r.type = 'NEGATIVE' AND r.status = 'ACTIVE' "
                f"AND (o.status IS NULL OR o.status NOT IN ('cancelled', 'done')) "
                f"GROUP BY r.order_id, o.customer_name "
                f"HAVING SUM(r.qty) > 0 "
                f"ORDER BY r.order_id ASC"
            )
            neg_rows = cur.fetchall()
            if neg_rows:
                # SQL: r[0]=order_id, r[1]=qty, r[2]=customer_name
                negative_reserves = [{"order_id": r[0], "qty": int(r[1]), "customer_name": r[2]} for r in neg_rows]
            else:
                # Fallback: если в warehouse_reserves нет записей — берём qty_negative из supplies
                cur.execute(
                    f"SELECT COALESCE(SUM(qty_negative), 0) FROM {SCHEMA}.warehouse_supplies WHERE group_id = {gid}"
                )
                total_neg = int((cur.fetchone() or [0])[0])
                if total_neg > 0:
                    negative_reserves = [{"order_id": None, "customer_name": None, "qty": total_neg}]

            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "reserves": reserves,
                "negative_reserves": negative_reserves,
            })}

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

        # ── ИНВЕНТАРИЗАЦИЯ ────────────────────────────────────────────────────

        if action == "inventory_list" and method == "GET":
            """Список всех инвентаризаций с позициями"""
            cur.execute(
                f"SELECT i.id, i.filter_type, i.filter_value, i.status, i.result_json, "
                f"i.applied_at, i.created_at, COUNT(ii.id) as total_items, "
                f"COUNT(ii.id) FILTER (WHERE ii.qty_actual IS NOT NULL) as filled_items "
                f"FROM {SCHEMA}.warehouse_inventories i "
                f"LEFT JOIN {SCHEMA}.warehouse_inventory_items ii ON ii.inventory_id = i.id "
                f"GROUP BY i.id ORDER BY i.created_at DESC LIMIT 50"
            )
            rows = cur.fetchall()
            result = []
            for r in rows:
                inv_id, ftype, fvalue, status, result_json, applied_at, created_at, total, filled = r
                try:
                    filter_desc = json.loads(fvalue) if fvalue else {}
                except Exception:
                    filter_desc = {}
                if not result_json:
                    applied_list = []
                elif isinstance(result_json, (list, dict)):
                    applied_list = result_json if isinstance(result_json, list) else []
                else:
                    try:
                        applied_list = json.loads(result_json)
                    except Exception:
                        applied_list = []
                result.append({
                    "id": inv_id,
                    "filter_desc": filter_desc,
                    "status": status,
                    "total_items": int(total),
                    "filled_items": int(filled),
                    "changes_count": len(applied_list),
                    "applied_list": applied_list,
                    "applied_at": applied_at.isoformat() if applied_at else None,
                    "created_at": created_at.isoformat() if created_at else None,
                })
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"inventories": result})}

        if action == "inventory_create" and method == "POST":
            """Создать новую инвентаризацию по фильтру (ячейки и/или категории)"""
            filter_cells = body.get("filter_cells", [])   # список ячеек
            filter_cats = body.get("filter_cats", [])     # список категорий

            where_parts = ["g.is_archived = FALSE"]
            if filter_cells and filter_cats:
                cells_sql = ", ".join(f"'{c}'" for c in filter_cells)
                cats_sql  = ", ".join(f"'{c}'" for c in filter_cats)
                where_parts.append(f"(g.cell IN ({cells_sql}) OR g.category IN ({cats_sql}))")
            elif filter_cells:
                cells_sql = ", ".join(f"'{c}'" for c in filter_cells)
                where_parts.append(f"g.cell IN ({cells_sql})")
            elif filter_cats:
                cats_sql = ", ".join(f"'{c}'" for c in filter_cats)
                where_parts.append(f"g.category IN ({cats_sql})")

            where = " AND ".join(where_parts)
            cur.execute(
                f"SELECT g.id, g.name, g.category, g.cell, "
                f"COALESCE(SUM(s.qty),0) as qty_total, "
                f"COALESCE(SUM(s.qty_reserved),0) as qty_reserved "
                f"FROM {SCHEMA}.warehouse_groups g "
                f"LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id "
                f"WHERE {where} GROUP BY g.id ORDER BY g.cell NULLS LAST, g.name"
            )
            groups = cur.fetchall()
            if not groups:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нет товаров по выбранным фильтрам"})}

            filter_desc = {"cells": filter_cells, "cats": filter_cats}
            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_inventories (filter_type, filter_value, status, result_json, created_at) "
                f"VALUES ('mixed', %s, 'draft', '[]', NOW()) RETURNING id",
                (json.dumps(filter_desc, ensure_ascii=False),)
            )
            inv_id = cur.fetchone()[0]

            items = []
            for gid, name, cat, cell, qty_total, qty_reserved in groups:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.warehouse_inventory_items "
                    f"(inventory_id, group_id, qty_expected, qty_actual, cell) "
                    f"VALUES (%s, %s, %s, NULL, %s) RETURNING id",
                    (inv_id, gid, int(qty_total), cell or "")
                )
                item_id = cur.fetchone()[0]
                items.append({
                    "id": item_id, "group_id": gid, "name": name,
                    "category": cat, "cell": cell or "",
                    "qty_expected": int(qty_total), "qty_reserved": int(qty_reserved),
                    "qty_actual": None
                })

            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"inventory_id": inv_id, "items": items})}

        if action == "inventory_update_item" and method == "POST":
            """Обновить фактическое количество по позиции инвентаризации"""
            item_id = int(body.get("item_id"))
            qty_actual = body.get("qty_actual")
            note = body.get("note", "")
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_inventory_items "
                f"SET qty_actual=%s, note=%s, updated_at=NOW() WHERE id=%s",
                (qty_actual, note, item_id)
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "inventory_apply" and method == "POST":
            """Применить инвентаризацию: скорректировать qty в поставках и записать в лог"""
            inv_id = int(body.get("inventory_id"))
            cur.execute(
                f"SELECT ii.id, ii.group_id, ii.qty_expected, ii.qty_actual, ii.cell, g.name "
                f"FROM {SCHEMA}.warehouse_inventory_items ii "
                f"JOIN {SCHEMA}.warehouse_groups g ON g.id = ii.group_id "
                f"WHERE ii.inventory_id = %s AND ii.qty_actual IS NOT NULL",
                (inv_id,)
            )
            items = cur.fetchall()
            applied = []
            for iid, gid, qty_exp, qty_act, cell, name in items:
                delta = int(qty_act) - int(qty_exp)
                if delta == 0:
                    continue
                # Берём последнюю поставку этой группы для корректировки
                cur.execute(
                    f"SELECT id, qty FROM {SCHEMA}.warehouse_supplies WHERE group_id=%s ORDER BY id DESC LIMIT 1",
                    (gid,)
                )
                supply = cur.fetchone()
                if supply:
                    sid, s_qty = supply
                    new_qty = max(0, int(s_qty) + delta)
                    cur.execute(
                        f"UPDATE {SCHEMA}.warehouse_supplies SET qty=%s, updated_at=NOW() WHERE id=%s",
                        (new_qty, sid)
                    )
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.warehouse_movements "
                        f"(group_id, supply_id, type, qty_delta, note, created_at) "
                        f"VALUES (%s, %s, 'inventory', %s, %s, NOW())",
                        (gid, sid, delta, f"Инвентаризация #{inv_id}: {'+' if delta>0 else ''}{delta} шт. (факт {qty_act}, ожидалось {qty_exp})")
                    )
                    # Синхронизируем in_stock/stock_qty в products
                    cur.execute(
                        f"UPDATE {SCHEMA}.products SET "
                        f"stock_qty=(SELECT COALESCE(SUM(s2.qty),0) FROM {SCHEMA}.warehouse_supplies s2 "
                        f"JOIN {SCHEMA}.warehouse_groups g2 ON g2.id=s2.group_id WHERE g2.product_id=products.id), "
                        f"in_stock=(SELECT COALESCE(SUM(s2.qty),0)>0 FROM {SCHEMA}.warehouse_supplies s2 "
                        f"JOIN {SCHEMA}.warehouse_groups g2 ON g2.id=s2.group_id WHERE g2.product_id=products.id) "
                        f"WHERE id=(SELECT product_id FROM {SCHEMA}.warehouse_groups WHERE id=%s)",
                        (gid,)
                    )
                    applied.append({"name": name, "delta": delta, "qty_actual": qty_act})

            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_inventories SET status='applied', result_json=%s, applied_at=NOW() WHERE id=%s",
                (json.dumps(applied, ensure_ascii=False), inv_id)
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "applied": applied})}

        if action == "inventory_get" and method == "GET":
            """Получить позиции инвентаризации"""
            inv_id = int(params.get("inventory_id"))
            cur.execute(
                f"SELECT ii.id, ii.group_id, g.name, g.category, ii.cell, "
                f"ii.qty_expected, ii.qty_actual, ii.note, "
                f"COALESCE(SUM(s.qty_reserved),0) as qty_reserved "
                f"FROM {SCHEMA}.warehouse_inventory_items ii "
                f"JOIN {SCHEMA}.warehouse_groups g ON g.id = ii.group_id "
                f"LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = ii.group_id "
                f"WHERE ii.inventory_id = %s "
                f"GROUP BY ii.id, ii.group_id, g.name, g.category, ii.cell, ii.qty_expected, ii.qty_actual, ii.note "
                f"ORDER BY ii.cell NULLS LAST, g.name",
                (inv_id,)
            )
            rows = cur.fetchall()
            items = [{"id": r[0], "group_id": r[1], "name": r[2], "category": r[3],
                      "cell": r[4] or "", "qty_expected": r[5], "qty_actual": r[6],
                      "note": r[7], "qty_reserved": int(r[8])} for r in rows]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"items": items})}

        # ── УДАЛЕНИЕ СБОРКИ WIP + СНЯТИЕ РЕЗЕРВОВ ────────────────────────────
        if action == "delete_wip" and method == "POST":
            import warehouse_core as wc
            wip_id = int(body["wip_id"])
            # Получаем order_id и build_id
            cur.execute(f"SELECT order_id, build_id FROM {SCHEMA}.wip_builds WHERE id = %s", (wip_id,))
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Сборка не найдена"})}
            order_id, build_id = row[0], row[1]
            released = {"positive": 0, "negative": 0, "kept_ordered": 0}
            if order_id:
                # POSITIVE → возврат в наличие; NEGATIVE → снимаем только NEW,
                # заказанное у поставщика (ORDERED) остаётся в закупке
                released = wc.release_order_reserves(cur, order_id, only_new_negative=True)
                cur.execute(f"UPDATE {SCHEMA}.orders SET status='archived', updated_at=NOW() WHERE id=%s", (order_id,))
            if build_id:
                cur.execute(f"UPDATE {SCHEMA}.pc_builds SET status='archive' WHERE id=%s", (build_id,))
            # Удаляем запись сборки
            cur.execute(f"DELETE FROM {SCHEMA}.wip_builds WHERE id = %s", (wip_id,))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "ok": True, "released_positive": released["positive"],
                "released_negative": released["negative"], "kept_ordered": released["kept_ordered"]
            })}

        # ── ПЕРЕСЧЁТ РЕЗЕРВОВ: привести qty_reserved/qty_negative партий ──────
        # в соответствие с реальными записями в warehouse_reserves (источник
        # истины). Излишек резерва возвращается в наличие (qty), нехватка —
        # списывается из наличия. Все расхождения пишутся в stock_log.
        if action == "recalc_reserves" and method == "POST":
            # Шаг 0: закрываем «зависшие» резервы на завершённых/отменённых заказах.
            # Завершённый заказ (done) — товар выдан → резерв FULFILLED.
            # Отменённый (cancelled) — резерв RELEASED.
            # Иначе они продолжают держать qty_reserved и завышают резерв в превью,
            # хотя в детализации (она фильтрует done/cancelled) их не видно.
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_reserves r "
                f"SET status = CASE WHEN o.status = 'cancelled' THEN 'RELEASED' ELSE 'FULFILLED' END, "
                f"    updated_at = NOW() "
                f"FROM {SCHEMA}.orders o "
                f"WHERE r.order_id = o.id AND r.status = 'ACTIVE' "
                f"AND o.status IN ('done', 'cancelled')"
            )
            stale_closed = cur.rowcount

            # Эталон по каждой партии: сумма ACTIVE POSITIVE/NEGATIVE резервов
            # (только живые заказы — done/cancelled уже исключены выше через статус резерва)
            cur.execute(
                f"SELECT s.id, s.group_id, s.qty, s.qty_reserved, s.qty_negative, "
                f"COALESCE(SUM(r.qty) FILTER (WHERE r.type='POSITIVE' AND r.status='ACTIVE'), 0) AS pos, "
                f"COALESCE(SUM(r.qty) FILTER (WHERE r.type='NEGATIVE' AND r.status='ACTIVE'), 0) AS neg "
                f"FROM {SCHEMA}.warehouse_supplies s "
                f"LEFT JOIN {SCHEMA}.warehouse_reserves r ON r.supply_id = s.id "
                f"GROUP BY s.id, s.group_id, s.qty, s.qty_reserved, s.qty_negative"
            )
            rows = cur.fetchall()
            fixed = []
            for (sid, gid, qty, qty_res, qty_neg, want_pos, want_neg) in rows:
                qty = int(qty or 0)
                qty_res = int(qty_res or 0)
                qty_neg = int(qty_neg or 0)
                want_pos = int(want_pos or 0)
                want_neg = int(want_neg or 0)
                diff_res = qty_res - want_pos   # >0 — застрявший резерв (вернуть в наличие)
                diff_neg = qty_neg - want_neg   # >0 — застрявший минус (убрать)
                if diff_res == 0 and diff_neg == 0:
                    continue
                # Корректируем qty_reserved → want_pos, наличие меняем на разницу
                new_qty = qty + diff_res  # излишек резерва возвращаем в qty
                if new_qty < 0:
                    new_qty = 0
                cur.execute(
                    f"UPDATE {SCHEMA}.warehouse_supplies "
                    f"SET qty = %s, qty_reserved = %s, qty_negative = %s, updated_at = NOW() "
                    f"WHERE id = %s",
                    (new_qty, want_pos, want_neg, sid)
                )
                # Лог расхождения
                cur.execute(
                    f"INSERT INTO {SCHEMA}.warehouse_stock_log (group_id, order_id, event, delta, payload) "
                    f"VALUES (%s, NULL, 'recalc_reserves', %s, %s)",
                    (gid, diff_res, json.dumps({
                        "supply_id": sid,
                        "qty_reserved": {"was": qty_res, "now": want_pos},
                        "qty_negative": {"was": qty_neg, "now": want_neg},
                        "qty": {"was": qty, "now": new_qty},
                    }, ensure_ascii=False))
                )
                fixed.append({
                    "supply_id": sid, "group_id": gid,
                    "reserved_was": qty_res, "reserved_now": want_pos,
                    "negative_was": qty_neg, "negative_now": want_neg,
                    "qty_was": qty, "qty_now": new_qty,
                })
            # Синхронизируем корзину закупки: required_qty = сумма активных NEGATIVE
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_purchase_basket b SET "
                f"required_qty = COALESCE((SELECT SUM(r.qty) FROM {SCHEMA}.warehouse_reserves r "
                f"  WHERE r.group_id = b.group_id AND r.type='NEGATIVE' AND r.status='ACTIVE'), 0), "
                f"updated_at = NOW()"
            )
            # Итоговый лог запуска
            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_stock_log (group_id, order_id, event, delta, payload) "
                f"VALUES (NULL, NULL, 'recalc_reserves_run', %s, %s)",
                (len(fixed), json.dumps({"fixed_supplies": len(fixed), "stale_closed": stale_closed}, ensure_ascii=False))
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "ok": True, "fixed_count": len(fixed), "stale_closed": stale_closed, "fixed": fixed
            })}

        # ── НАСТРОЙКИ (app_settings) ─────────────────────────────────────────
        ALLOWED_SETTINGS = ("purchase_discount_percent", "default_prepayment_percent", "vat_percent")
        if action == "settings" and method == "GET":
            cur.execute(
                f"SELECT key, value FROM {SCHEMA}.app_settings WHERE key IN "
                f"({', '.join(esc(k) for k in ALLOWED_SETTINGS)})"
            )
            result = {r[0]: r[1] for r in cur.fetchall()}
            # дефолты, если ключа ещё нет
            result.setdefault("purchase_discount_percent", "0")
            result.setdefault("default_prepayment_percent", "30")
            result.setdefault("vat_percent", "20")
            return {"statusCode": 200, "headers": cors, "body": json.dumps(result)}

        if action == "settings_set" and method == "POST":
            settings = body.get("settings") or {}
            for key, val in settings.items():
                if key not in ALLOWED_SETTINGS:
                    continue
                cur.execute(
                    f"INSERT INTO {SCHEMA}.app_settings (key, value, updated_at) "
                    f"VALUES ({esc(key)}, {esc(str(val))}, NOW()) "
                    f"ON CONFLICT (key) DO UPDATE SET value = {esc(str(val))}, updated_at = NOW()"
                )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── ПЕРЕСЧЁТ АВТО-РАСХОДОВ ОФИСА (закупка товара) ────────────────────
        # Прокси на finance (у неё права на finance_*). finance сам считает
        # авто-расходы «Закупка товара» из поставок — источника истины.
        if action == "recalc_supply_expense" and method == "POST":
            notify_finance_supply_expense()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True})}

        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": f"Неизвестное действие: {action}"})}

    finally:
        cur.close()
        conn.close()