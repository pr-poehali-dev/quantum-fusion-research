"""
Ядро складской логики: Минус-резерв + Автозакупка. v2
Копия из backend/reserves/warehouse_core.py — для использования внутри warehouse функции.
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


def _apply_vat(base, vat):
    """Цена продажи с НДС: +22% и округление вверх до 250 ₽ (как на фронте)."""
    import math
    if vat:
        return math.ceil(base * 1.22 / 250.0) * 250
    return base


def recalc_builds_for_product(cur, product_id, new_price):
    """Пересчёт цен ПРОДАЖНЫХ сборок, где есть данный товар (catalog/source_id).
    Обновляет components[].price, parts_total, total_price (+НДС если sell_with_vat).
    НЕ трогает сборки из наличия (in_stock=TRUE) и архивные (status='archive').
    Возвращает кол-во обновлённых сборок."""
    cur.execute(
        f"SELECT id, components, assembly_fee, sell_with_vat FROM {SCHEMA}.pc_builds "
        f"WHERE COALESCE(in_stock, FALSE) = FALSE AND COALESCE(status, '') <> 'archive' "
        f"AND components::text LIKE %s",
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
        total_price = _apply_vat(parts_total + float(assembly_fee or 0), bool(sell_with_vat))
        cur.execute(
            f"UPDATE {SCHEMA}.pc_builds SET components=%s, parts_total=%s, total_price=%s WHERE id=%s",
            (json.dumps(comps), parts_total, total_price, build_id)
        )
        updated += 1
    return updated


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
            if supply_id:
                cur.execute(
                    f"UPDATE {SCHEMA}.warehouse_supplies "
                    f"SET qty = qty + %s, qty_reserved = GREATEST(0, qty_reserved - %s), updated_at = NOW() "
                    f"WHERE id = %s",
                    (r_qty, r_qty, supply_id),
                )
            else:
                cur.execute(
                    f"UPDATE {SCHEMA}.warehouse_supplies "
                    f"SET qty_reserved = GREATEST(0, qty_reserved - %s), updated_at = NOW() "
                    f"WHERE group_id = %s",
                    (r_qty, group_id),
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
            # Оставляем нехватку в закупке ТОЛЬКО если товар уже заказан у
            # поставщика и ещё не пришёл (ORDERED). NEW и RECEIVED — снимаем.
            if only_new_negative and basket_status == "ORDERED":
                released["kept_ordered"] += r_qty
                continue
            if supply_id:
                cur.execute(
                    f"UPDATE {SCHEMA}.warehouse_supplies "
                    f"SET qty_negative = GREATEST(0, qty_negative - %s), updated_at = NOW() "
                    f"WHERE id = %s",
                    (r_qty, supply_id),
                )
            else:
                cur.execute(
                    f"UPDATE {SCHEMA}.warehouse_supplies "
                    f"SET qty_negative = GREATEST(0, qty_negative - %s), updated_at = NOW() "
                    f"WHERE group_id = %s",
                    (r_qty, group_id),
                )
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_reserves SET status = 'RELEASED', updated_at = NOW() WHERE id = %s",
                (rid,),
            )
            basket_reduce(cur, group_id, r_qty)
            released["negative"] += r_qty

    log(cur, "release_order", order_id=order_id, payload=released)
    return released