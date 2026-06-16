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


def num(v, default=0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def serial(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if obj is None:
        return None
    return str(obj)


def resp(code, body):
    return {
        "statusCode": code,
        "headers": {**cors, "Content-Type": "application/json"},
        "isBase64Encoded": False,
        "body": json.dumps(body, default=serial, ensure_ascii=False),
    }


# ── СВОДКА ──────────────────────────────────────────────────────────────────
def get_summary(cur):
    """Сводка: стоимость склада, маржа за месяц (ПК/заказы), нал в кассе."""
    # Стоимость железа на складе (свободный остаток + резерв)
    cur.execute(
        f"SELECT "
        f"COALESCE(SUM((s.qty + s.qty_reserved) * s.cost_price), 0) AS purchase, "
        f"COALESCE(SUM((s.qty + s.qty_reserved) * COALESCE(g.price_retail, 0)), 0) AS sale "
        f"FROM {SCHEMA}.warehouse_supplies s "
        f"JOIN {SCHEMA}.warehouse_groups g ON g.id = s.group_id "
        f"WHERE g.is_archived = FALSE"
    )
    row = cur.fetchone()
    stock_purchase = num(row[0])
    stock_sale = num(row[1])

    # Маржа за текущий месяц по выданным заказам (status='done')
    # Маржа = total - сумма себестоимости компонентов из партий (через резервы)
    def margin_block(order_type):
        cur.execute(
            f"SELECT COUNT(*) AS cnt, "
            f"COALESCE(SUM(m.margin), 0) AS total_margin, "
            f"COALESCE(SUM(o.total), 0) AS revenue "
            f"FROM ( "
            f"  SELECT o.id, o.total, "
            f"    o.total - COALESCE(("
            f"      SELECT SUM(r.qty * sup.cost_price) "
            f"      FROM {SCHEMA}.warehouse_reserves r "
            f"      JOIN {SCHEMA}.warehouse_supplies sup ON sup.id = r.supply_id "
            f"      WHERE r.order_id = o.id AND r.type='POSITIVE' "
            f"        AND r.status IN ('FULFILLED','ACTIVE')"
            f"    ), 0) AS margin "
            f"  FROM {SCHEMA}.orders o "
            f"  WHERE o.status = 'done' "
            f"    AND o.order_type = {esc(order_type)} "
            f"    AND date_trunc('month', o.updated_at) = date_trunc('month', CURRENT_DATE) "
            f") m "
            f"JOIN {SCHEMA}.orders o ON o.id = m.id"
        )
        r = cur.fetchone()
        cnt = int(r[0])
        total_margin = num(r[1])
        revenue = num(r[2])
        avg = round(total_margin / cnt, 2) if cnt else 0
        return {"count": cnt, "total_margin": round(total_margin, 2),
                "avg_margin": avg, "revenue": round(revenue, 2)}

    pc = margin_block("pc_build")
    parts = margin_block("parts")

    # Нал в кассе: приходы - расходы - инкассация
    cur.execute(
        f"SELECT "
        f"COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END), 0) AS inc, "
        f"COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END), 0) AS exp, "
        f"COALESCE(SUM(CASE WHEN kind='collection' THEN amount ELSE 0 END), 0) AS coll "
        f"FROM {SCHEMA}.finance_transactions"
    )
    r = cur.fetchone()
    fin_income = num(r[0])
    fin_expense = num(r[1])
    fin_collection = num(r[2])

    # В кассу добавляем выручку выданных заказов (нал) минус себестоимость не нужна — это деньги
    cur.execute(
        f"SELECT COALESCE(SUM(total), 0) FROM {SCHEMA}.orders WHERE status='done'"
    )
    sales_cash = num(cur.fetchone()[0])

    cash = sales_cash + fin_income - fin_expense - fin_collection

    return {
        "stock": {"purchase": round(stock_purchase, 2), "sale": round(stock_sale, 2)},
        "margin_pc": pc,
        "margin_parts": parts,
        "cash": round(cash, 2),
        "fin": {
            "income": round(fin_income, 2),
            "expense": round(fin_expense, 2),
            "collection": round(fin_collection, 2),
            "sales_cash": round(sales_cash, 2),
        },
    }


# ── ЛОГ ДВИЖЕНИЯ СРЕДСТВ ─────────────────────────────────────────────────────
def get_log(cur, limit=200, offset=0):
    """Единый лог: финансовые транзакции + продажи (выданные заказы)."""
    items = []

    # Финансовые транзакции
    cur.execute(
        f"SELECT t.id, t.kind, t.amount, t.note, t.occurred_at, t.affects_pnl, "
        f"ft.name AS type_name, u.username "
        f"FROM {SCHEMA}.finance_transactions t "
        f"LEFT JOIN {SCHEMA}.finance_types ft ON ft.id = t.type_id "
        f"LEFT JOIN {SCHEMA}.users u ON u.id = t.user_id "
        f"ORDER BY t.occurred_at DESC LIMIT {int(limit)} OFFSET {int(offset)}"
    )
    for r in cur.fetchall():
        items.append({
            "source": "finance",
            "id": r[0],
            "kind": r[1],
            "amount": num(r[2]),
            "note": r[3],
            "occurred_at": serial(r[4]),
            "affects_pnl": r[5],
            "type_name": r[6],
            "user": r[7],
        })

    # Продажи (выданные заказы) — как приход
    cur.execute(
        f"SELECT o.id, o.order_type, o.total, o.customer_name, o.updated_at "
        f"FROM {SCHEMA}.orders o WHERE o.status='done' "
        f"ORDER BY o.updated_at DESC LIMIT {int(limit)}"
    )
    for r in cur.fetchall():
        items.append({
            "source": "sale",
            "id": r[0],
            "kind": "income",
            "amount": num(r[2]),
            "note": f"Заказ #{r[0]} — {r[3]}",
            "occurred_at": serial(r[4]),
            "affects_pnl": True,
            "type_name": "Продажа ПК" if r[1] == "pc_build" else "Продажа товаров",
            "order_type": r[1],
            "user": None,
        })

    items.sort(key=lambda x: x["occurred_at"] or "", reverse=True)
    return items[:limit]


# ── ТИПЫ ОПЕРАЦИЙ ────────────────────────────────────────────────────────────
def get_types(cur):
    cur.execute(
        f"SELECT id, name, direction, is_system, sort_order "
        f"FROM {SCHEMA}.finance_types ORDER BY direction, sort_order, name"
    )
    return [{"id": r[0], "name": r[1], "direction": r[2],
             "is_system": r[3], "sort_order": r[4]} for r in cur.fetchall()]


def handler(event: dict, context) -> dict:
    """Финансы: сводка по деньгам, лог движения средств, расходы/приходы, инкассация, типы операций."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "isBase64Encoded": False, "body": ""}

    params = event.get("queryStringParameters") or {}
    action = params.get("action", "")
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except (ValueError, TypeError):
            body = {}
    if not action:
        action = body.get("action", "")

    conn = get_conn()
    cur = conn.cursor()
    try:
        # ── GET ──
        if method == "GET":
            if action == "summary":
                return resp(200, {"summary": get_summary(cur)})
            if action == "log":
                limit = int(params.get("limit", 200))
                offset = int(params.get("offset", 0))
                return resp(200, {"items": get_log(cur, limit, offset)})
            if action == "types":
                return resp(200, {"types": get_types(cur)})
            return resp(400, {"error": "unknown action"})

        # ── POST ──
        if method == "POST":
            # Добавить транзакцию (расход / приход / инкассация)
            if action == "add_tx":
                kind = body.get("kind")  # income | expense | collection
                if kind not in ("income", "expense", "collection"):
                    return resp(400, {"error": "bad kind"})
                amount = num(body.get("amount"), 0)
                if amount <= 0:
                    return resp(400, {"error": "amount must be > 0"})
                type_id = body.get("type_id")
                note = body.get("note", "")
                affects_pnl = kind != "collection"  # инкассация не влияет на прибыль
                user_id = body.get("user_id")
                occurred = body.get("occurred_at")
                cur.execute(
                    f"INSERT INTO {SCHEMA}.finance_transactions "
                    f"(kind, type_id, amount, note, affects_pnl, user_id, occurred_at) "
                    f"VALUES ({esc(kind)}, {esc(type_id) if type_id else 'NULL'}, "
                    f"{amount}, {esc(note)}, {affects_pnl}, "
                    f"{esc(user_id) if user_id else 'NULL'}, "
                    f"{esc(occurred) if occurred else 'NOW()'}) RETURNING id"
                )
                tx_id = cur.fetchone()[0]
                conn.commit()
                return resp(200, {"ok": True, "id": tx_id})

            # Добавить тип операции
            if action == "add_type":
                name = body.get("name", "").strip()
                direction = body.get("direction")
                if not name or direction not in ("income", "expense", "collection"):
                    return resp(400, {"error": "bad type"})
                cur.execute(
                    f"INSERT INTO {SCHEMA}.finance_types (name, direction, is_system, sort_order) "
                    f"VALUES ({esc(name)}, {esc(direction)}, FALSE, 100) RETURNING id"
                )
                tid = cur.fetchone()[0]
                conn.commit()
                return resp(200, {"ok": True, "id": tid})

            return resp(400, {"error": "unknown action"})

        # ── DELETE ──
        if method == "DELETE":
            if action == "del_tx":
                tx_id = params.get("id") or body.get("id")
                cur.execute(
                    f"DELETE FROM {SCHEMA}.finance_transactions WHERE id = {esc(tx_id)}"
                )
                conn.commit()
                return resp(200, {"ok": True})
            if action == "del_type":
                tid = params.get("id") or body.get("id")
                cur.execute(
                    f"DELETE FROM {SCHEMA}.finance_types WHERE id = {esc(tid)} AND is_system = FALSE"
                )
                conn.commit()
                return resp(200, {"ok": True})
            return resp(400, {"error": "unknown action"})

        return resp(405, {"error": "method not allowed"})
    finally:
        cur.close()
        conn.close()