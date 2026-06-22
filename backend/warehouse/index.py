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

# Категория товара -> тип компонента конфигуратора (для product_specs).
# Ключ — по slug или по нижнему регистру названия категории.
CATEGORY_TO_COMPONENT = {
    "cpu": "cpu", "процессоры": "cpu",
    "motherboard": "motherboard", "материнские платы": "motherboard",
    "ram": "ram", "оперативная память": "ram",
    "gpu": "gpu", "видеокарты": "gpu",
    "psu": "psu", "блоки питания": "psu",
    "case": "case", "корпуса": "case",
    "cooling": "cooling", "система охлаждения процессора": "cooling",
    "storage": "storage", "накопители": "storage",
    "fan": "fan", "вентилятор": "fan",
    "accessories": "other", "аксессуары": "other",
}


def detect_component_type(cur, product_id, category_name=""):
    """Определяет тип компонента по категории товара для product_specs."""
    ct = CATEGORY_TO_COMPONENT.get((category_name or "").strip().lower())
    if ct:
        return ct
    cur.execute(
        f"SELECT c.slug, c.name FROM {SCHEMA}.products p "
        f"LEFT JOIN {SCHEMA}.categories c ON c.id = p.category_id "
        f"WHERE p.id = {product_id}"
    )
    row = cur.fetchone()
    if row:
        slug = (row[0] or "").lower()
        name = (row[1] or "").lower()
        return CATEGORY_TO_COMPONENT.get(slug) or CATEGORY_TO_COMPONENT.get(name) or "other"
    return "other"


# Обязательные поля характеристик по типу компонента.
# Товар считается "готовым" когда заполнены ВСЕ поля из своего списка.
# Для типов без жёстких связок (fan/other) обязательных полей нет — сразу готов.
SPECS_REQUIRED = {
    "cpu":         ["socket", "mem_type", "tdp_watt"],
    "motherboard": ["socket", "chipset", "form_factor", "mem_type", "mem_slots"],
    "ram":         ["mem_type", "ram_form", "ram_modules", "ram_capacity_gb"],
    "gpu":         ["gpu_length_mm", "tdp_watt", "gpu_power_connector"],
    "psu":         ["psu_watt", "psu_form_factor"],
    "case":        ["case_form_factors", "max_gpu_length_mm", "max_cooler_height_mm"],
    "cooling":     ["cooler_sockets", "cooler_type"],
    "storage":     ["storage_interface"],
    "fan":         [],
    "other":       [],
}

# Все колонки характеристик (без служебных) — для select/update.
SPECS_COLUMNS = [
    "component_type", "socket", "mem_type", "tdp_watt", "has_igpu",
    "chipset", "form_factor", "mem_slots", "m2_slots",
    "ram_form", "ram_modules", "ram_capacity_gb", "ram_freq",
    "gpu_length_mm", "gpu_power_connector",
    "psu_watt", "psu_form_factor", "psu_connectors",
    "case_form_factors", "max_gpu_length_mm", "max_cooler_height_mm", "radiator_support",
    "cooler_sockets", "cooler_type", "cooler_height_mm", "radiator_size", "cooler_tdp_rating",
    "storage_interface",
]
SPECS_JSON_COLS = {"psu_connectors", "case_form_factors", "radiator_support", "cooler_sockets"}
SPECS_INT_COLS = {
    "tdp_watt", "mem_slots", "m2_slots", "ram_modules", "ram_capacity_gb", "ram_freq",
    "gpu_length_mm", "psu_watt", "max_gpu_length_mm", "max_cooler_height_mm",
    "cooler_height_mm", "radiator_size", "cooler_tdp_rating",
}
SPECS_BOOL_COLS = {"has_igpu"}


def _spec_field_filled(col, val):
    """Поле считается заполненным, если оно не None/'' и (для json-списков) непустое."""
    if val is None:
        return False
    if col in SPECS_JSON_COLS:
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except Exception:
                return False
        return bool(val)
    if isinstance(val, str):
        return val.strip() != ""
    return True


