"""
Ядро складской логики: Минус-резерв + Автозакупка.
Копия из backend/reserves/warehouse_core.py — для использования внутри wip-builds функции.
"""

import json

SCHEMA = "t_p72635010_quantum_fusion_resea"
POSITIVE = "POSITIVE"
NEGATIVE = "NEGATIVE"


def log(cur, event, group_id=None, order_id=None, delta=None, payload=None):
    cur.execute(
        f"INSERT INTO {SCHEMA}.warehouse_stock_log (group_id, order_id, event, delta, payload) "
        f"VALUES (%s, %s, %s, %s, %s)",
        (group_id, order_id, event, delta, json.dumps(payload or {})),
    )


def _movement(cur, group_id, supply_id, order_id, mtype, qty_delta, note=None):
    cur.execute(
        f"INSERT INTO {SCHEMA}.warehouse_movements "
        f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
        f"VALUES (%s, %s, %s, %s, %s, %s, NOW())",
        (group_id, supply_id, order_id, mtype, qty_delta, note),
    )


def resolve_group_id(cur, product_id):
    if not product_id:
        return None
    cur.execute(
        f"SELECT id FROM {SCHEMA}.warehouse_groups WHERE product_id = %s LIMIT 1",
        (product_id,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def lock_group_supplies(cur, group_id):
    cur.execute(
        f"SELECT id, qty, qty_reserved, qty_negative, cost_price "
        f"FROM {SCHEMA}.warehouse_supplies "
        f"WHERE group_id = %s "
        f"ORDER BY COALESCE(purchase_date, created_at::date) ASC, id ASC "
        f"FOR UPDATE",
        (group_id,),
    )
    return cur.fetchall()


def _ensure_buffer_supply(cur, group_id):
    cur.execute(
        f"SELECT id FROM {SCHEMA}.warehouse_supplies WHERE group_id = %s ORDER BY id ASC LIMIT 1",
        (group_id,),
    )
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        f"INSERT INTO {SCHEMA}.warehouse_supplies (group_id, qty, qty_reserved, qty_negative, cost_price) "
        f"VALUES (%s, 0, 0, 0, 0) RETURNING id",
        (group_id,),
    )
    return cur.fetchone()[0]


def basket_add(cur, group_id, qty):
    if qty <= 0:
        return
    cur.execute(
        f"INSERT INTO {SCHEMA}.warehouse_purchase_basket (group_id, required_qty, status) "
        f"VALUES (%s, %s, 'NEW') "
        f"ON CONFLICT (group_id) DO UPDATE SET "
        f"required_qty = {SCHEMA}.warehouse_purchase_basket.required_qty + EXCLUDED.required_qty, "
        f"updated_at = NOW()",
        (group_id, qty),
    )
    log(cur, "basket_add", group_id=group_id, delta=qty)


def basket_reduce(cur, group_id, qty):
    if qty <= 0:
        return
    cur.execute(
        f"UPDATE {SCHEMA}.warehouse_purchase_basket "
        f"SET required_qty = GREATEST(0, required_qty - %s), updated_at = NOW() "
        f"WHERE group_id = %s AND status = 'NEW'",
        (qty, group_id),
    )
    log(cur, "basket_reduce", group_id=group_id, delta=-qty)


def reserve_line(cur, order_id, product_id, qty, slot=None):
    group_id = resolve_group_id(cur, product_id)
    if group_id is None:
        return {"status": "skipped", "skipped_reason": "user_hardware", "group_id": None,
                "positive": 0, "negative": 0}
    if qty is None or qty <= 0:
        return {"status": "skipped", "skipped_reason": "non_positive_qty", "group_id": group_id,
                "positive": 0, "negative": 0}

    supplies = lock_group_supplies(cur, group_id)
    free = sum(max(s[1], 0) for s in supplies) - sum(max(s[2], 0) for s in supplies)
    free = max(free, 0)

    take = min(free, qty)
    positive_done = 0

    if take > 0:
        remaining = take
        for sid, s_qty, s_res, s_neg, s_cost in supplies:
            if remaining <= 0:
                break
            avail = max(s_qty, 0)
            if avail <= 0:
                continue
            chunk = min(avail, remaining)
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies "
                f"SET qty = qty - %s, qty_reserved = qty_reserved + %s, updated_at = NOW() "
                f"WHERE id = %s",
                (chunk, chunk, sid),
            )
            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_reserves "
                f"(order_id, group_id, supply_id, slot, qty, type, status) "
                f"VALUES (%s, %s, %s, %s, %s, '{POSITIVE}', 'ACTIVE')",
                (order_id, group_id, sid, slot, chunk),
            )
            _movement(cur, group_id, sid, order_id, "reserved", chunk,
                      note=f"POSITIVE резерв по заказу #{order_id}")
            remaining -= chunk
            positive_done += chunk
        log(cur, "reserve_positive", group_id=group_id, order_id=order_id, delta=positive_done)

    shortage = qty - take
    if shortage > 0:
        buf = _ensure_buffer_supply(cur, group_id)
        cur.execute(
            f"UPDATE {SCHEMA}.warehouse_supplies "
            f"SET qty_negative = qty_negative + %s, updated_at = NOW() WHERE id = %s",
            (shortage, buf),
        )
        cur.execute(
            f"INSERT INTO {SCHEMA}.warehouse_reserves "
            f"(order_id, group_id, supply_id, slot, qty, type, status) "
            f"VALUES (%s, %s, %s, %s, %s, '{NEGATIVE}', 'ACTIVE')",
            (order_id, group_id, buf, slot, shortage),
        )
        _movement(cur, group_id, buf, order_id, "negative", -shortage,
                  note=f"NEGATIVE резерв по заказу #{order_id}")
        basket_add(cur, group_id, shortage)
        log(cur, "reserve_negative", group_id=group_id, order_id=order_id, delta=shortage)

    return {"status": "ok", "group_id": group_id,
            "positive": positive_done, "negative": shortage}


