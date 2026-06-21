"""Реестр серийных номеров (SnArhive).

Хранит связь серийник -> товар -> поставка -> магазин (откуда купили).
Главная цель: при гарантийке подставлять место покупки по серийнику процессора
(самая частая на возврат железка, покупаем в разных местах).

Actions (GET/POST через ?action= или body.action):
  list_serials   — список/поиск серийников с фильтрами (q, category, store_id, status)
  lookup         — магазин и данные по конкретному серийнику (?serial=...)
  add_serials    — массово добавить серийники к поставке (приёмка)
  update_serial  — изменить серийник/заметку/магазин
  delete_serial  — удалить запись
  categories     — список категорий, включённых в учёт серийников
  category_add   — включить категорию в учёт
  category_remove— выключить категорию
  stores         — список магазинов (для фильтров/выбора)
"""
import json
import os
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


def jdefault(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    return str(obj)


def ok(data):
    return {"statusCode": 200, "headers": cors,
            "body": json.dumps(data, default=jdefault)}


def err(msg, code=400):
    return {"statusCode": code, "headers": cors,
            "body": json.dumps({"error": msg})}


def handler(event, context):
    """Реестр серийных номеров: приёмка, поиск, привязка магазина, категории."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    params = event.get("queryStringParameters") or {}
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            body = {}
    action = params.get("action") or body.get("action") or "list_serials"

    conn = get_conn()
    cur = conn.cursor()
    try:
        if action == "list_serials":
            return list_serials(cur, params)
        if action == "lookup":
            return lookup(cur, params)
        if action == "add_serials":
            res = add_serials(cur, body)
            conn.commit()
            return res
        if action == "update_serial":
            res = update_serial(cur, body)
            conn.commit()
            return res
        if action == "delete_serial":
            res = delete_serial(cur, body, params)
            conn.commit()
            return res
        if action == "categories":
            return categories(cur)
        if action == "category_add":
            res = category_add(cur, body)
            conn.commit()
            return res
        if action == "category_remove":
            res = category_remove(cur, body, params)
            conn.commit()
            return res
        if action == "stores":
            return stores(cur)
        return err(f"unknown action: {action}")
    except Exception as e:
        conn.rollback()
        return err(str(e), 500)
    finally:
        cur.close()
        conn.close()


def list_serials(cur, params):
    q = (params.get("q") or "").strip()
    category = (params.get("category") or "").strip()
    store_id = params.get("store_id")
    status = (params.get("status") or "").strip()
    limit = int(params.get("limit") or 200)

    where = ["1=1"]
    if q:
        like = "%" + q.replace("'", "''") + "%"
        where.append(
            f"(a.serial ILIKE '{like}' OR a.product_name ILIKE '{like}')")
    if category:
        where.append(f"a.category = {esc(category)}")
    if store_id and str(store_id).isdigit():
        where.append(f"a.store_id = {int(store_id)}")
    if status:
        where.append(f"a.status = {esc(status)}")

    cur.execute(
        f"SELECT a.id, a.serial, a.category, a.product_name, a.group_id, "
        f"a.supply_id, a.product_id, a.store_id, st.name AS store_name, "
        f"st.code AS store_code, a.purchase_date, a.warranty_until, "
        f"a.status, a.order_id, a.note, a.created_at "
        f"FROM {SCHEMA}.sn_archive a "
        f"LEFT JOIN {SCHEMA}.warehouse_stores st ON st.id = a.store_id "
        f"WHERE {' AND '.join(where)} "
        f"ORDER BY a.id DESC LIMIT {limit}"
    )
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return ok({"serials": rows})


def lookup(cur, params):
    serial = (params.get("serial") or "").strip()
    if not serial:
        return err("serial required")
    cur.execute(
        f"SELECT a.id, a.serial, a.category, a.product_name, a.store_id, "
        f"st.name AS store_name, st.code AS store_code, a.purchase_date, "
        f"a.warranty_until, a.status, a.order_id "
        f"FROM {SCHEMA}.sn_archive a "
        f"LEFT JOIN {SCHEMA}.warehouse_stores st ON st.id = a.store_id "
        f"WHERE a.serial = {esc(serial)} ORDER BY a.id DESC LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        return ok({"found": False})
    cols = [d[0] for d in cur.description]
    return ok({"found": True, "record": dict(zip(cols, row))})


def add_serials(cur, body):
    """Массовое добавление серийников к поставке (приёмка).
    Магазин берём из самой поставки (store_id поставки)."""
    supply_id = body.get("supply_id")
    serials = body.get("serials") or []
    if not supply_id:
        return err("supply_id required")
    serials = [str(s).strip() for s in serials if str(s).strip()]
    if not serials:
        return err("serials required")

    # Данные поставки: группа, товар, магазин, даты, категория.
    cur.execute(
        f"SELECT s.id, s.group_id, s.store_id, s.purchase_date, s.warranty_until, "
        f"g.product_id, g.name, g.category "
        f"FROM {SCHEMA}.warehouse_supplies s "
        f"JOIN {SCHEMA}.warehouse_groups g ON g.id = s.group_id "
        f"WHERE s.id = {int(supply_id)}"
    )
    sup = cur.fetchone()
    if not sup:
        return err("supply not found", 404)
    (_sid, group_id, store_id, purchase_date, warranty_until,
     product_id, gname, category) = sup

    added = []
    for sn in serials:
        cur.execute(
            f"INSERT INTO {SCHEMA}.sn_archive "
            f"(serial, group_id, supply_id, product_id, store_id, category, "
            f"product_name, purchase_date, warranty_until, status) "
            f"VALUES ({esc(sn)}, {int(group_id)}, {int(supply_id)}, "
            f"{esc(product_id) if product_id else 'NULL'}, "
            f"{esc(store_id) if store_id else 'NULL'}, {esc(category)}, "
            f"{esc(gname)}, {esc(purchase_date) if purchase_date else 'NULL'}, "
            f"{esc(warranty_until) if warranty_until else 'NULL'}, 'in_stock') "
            f"RETURNING id"
        )
        added.append(cur.fetchone()[0])
    return ok({"added": len(added), "ids": added})


def update_serial(cur, body):
    sid = body.get("id")
    if not sid:
        return err("id required")
    sets = []
    if "serial" in body:
        sets.append(f"serial = {esc(str(body['serial']).strip())}")
    if "note" in body:
        sets.append(f"note = {esc(body['note'])}")
    if "store_id" in body:
        st = body["store_id"]
        sets.append(f"store_id = {int(st) if st else 'NULL'}")
    if "status" in body:
        sets.append(f"status = {esc(body['status'])}")
    if not sets:
        return err("nothing to update")
    sets.append("updated_at = NOW()")
    cur.execute(
        f"UPDATE {SCHEMA}.sn_archive SET {', '.join(sets)} "
        f"WHERE id = {int(sid)}"
    )
    return ok({"updated": True})


def delete_serial(cur, body, params):
    sid = body.get("id") or params.get("id")
    if not sid:
        return err("id required")
    cur.execute(f"DELETE FROM {SCHEMA}.sn_archive WHERE id = {int(sid)}")
    return ok({"deleted": True})


def categories(cur):
    cur.execute(
        f"SELECT id, category, require_serial, created_at "
        f"FROM {SCHEMA}.sn_categories ORDER BY category"
    )
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return ok({"categories": rows})


def category_add(cur, body):
    category = (body.get("category") or "").strip()
    if not category:
        return err("category required")
    require_serial = bool(body.get("require_serial", True))
    cur.execute(
        f"INSERT INTO {SCHEMA}.sn_categories (category, require_serial) "
        f"VALUES ({esc(category)}, {str(require_serial).upper()}) "
        f"ON CONFLICT (category) DO UPDATE SET "
        f"require_serial = EXCLUDED.require_serial RETURNING id"
    )
    return ok({"id": cur.fetchone()[0]})


def category_remove(cur, body, params):
    category = (body.get("category") or params.get("category") or "").strip()
    cid = body.get("id") or params.get("id")
    if cid:
        cur.execute(f"DELETE FROM {SCHEMA}.sn_categories WHERE id = {int(cid)}")
    elif category:
        cur.execute(
            f"DELETE FROM {SCHEMA}.sn_categories WHERE category = {esc(category)}")
    else:
        return err("id or category required")
    return ok({"removed": True})


def stores(cur):
    cur.execute(
        f"SELECT id, name, code FROM {SCHEMA}.warehouse_stores ORDER BY name")
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return ok({"stores": rows})
