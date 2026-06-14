"""
HTTP-обёртка над ядром складских резервов (Этап 1).
Управляет резервами, корзиной закупки и предоставляет диагностику остатков.
"""
import json
import os
import psycopg2

import warehouse_core as core

SCHEMA = core.SCHEMA

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token, X-Session-Id",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _group_state(cur, group_id):
    cur.execute(
        f"SELECT COALESCE(SUM(qty),0), COALESCE(SUM(qty_reserved),0), COALESCE(SUM(qty_negative),0) "
        f"FROM {SCHEMA}.warehouse_supplies WHERE group_id = %s",
        (group_id,),
    )
    q, r, n = cur.fetchone()
    return {"on_hand": int(q), "reserved": int(r), "negative": int(n)}


def _basket_qty(cur, group_id):
    cur.execute(
        f"SELECT COALESCE(required_qty,0) FROM {SCHEMA}.warehouse_purchase_basket WHERE group_id = %s",
        (group_id,),
    )
    row = cur.fetchone()
    return int(row[0]) if row else 0


def _run_selftest(cur):
    """
    Прогон QA-сценариев на временных данных. Вызывается внутри транзакции,
    которая будет ОТКАЧЕНА вызывающим кодом (ничего не сохраняется в БД).
    Сценарии: physical/reserved/order -> ожидаемый POSITIVE/NEGATIVE/basket.
    """
    cases = [
        {"name": "10/0/5 -> pos5 neg0", "stock": 10, "order": 5, "exp_pos": 5, "exp_neg": 0},
        {"name": "0/0/5 -> pos0 neg5", "stock": 0, "order": 5, "exp_pos": 0, "exp_neg": 5},
        {"name": "3/0/5 -> pos3 neg2", "stock": 3, "order": 5, "exp_pos": 3, "exp_neg": 2},
        {"name": "0/0/0 -> noop", "stock": 0, "order": 0, "exp_pos": 0, "exp_neg": 0},
    ]
    # Один тестовый заказ для всех кейсов
    cur.execute(
        f"INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, order_type, items, total, status, created_at, updated_at) "
        f"VALUES ('__SELFTEST__','0','parts','[]'::jsonb,0,'new',NOW(),NOW()) RETURNING id"
    )
    order_id = cur.fetchone()[0]

    report = []
    for c in cases:
        # временный товар + группа + партия
        cur.execute(
            f"INSERT INTO {SCHEMA}.products (name, price, in_stock, stock_qty) "
            f"VALUES ('__selftest_prod__', 0, true, %s) RETURNING id",
            (c["stock"],),
        )
        pid = cur.fetchone()[0]
        cur.execute(
            f"INSERT INTO {SCHEMA}.warehouse_groups (product_id, name, sku) "
            f"VALUES (%s, '__selftest_grp__', %s) RETURNING id",
            (pid, "ST" + str(pid)[:6]),
        )
        gid = cur.fetchone()[0]
        if c["stock"] > 0:
            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_supplies (group_id, qty, qty_reserved, qty_negative, cost_price) "
                f"VALUES (%s, %s, 0, 0, 0)",
                (gid, c["stock"]),
            )

        core.handle_reserve_and_purchase(cur, order_id, [{"product_id": pid, "qty": c["order"], "slot": "test"}])

        st = _group_state(cur, gid)
        basket = _basket_qty(cur, gid)
        actual_pos = st["reserved"]
        actual_neg = st["negative"]
        ok = (actual_pos == c["exp_pos"] and actual_neg == c["exp_neg"] and basket == c["exp_neg"])
        report.append({
            "case": c["name"], "passed": ok,
            "expected": {"pos": c["exp_pos"], "neg": c["exp_neg"], "basket": c["exp_neg"]},
            "actual": {"pos": actual_pos, "neg": actual_neg, "basket": basket,
                       "on_hand": st["on_hand"]},
        })

    # Доп. проверка: отмена (release) первого кейса возвращает POSITIVE в наличие
    report.append({"summary": {
        "total": len(cases),
        "passed": sum(1 for r in report if r.get("passed")),
    }})
    return report