def handle_reserve_and_purchase(cur, order_id, lines):
    results = []
    log(cur, "handle_start", order_id=order_id, payload={"lines": len(lines)})
    for ln in lines:
        res = reserve_line(cur, order_id,
                           product_id=ln.get("product_id"),
                           qty=int(ln.get("qty", 0) or 0),
                           slot=ln.get("slot"))
        res["input"] = ln
        results.append(res)
    log(cur, "handle_done", order_id=order_id, payload={"results": len(results)})
    return results


def release_order_reserves(cur, order_id, only_new_negative=True):
    cur.execute(
        f"SELECT id, group_id, supply_id, qty, type FROM {SCHEMA}.warehouse_reserves "
        f"WHERE order_id = %s AND status = 'ACTIVE' FOR UPDATE",
        (order_id,),
    )
    rows = cur.fetchall()
    released = {"positive": 0, "negative": 0, "kept_ordered": 0}

    for rid, group_id, supply_id, r_qty, r_type in rows:
        if r_type == POSITIVE:
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies "
                f"SET qty = qty + %s, qty_reserved = GREATEST(0, qty_reserved - %s), updated_at = NOW() "
                f"WHERE id = %s",
                (r_qty, r_qty, supply_id),
            )
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_reserves SET status = 'RELEASED', updated_at = NOW() WHERE id = %s",
                (rid,),
            )
            _movement(cur, group_id, supply_id, order_id, "unreserved", -r_qty,
                      note=f"Снятие POSITIVE резерва (отмена заказа #{order_id})")
            released["positive"] += r_qty
        else:
            cur.execute(
                f"SELECT status FROM {SCHEMA}.warehouse_purchase_basket WHERE group_id = %s",
                (group_id,),
            )
            brow = cur.fetchone()
            basket_status = brow[0] if brow else "NEW"
            if only_new_negative and basket_status != "NEW":
                released["kept_ordered"] += r_qty
                continue
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies "
                f"SET qty_negative = GREATEST(0, qty_negative - %s), updated_at = NOW() "
                f"WHERE id = %s",
                (r_qty, supply_id),
            )
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_reserves SET status = 'RELEASED', updated_at = NOW() WHERE id = %s",
                (rid,),
            )
            basket_reduce(cur, group_id, r_qty)
            released["negative"] += r_qty

    log(cur, "release_order", order_id=order_id, payload=released)
    return released