def compute_specs_ready(component_type, spec_row):
    """spec_row — dict колонок. Возвращает True если все обязательные поля заполнены."""
    req = SPECS_REQUIRED.get(component_type or "other", [])
    for col in req:
        if not _spec_field_filled(col, spec_row.get(col)):
            return False
    return True


def ensure_product_specs(cur, product_id, category_name=""):
    """Создаёт пустую строку характеристик совместимости для товара.
    Если строка уже есть — только обновляет component_type."""
    if not product_id:
        return
    ct = detect_component_type(cur, product_id, category_name)
    cur.execute(
        f"INSERT INTO {SCHEMA}.product_specs (product_id, component_type) "
        f"VALUES ({product_id}, {esc(ct)}) "
        f"ON CONFLICT (product_id) DO UPDATE SET "
        f"component_type = COALESCE({SCHEMA}.product_specs.component_type, EXCLUDED.component_type)"
    )


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

            # Автосоздаём строку характеристик совместимости для конфигуратора
            ensure_product_specs(cur, product_id, category)

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
                # каскадный пересчёт продажных сборок с этим товаром (наличие не трогаем)
                cur.execute(f"SELECT product_id FROM {SCHEMA}.warehouse_groups WHERE id = {gid}")
                _pid_row = cur.fetchone()
                if _pid_row and _pid_row[0]:
                    import warehouse_core as wc
                    wc.recalc_builds_for_product(cur, int(_pid_row[0]), float(body["price_retail"]))

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
            gid = int(body.get("id"))
            cur.execute(f"UPDATE {SCHEMA}.warehouse_groups SET is_archived = TRUE, updated_at = NOW() WHERE id = {gid}")
            # Архивируем и подвязанную карточку товара (по обеим связям),
            # чтобы товар пропал из каталога, конфигуратора и совместимости.
            cur.execute(f"UPDATE {SCHEMA}.products SET is_archived = TRUE WHERE warehouse_group_id = {gid}")
            cur.execute(
                f"UPDATE {SCHEMA}.products SET is_archived = TRUE WHERE id IN "
                f"(SELECT product_id FROM {SCHEMA}.warehouse_groups WHERE id = {gid} AND product_id IS NOT NULL)"
            )
            log_movement(cur, gid, None, None, None, "group_archived", 0, note="Группа архивирована")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "group_unarchive" and method == "PUT":
            gid = int(body.get("id"))
            cur.execute(f"UPDATE {SCHEMA}.warehouse_groups SET is_archived = FALSE, updated_at = NOW() WHERE id = {gid}")
            # Возвращаем из архива и подвязанную карточку товара
            cur.execute(f"UPDATE {SCHEMA}.products SET is_archived = FALSE WHERE warehouse_group_id = {gid}")
            cur.execute(
                f"UPDATE {SCHEMA}.products SET is_archived = FALSE WHERE id IN "
                f"(SELECT product_id FROM {SCHEMA}.warehouse_groups WHERE id = {gid} AND product_id IS NOT NULL)"
            )
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
            # Себестоимость (cost_price):
            #   с НДС  → cost_price = цена × (1 − скидка_закупки/100)
            #            (по НДС-товарам мы получаем вычет, поэтому реальный
            #             заход ниже цены с НДС)
            #   без НДС → cost_price = введённая цена как есть
            # price_with_vat сохраняем КАК ВВЕДЕНО (для отчётности/НДС).
            # Поддержка legacy: если пришло только cost_price — берём его.
            has_vat = body.get("has_vat")
            price_with_vat = body.get("price_with_vat")
            if price_with_vat is not None:
                price_in = float(price_with_vat)
            else:
                price_in = float(body.get("cost_price", 0))
            cost_price = round(price_in, 2)
            if has_vat is True:
                # Скидка закупки для НДС-товаров из настроек (app_settings)
                cur.execute(
                    f"SELECT value FROM {SCHEMA}.app_settings "
                    f"WHERE key = 'purchase_discount_percent' LIMIT 1"
                )
                ds = cur.fetchone()
                try:
                    discount_pct = float(ds[0]) if ds and ds[0] is not None else 0.0
                except (TypeError, ValueError):
                    discount_pct = 0.0
                cost_price = round(price_in * (1 - discount_pct / 100), 2)

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
            # Запоминаем старые магазин+дату+цену+НДС поставки
            cur.execute(
                f"SELECT store_id, purchase_date, cost_price, has_vat "
                f"FROM {SCHEMA}.warehouse_supplies WHERE id = {int(sid)}"
            )
            old_row = cur.fetchone()
            old_store, old_date = (old_row[0], old_row[1]) if old_row else (None, None)
            old_cost = float(old_row[2]) if old_row and old_row[2] is not None else 0.0
            old_has_vat = bool(old_row[3]) if old_row and old_row[3] is not None else False
            # НДС-товары: цену (себестоимость) можно только ПОВЫШАТЬ.
            if old_has_vat and "cost_price" in body:
                try:
                    if float(body["cost_price"]) < old_cost:
                        return {"statusCode": 400, "headers": cors, "body": json.dumps({
                            "error": "vat_no_discount",
                            "message": "Товар с НДС: цену можно только повысить, понижение недоступно.",
                        })}
                except (TypeError, ValueError):
                    pass
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

        # ── ХАРАКТЕРИСТИКИ СОВМЕСТИМОСТИ (product_specs) ─────────────────────
        # Список всех железок (товары + их характеристики + статус new/ready).
        if action == "specs_list" and method == "GET":
            cols_sql = ", ".join(f"ps.{c}" for c in SPECS_COLUMNS)
            cur.execute(
                f"SELECT p.id, p.name, c.name AS cat_name, c.slug AS cat_slug, "
                f"p.image_url, p.is_archived, {cols_sql} "
                f"FROM {SCHEMA}.products p "
                f"LEFT JOIN {SCHEMA}.categories c ON c.id = p.category_id "
                f"LEFT JOIN {SCHEMA}.product_specs ps ON ps.product_id = p.id "
                f"WHERE p.is_archived = FALSE "
                f"ORDER BY (ps.product_id IS NULL) DESC, c.sort_order, p.name"
            )
            rows = cur.fetchall()
            items = []
            for r in rows:
                pid, pname, cat_name, cat_slug, image_url, is_archived = r[0], r[1], r[2], r[3], r[4], r[5]
                spec = {}
                for i, col in enumerate(SPECS_COLUMNS):
                    spec[col] = r[6 + i]
                ctype = spec.get("component_type") or CATEGORY_TO_COMPONENT.get((cat_slug or "").lower()) or CATEGORY_TO_COMPONENT.get((cat_name or "").lower()) or "other"
                spec["component_type"] = ctype
                has_row = any(r[6 + i] is not None for i in range(len(SPECS_COLUMNS)))
                ready = has_row and compute_specs_ready(ctype, spec)
                items.append({
                    "product_id": pid, "name": pname,
                    "category": cat_name, "category_slug": cat_slug,
                    "image_url": image_url,
                    "component_type": ctype,
                    "has_specs": has_row,
                    "ready": ready,
                    "required": SPECS_REQUIRED.get(ctype, []),
                    "specs": spec,
                })
            return {"statusCode": 200, "headers": cors, "body": json.dumps(items, default=str)}

        # Получить характеристики одного товара.
        if action == "specs_get" and method == "GET":
            pid = int(params.get("product_id") or 0)
            ensure_product_specs(cur, pid)
            conn.commit()
            cols_sql = ", ".join(SPECS_COLUMNS)
            cur.execute(
                f"SELECT {cols_sql} FROM {SCHEMA}.product_specs WHERE product_id = {pid}"
            )
            row = cur.fetchone()
            spec = {}
            if row:
                for i, col in enumerate(SPECS_COLUMNS):
                    spec[col] = row[i]
            ctype = spec.get("component_type") or "other"
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "product_id": pid, "specs": spec, "component_type": ctype,
                "required": SPECS_REQUIRED.get(ctype, []),
                "ready": compute_specs_ready(ctype, spec),
            }, default=str)}

        # Обновить характеристики товара.
        if action == "specs_update" and method == "PUT":
            pid = int(body.get("product_id") or 0)
            if not pid:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "product_id обязателен"})}
            ensure_product_specs(cur, pid)
            incoming = body.get("specs") or {}
            sets = []
            for col in SPECS_COLUMNS:
                if col not in incoming:
                    continue
                val = incoming[col]
                if col in SPECS_JSON_COLS:
                    sets.append(f"{col} = {esc(json.dumps(val if val is not None else []))}::jsonb")
                elif col in SPECS_BOOL_COLS:
                    sets.append(f"{col} = {'TRUE' if val else 'FALSE'}" if val is not None else f"{col} = NULL")
                elif col in SPECS_INT_COLS:
                    if val in (None, "", "null"):
                        sets.append(f"{col} = NULL")
                    else:
                        sets.append(f"{col} = {int(val)}")
                else:
                    sets.append(f"{col} = {esc(val) if val not in (None, '') else 'NULL'}")
            if sets:
                sets.append("updated_at = NOW()")
                cur.execute(
                    f"UPDATE {SCHEMA}.product_specs SET {', '.join(sets)} WHERE product_id = {pid}"
                )
            conn.commit()
            # пересчитываем готовность
            cols_sql = ", ".join(SPECS_COLUMNS)
            cur.execute(f"SELECT {cols_sql} FROM {SCHEMA}.product_specs WHERE product_id = {pid}")
            row = cur.fetchone()
            spec = {}
            if row:
                for i, col in enumerate(SPECS_COLUMNS):
                    spec[col] = row[i]
            ctype = spec.get("component_type") or "other"
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "ok": True, "ready": compute_specs_ready(ctype, spec), "specs": spec,
            }, default=str)}

        # ════════════════════════════════════════════════════════════════════
        # DATA-DRIVEN КОНСТРУКТОР ХАРАКТЕРИСТИК СОВМЕСТИМОСТИ
        #   spec_categories — типы железа, spec_attributes — поля,
        #   product_spec_values — значения у товаров, spec_links — карта связей.
        # ════════════════════════════════════════════════════════════════════

        # ── СХЕМА: всё разом (категории + их атрибуты + связи) ───────────────
        if action == "spec_schema" and method == "GET":
            cur.execute(
                f"SELECT id, code, name, icon, color, product_category_slug, sort_order "
                f"FROM {SCHEMA}.spec_categories ORDER BY sort_order, id"
            )
            cats = [{"id": r[0], "code": r[1], "name": r[2], "icon": r[3], "color": r[4],
                     "product_category_slug": r[5], "sort_order": r[6]} for r in cur.fetchall()]
            cur.execute(
                f"SELECT id, category_id, code, name, field_type, options, unit, "
                f"affects_compat, is_required, sort_order "
                f"FROM {SCHEMA}.spec_attributes ORDER BY category_id, sort_order, id"
            )
            attrs = []
            for r in cur.fetchall():
                attrs.append({"id": r[0], "category_id": r[1], "code": r[2], "name": r[3],
                              "field_type": r[4], "options": r[5] or [], "unit": r[6],
                              "affects_compat": r[7], "is_required": r[8], "sort_order": r[9]})
            cur.execute(
                f"SELECT id, name, from_attribute_id, to_attribute_id, rule, note, is_active "
                f"FROM {SCHEMA}.spec_links ORDER BY id"
            )
            links = [{"id": r[0], "name": r[1], "from_attribute_id": r[2], "to_attribute_id": r[3],
                      "rule": r[4], "note": r[5], "is_active": r[6]} for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps(
                {"categories": cats, "attributes": attrs, "links": links}, default=str)}

        # ── КАТЕГОРИИ КОМПОНЕНТОВ ────────────────────────────────────────────
        if action == "spec_cat_create" and method == "POST":
            code = body.get("code", "").strip()
            name = body.get("name", "").strip()
            if not code or not name:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "code и name обязательны"})}
            cur.execute(
                f"INSERT INTO {SCHEMA}.spec_categories (code, name, icon, color, product_category_slug, sort_order) "
                f"VALUES ({esc(code)}, {esc(name)}, {esc(body.get('icon') or 'Package')}, "
                f"{esc(body.get('color') or '#64748b')}, {esc(body.get('product_category_slug')) if body.get('product_category_slug') else 'NULL'}, "
                f"{int(body.get('sort_order') or 0)}) ON CONFLICT (code) DO NOTHING RETURNING id"
            )
            row = cur.fetchone()
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"id": row[0] if row else None})}

        if action == "spec_cat_update" and method == "PUT":
            cid = int(body.get("id") or 0)
            sets = []
            for f in ["name", "icon", "color", "product_category_slug"]:
                if f in body:
                    sets.append(f"{f} = {esc(body[f]) if body[f] not in (None, '') else 'NULL'}")
            if "sort_order" in body:
                sets.append(f"sort_order = {int(body['sort_order'])}")
            if sets:
                cur.execute(f"UPDATE {SCHEMA}.spec_categories SET {', '.join(sets)} WHERE id = {cid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "spec_cat_delete" and method == "DELETE":
            cid = int(params.get("id") or 0)
            cur.execute(f"SELECT id FROM {SCHEMA}.spec_attributes WHERE category_id = {cid}")
            attr_ids = [r[0] for r in cur.fetchall()]
            if attr_ids:
                ids_sql = ",".join(str(a) for a in attr_ids)
                cur.execute(f"DELETE FROM {SCHEMA}.spec_links WHERE from_attribute_id IN ({ids_sql}) OR to_attribute_id IN ({ids_sql})")
                cur.execute(f"DELETE FROM {SCHEMA}.product_spec_values WHERE attribute_id IN ({ids_sql})")
                cur.execute(f"DELETE FROM {SCHEMA}.spec_attributes WHERE category_id = {cid}")
            cur.execute(f"DELETE FROM {SCHEMA}.spec_categories WHERE id = {cid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── ХАРАКТЕРИСТИКИ (поля) ────────────────────────────────────────────
        if action == "spec_attr_create" and method == "POST":
            cid = int(body.get("category_id") or 0)
            code = body.get("code", "").strip()
            name = body.get("name", "").strip()
            if not cid or not code or not name:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "category_id, code, name обязательны"})}
            cur.execute(
                f"INSERT INTO {SCHEMA}.spec_attributes "
                f"(category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order) "
                f"VALUES ({cid}, {esc(code)}, {esc(name)}, {esc(body.get('field_type') or 'text')}, "
                f"{esc(json.dumps(body.get('options') or []))}::jsonb, "
                f"{esc(body.get('unit')) if body.get('unit') else 'NULL'}, "
                f"{'TRUE' if body.get('affects_compat') else 'FALSE'}, "
                f"{'TRUE' if body.get('is_required') else 'FALSE'}, "
                f"{int(body.get('sort_order') or 0)}) "
                f"ON CONFLICT (category_id, code) DO NOTHING RETURNING id"
            )
            row = cur.fetchone()
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"id": row[0] if row else None})}

        if action == "spec_attr_update" and method == "PUT":
            aid = int(body.get("id") or 0)
            sets = []
            for f in ["name", "field_type", "unit"]:
                if f in body:
                    sets.append(f"{f} = {esc(body[f]) if body[f] not in (None, '') else 'NULL'}")
            if "options" in body:
                sets.append(f"options = {esc(json.dumps(body['options'] or []))}::jsonb")
            for f in ["affects_compat", "is_required"]:
                if f in body:
                    sets.append(f"{f} = {'TRUE' if body[f] else 'FALSE'}")
            if "sort_order" in body:
                sets.append(f"sort_order = {int(body['sort_order'])}")
            if sets:
                cur.execute(f"UPDATE {SCHEMA}.spec_attributes SET {', '.join(sets)} WHERE id = {aid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "spec_attr_delete" and method == "DELETE":
            aid = int(params.get("id") or 0)
            cur.execute(f"DELETE FROM {SCHEMA}.spec_links WHERE from_attribute_id = {aid} OR to_attribute_id = {aid}")
            cur.execute(f"DELETE FROM {SCHEMA}.product_spec_values WHERE attribute_id = {aid}")
            cur.execute(f"DELETE FROM {SCHEMA}.spec_attributes WHERE id = {aid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── СВЯЗИ (карта совместимости) ──────────────────────────────────────
        if action == "spec_link_create" and method == "POST":
            fa = int(body.get("from_attribute_id") or 0)
            ta = int(body.get("to_attribute_id") or 0)
            if not fa or not ta:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "from/to attribute обязательны"})}
            cur.execute(
                f"INSERT INTO {SCHEMA}.spec_links (name, from_attribute_id, to_attribute_id, rule, note, is_active) "
                f"VALUES ({esc(body.get('name')) if body.get('name') else 'NULL'}, {fa}, {ta}, "
                f"{esc(body.get('rule') or 'eq')}, {esc(body.get('note')) if body.get('note') else 'NULL'}, TRUE) RETURNING id"
            )
            row = cur.fetchone()
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"id": row[0]})}

        if action == "spec_link_update" and method == "PUT":
            lid = int(body.get("id") or 0)
            sets = []
            for f in ["name", "rule", "note"]:
                if f in body:
                    sets.append(f"{f} = {esc(body[f]) if body[f] not in (None, '') else 'NULL'}")
            for f in ["from_attribute_id", "to_attribute_id"]:
                if f in body:
                    sets.append(f"{f} = {int(body[f])}")
            if "is_active" in body:
                sets.append(f"is_active = {'TRUE' if body['is_active'] else 'FALSE'}")
            if sets:
                cur.execute(f"UPDATE {SCHEMA}.spec_links SET {', '.join(sets)} WHERE id = {lid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        if action == "spec_link_delete" and method == "DELETE":
            lid = int(params.get("id") or 0)
            cur.execute(f"DELETE FROM {SCHEMA}.spec_links WHERE id = {lid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── ЖЕЛЕЗКИ (товары + статус новый/готов на базе spec_attributes) ────
        if action == "spec_products" and method == "GET":
            # Считаем готовность: заполнены все is_required атрибуты категории товара
            cur.execute(
                f"SELECT p.id, COALESCE(NULLIF(wg.name, ''), p.name) AS name, c.name AS cat_name, c.slug AS cat_slug, p.image_url, "
                f"sc.id AS spec_cat_id, sc.code AS spec_cat_code, sc.name AS spec_cat_name "
                f"FROM {SCHEMA}.products p "
                f"LEFT JOIN {SCHEMA}.categories c ON c.id = p.category_id "
                f"LEFT JOIN {SCHEMA}.spec_categories sc ON sc.product_category_slug = c.slug "
                f"LEFT JOIN {SCHEMA}.warehouse_groups wg ON wg.id = p.warehouse_group_id "
                f"WHERE p.is_archived = FALSE AND COALESCE(wg.is_archived, FALSE) = FALSE "
                f"ORDER BY c.sort_order, p.name"
            )
            prods = cur.fetchall()
            # требуемые атрибуты по категории компонента
            cur.execute(
                f"SELECT category_id, id FROM {SCHEMA}.spec_attributes WHERE is_required = TRUE"
            )
            req_by_cat = {}
            for cat_id, attr_id in cur.fetchall():
                req_by_cat.setdefault(cat_id, []).append(attr_id)
            # заполненные значения по товарам
            cur.execute(
                f"SELECT product_id, attribute_id FROM {SCHEMA}.product_spec_values "
                f"WHERE (value IS NOT NULL AND value <> '') OR (value_json IS NOT NULL AND value_json::text NOT IN ('[]','null'))"
            )
            filled = {}
            for pid, aid in cur.fetchall():
                filled.setdefault(pid, set()).add(aid)
            items = []
            for r in prods:
                pid, pname, cat_name, cat_slug, image_url, spec_cat_id, spec_cat_code, spec_cat_name = r
                req = req_by_cat.get(spec_cat_id, [])
                have = filled.get(pid, set())
                req_done = sum(1 for a in req if a in have)
                ready = spec_cat_id is not None and req_done == len(req)
                items.append({
                    "product_id": pid, "name": pname,
                    "category": cat_name, "category_slug": cat_slug, "image_url": image_url,
                    "spec_category_id": spec_cat_id, "spec_category_code": spec_cat_code,
                    "spec_category_name": spec_cat_name,
                    "required_total": len(req), "required_done": req_done,
                    "ready": ready,
                })
            return {"statusCode": 200, "headers": cors, "body": json.dumps(items, default=str)}

        # ── ТОВАРЫ СЛОТА + ИХ ЗНАЧЕНИЯ ХАРАКТЕРИСТИК (для конфигуратора) ──────
        # Отдаёт все товары одной spec-категории (по её коду, напр. motherboard)
        # со всеми заполненными характеристиками — чтобы фронт построил фильтры
        # и посчитал совместимость без множества запросов.
        if action == "spec_slot_products" and method == "GET":
            slot_code = (params.get("slot") or params.get("code") or "").strip()
            if not slot_code:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "slot обязателен"})}
            cur.execute(
                f"SELECT id FROM {SCHEMA}.spec_categories WHERE code = {esc(slot_code)}"
            )
            sc_row = cur.fetchone()
            if not sc_row:
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"products": [], "attributes": []})}
            spec_cat_id = sc_row[0]
            # атрибуты этой spec-категории
            cur.execute(
                f"SELECT id, code, name, field_type, options, unit, affects_compat, is_required, sort_order "
                f"FROM {SCHEMA}.spec_attributes WHERE category_id = {spec_cat_id} ORDER BY sort_order, id"
            )
            attributes = [{"id": r[0], "code": r[1], "name": r[2], "field_type": r[3],
                           "options": r[4] or [], "unit": r[5], "affects_compat": r[6],
                           "is_required": r[7], "sort_order": r[8]} for r in cur.fetchall()]
            # товары, чья товарная категория привязана к этой spec-категории
            cur.execute(
                f"SELECT p.id, p.name, p.price, p.image_url, p.image_urls, p.in_stock, "
                f"p.stock_qty, p.description, br.name AS brand "
                f"FROM {SCHEMA}.products p "
                f"JOIN {SCHEMA}.categories c ON c.id = p.category_id "
                f"JOIN {SCHEMA}.spec_categories sc ON sc.product_category_slug = c.slug "
                f"LEFT JOIN {SCHEMA}.warehouse_groups wg ON wg.id = p.warehouse_group_id "
                f"LEFT JOIN {SCHEMA}.brands br ON br.id = p.brand_id "
                f"WHERE sc.id = {spec_cat_id} AND p.is_archived = FALSE "
                f"AND COALESCE(wg.is_archived, FALSE) = FALSE "
                f"ORDER BY p.in_stock DESC NULLS LAST, p.sort_order NULLS LAST, p.name"
            )
            prod_rows = cur.fetchall()
            pids = [r[0] for r in prod_rows]
            # значения характеристик всех этих товаров одним запросом
            vals_by_pid = {}
            # себестоимость (средневзвешенная по партиям склада) для маржи
            cost_by_pid = {}
            if pids:
                ids_sql = ",".join(str(p) for p in pids)
                cur.execute(
                    f"SELECT product_id, attribute_id, value, value_json "
                    f"FROM {SCHEMA}.product_spec_values WHERE product_id IN ({ids_sql})"
                )
                for pid, aid, value, vjson in cur.fetchall():
                    vals_by_pid.setdefault(pid, {})[str(aid)] = vjson if vjson is not None else value
                cur.execute(
                    f"SELECT wg.product_id, "
                    f"COALESCE(SUM(s.cost_price * s.qty) / NULLIF(SUM(s.qty), 0), 0) AS avg_cost "
                    f"FROM {SCHEMA}.warehouse_groups wg "
                    f"LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = wg.id AND s.qty > 0 "
                    f"WHERE wg.product_id IN ({ids_sql}) GROUP BY wg.product_id"
                )
                for pid, avg_cost in cur.fetchall():
                    cost_by_pid[pid] = float(avg_cost) if avg_cost else 0
            products = []
            for r in prod_rows:
                pid = r[0]
                price = float(r[2]) if r[2] is not None else 0
                cost = cost_by_pid.get(pid, 0)
                # margin — внутреннее поле для скрытой сортировки по маржинальности
                products.append({
                    "id": pid, "name": r[1], "price": price,
                    "image_url": r[3], "image_urls": r[4] or [],
                    "in_stock": r[5], "stock_qty": r[6], "description": r[7],
                    "brand": r[8],
                    "margin": round(price - cost, 2) if cost > 0 else 0,
                    "values": vals_by_pid.get(pid, {}),
                })
            return {"statusCode": 200, "headers": cors, "body": json.dumps(
                {"spec_category_id": spec_cat_id, "attributes": attributes, "products": products}, default=str)}

        # ── ЗНАЧЕНИЯ ХАРАКТЕРИСТИК ОДНОГО ТОВАРА ─────────────────────────────
        if action == "spec_values_get" and method == "GET":
            pid = int(params.get("product_id") or 0)
            cur.execute(
                f"SELECT attribute_id, value, value_json FROM {SCHEMA}.product_spec_values WHERE product_id = {pid}"
            )
            vals = {}
            for aid, value, vjson in cur.fetchall():
                vals[str(aid)] = vjson if vjson is not None else value
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"product_id": pid, "values": vals}, default=str)}

        if action == "spec_values_save" and method == "PUT":
            pid = int(body.get("product_id") or 0)
            values = body.get("values") or {}   # {attribute_id: value | [..]}
            for aid_str, val in values.items():
                aid = int(aid_str)
                if isinstance(val, list):
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.product_spec_values (product_id, attribute_id, value, value_json, updated_at) "
                        f"VALUES ({pid}, {aid}, NULL, {esc(json.dumps(val))}::jsonb, NOW()) "
                        f"ON CONFLICT (product_id, attribute_id) DO UPDATE SET value = NULL, value_json = EXCLUDED.value_json, updated_at = NOW()"
                    )
                else:
                    sval = "" if val is None else str(val)
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.product_spec_values (product_id, attribute_id, value, value_json, updated_at) "
                        f"VALUES ({pid}, {aid}, {esc(sval)}, NULL, NOW()) "
                        f"ON CONFLICT (product_id, attribute_id) DO UPDATE SET value = EXCLUDED.value, value_json = NULL, updated_at = NOW()"
                    )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── ЭКСПОРТ: значения характеристик ВСЕХ товаров (для CSV) ───────────
        # Отдаёт по каждому товару его значения {attribute_id: value} — фронт
        # собирает CSV-матрицу товары × характеристики.
        if action == "spec_export_values" and method == "GET":
            cur.execute(
                f"SELECT product_id, attribute_id, value, value_json "
                f"FROM {SCHEMA}.product_spec_values"
            )
            by_pid = {}
            for pid, aid, value, vjson in cur.fetchall():
                v = vjson if vjson is not None else value
                by_pid.setdefault(pid, {})[str(aid)] = v
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"values": by_pid}, default=str)}

        # ── ИМПОРТ: массовое сохранение значений нескольких товаров ──────────
        # body.items = [{ product_id, values: { attribute_id: value | [..] } }, ...]
        if action == "spec_import" and method == "PUT":
            items = body.get("items") or []
            saved = 0
            for it in items:
                pid = int(it.get("product_id") or 0)
                if not pid:
                    continue
                values = it.get("values") or {}
                for aid_str, val in values.items():
                    aid = int(aid_str)
                    if isinstance(val, list):
                        cur.execute(
                            f"INSERT INTO {SCHEMA}.product_spec_values (product_id, attribute_id, value, value_json, updated_at) "
                            f"VALUES ({pid}, {aid}, NULL, {esc(json.dumps(val))}::jsonb, NOW()) "
                            f"ON CONFLICT (product_id, attribute_id) DO UPDATE SET value = NULL, value_json = EXCLUDED.value_json, updated_at = NOW()"
                        )
                    else:
                        sval = "" if val is None else str(val)
                        cur.execute(
                            f"INSERT INTO {SCHEMA}.product_spec_values (product_id, attribute_id, value, value_json, updated_at) "
                            f"VALUES ({pid}, {aid}, {esc(sval)}, NULL, NOW()) "
                            f"ON CONFLICT (product_id, attribute_id) DO UPDATE SET value = EXCLUDED.value, value_json = NULL, updated_at = NOW()"
                        )
                saved += 1
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "saved": saved})}

        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": f"Неизвестное действие: {action}"})}

    finally:
        cur.close()
        conn.close()