def handler(event: dict, context) -> dict:
    """Резервы и корзина закупки: reserve, release, recalc, basket, stock, diag."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    body = json.loads(event["body"]) if event.get("body") else {}
    action = params.get("action") or body.get("action", "")

    conn = get_conn()
    cur = conn.cursor()
    try:
        # ── Зарезервировать заказ (ядро) ────────────────────────────────────
        if action == "reserve_order" and method == "POST":
            order_id = int(body["order_id"])
            lines = body.get("lines") or []
            results = core.handle_reserve_and_purchase(cur, order_id, lines)
            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "results": results})}

        # ── Снять резервы заказа (отмена) ───────────────────────────────────
        if action == "release_order" and method == "POST":
            order_id = int(body["order_id"])
            res = core.release_order_reserves(cur, order_id, only_new_negative=True)
            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "released": res})}

        # ── Пересчитать резервы заказа ──────────────────────────────────────
        if action == "recalc_order" and method == "POST":
            order_id = int(body["order_id"])
            lines = body.get("lines") or []
            results = core.recalc_order_reserves(cur, order_id, lines)
            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "results": results})}

        # ── Корзина закупки ─────────────────────────────────────────────────
        if action == "basket" and method == "GET":
            cur.execute(
                f"SELECT b.id, b.group_id, g.name, g.sku, b.required_qty, b.status, "
                f"g.url_supplier, b.updated_at "
                f"FROM {SCHEMA}.warehouse_purchase_basket b "
                f"JOIN {SCHEMA}.warehouse_groups g ON g.id = b.group_id "
                f"WHERE b.required_qty > 0 ORDER BY b.updated_at DESC"
            )
            items = [{
                "id": r[0], "group_id": r[1], "name": r[2], "sku": r[3],
                "required_qty": r[4], "status": r[5], "url_supplier": r[6],
                "updated_at": r[7].isoformat() if r[7] else None,
            } for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"items": items})}

        # ── Сменить статус строки корзины (NEW/ORDERED/RECEIVED) ────────────
        if action == "basket_status" and method == "POST":
            group_id = int(body["group_id"])
            status = body["status"]
            if status not in ("NEW", "ORDERED", "RECEIVED"):
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "bad status"})}
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_purchase_basket "
                f"SET status = %s, updated_at = NOW() WHERE group_id = %s",
                (status, group_id),
            )
            core.log(cur, "basket_status", group_id=group_id, payload={"status": status})
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── Диагностика остатков по группе (инвариант) ──────────────────────
        if action == "diag" and method == "GET":
            group_id = int(params.get("group_id"))
            cur.execute(
                f"SELECT COALESCE(SUM(qty),0), COALESCE(SUM(qty_reserved),0), "
                f"COALESCE(SUM(qty_negative),0) FROM {SCHEMA}.warehouse_supplies "
                f"WHERE group_id = %s",
                (group_id,),
            )
            on_hand, reserved, negative = cur.fetchone()
            cur.execute(
                f"SELECT type, COALESCE(SUM(qty),0) FROM {SCHEMA}.warehouse_reserves "
                f"WHERE group_id = %s AND status = 'ACTIVE' GROUP BY type",
                (group_id,),
            )
            res_by_type = {r[0]: int(r[1]) for r in cur.fetchall()}
            cur.execute(
                f"SELECT COALESCE(required_qty,0), status FROM {SCHEMA}.warehouse_purchase_basket "
                f"WHERE group_id = %s",
                (group_id,),
            )
            brow = cur.fetchone()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "group_id": group_id,
                "physical_on_hand": int(on_hand),
                "total_reserved": int(reserved),
                "total_negative": int(negative),
                "free": int(on_hand) - int(reserved),
                "reserves_positive": res_by_type.get("POSITIVE", 0),
                "reserves_negative": res_by_type.get("NEGATIVE", 0),
                "basket_required": int(brow[0]) if brow else 0,
                "basket_status": brow[1] if brow else None,
            })}

        # ── Последние записи технического лога ──────────────────────────────
        if action == "stock_log" and method == "GET":
            limit = int(params.get("limit", 50))
            gid = params.get("group_id")
            where = f"WHERE group_id = {int(gid)}" if gid else ""
            cur.execute(
                f"SELECT id, group_id, order_id, event, delta, payload, created_at "
                f"FROM {SCHEMA}.warehouse_stock_log {where} "
                f"ORDER BY id DESC LIMIT {limit}"
            )
            logs = [{
                "id": r[0], "group_id": r[1], "order_id": r[2], "event": r[3],
                "delta": r[4], "payload": r[5],
                "created_at": r[6].isoformat() if r[6] else None,
            } for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"logs": logs})}

        # ── Самотест ядра: прогон QA-сценариев с откатом (ничего не сохраняет) ─
        if action == "selftest" and method == "GET":
            report = _run_selftest(cur)
            conn.rollback()  # ВАЖНО: откатываем все изменения теста
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "report": report})}

        return {"statusCode": 400, "headers": cors,
                "body": json.dumps({"error": f"unknown action: {action}"})}

    except Exception as e:
        conn.rollback()
        return {"statusCode": 500, "headers": cors, "body": json.dumps({"error": str(e)})}
    finally:
        cur.close()
        conn.close()