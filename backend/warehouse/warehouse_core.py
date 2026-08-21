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

# ── ГЛОБАЛЬНАЯ СИНХРОНИЗАЦИЯ РЕЗЕРВОВ ("Пересчитать резервы") ────────────────
def recalc_reserves_global(cur, group_id=None):
    """
    Привести счётчики партий (qty / qty_reserved / qty_negative) в соответствие
    с записями warehouse_reserves — они источник истины.

    Ключевое правило: считаем ПО ГРУППЕ товара, а не по отдельной партии.
    Если резерв «висит» на партии, где товара уже нет (перемещение, приёмка,
    замена в заказе), он сперва ПЕРЕПРИВЯЗЫВАЕТСЯ к другой партии той же группы
    со свободным остатком. Дефицитом (NEGATIVE) он становится, только если во
    всей группе реально нечего выдать. Иначе получался баг: резерв слетал в
    закупку, а свободная единица на соседней партии резервировалась заново —
    товар списывался дважды.

    group_id=None — пересчитать весь склад. Возвращает
    {"fixed": [...], "stale_closed": n}.
    """
    # Шаг 0: закрыть зависшие резервы на завершённых/отменённых заказах
    cur.execute(
        f"UPDATE {SCHEMA}.warehouse_reserves r "
        f"SET status = CASE WHEN o.status = 'cancelled' THEN 'RELEASED' ELSE 'FULFILLED' END, "
        f"    updated_at = NOW() "
        f"FROM {SCHEMA}.orders o "
        f"WHERE r.order_id = o.id AND r.status = 'ACTIVE' "
        f"AND o.status IN ('done', 'cancelled')"
    )
    stale_closed = cur.rowcount

    where = f"WHERE s.group_id = {int(group_id)} " if group_id else ""
    cur.execute(
        f"SELECT s.id, s.group_id, s.qty, s.qty_reserved, s.qty_negative, "
        f"COALESCE(SUM(r.qty) FILTER (WHERE r.type='POSITIVE' AND r.status='ACTIVE'), 0) AS pos, "
        f"COALESCE(SUM(r.qty) FILTER (WHERE r.type='NEGATIVE' AND r.status='ACTIVE'), 0) AS neg "
        f"FROM {SCHEMA}.warehouse_supplies s "
        f"LEFT JOIN {SCHEMA}.warehouse_reserves r ON r.supply_id = s.id "
        f"{where}"
        f"GROUP BY s.id, s.group_id, s.qty, s.qty_reserved, s.qty_negative "
        f"ORDER BY s.group_id, s.id"
    )
    rows = cur.fetchall()

    groups, order_of_groups = {}, []
    for r in rows:
        g = r[1]
        if g not in groups:
            groups[g] = []
            order_of_groups.append(g)
        groups[g].append(r)

    fixed = []
    for gid in order_of_groups:
        st = []
        for (sid, _g, qty, qty_res, qty_neg, want_pos, want_neg) in groups[gid]:
            qty = int(qty or 0); qty_res = int(qty_res or 0); qty_neg = int(qty_neg or 0)
            want_pos = int(want_pos or 0); want_neg = int(want_neg or 0)
            physical = qty + qty_res          # физически в партии
            new_res = min(want_pos, physical)
            st.append({
                "sid": sid, "qty": qty, "qty_res": qty_res, "qty_neg": qty_neg,
                "physical": physical, "new_res": new_res, "want_neg": want_neg,
                "overflow": want_pos - new_res,   # резерв без товара на этой партии
                "free": physical - new_res,       # свободное, куда можно перевесить
                "converted": 0, "rebound": 0,
            })

        for src in st:
            if src["overflow"] <= 0:
                continue
            cur.execute(
                f"SELECT id, qty FROM {SCHEMA}.warehouse_reserves "
                f"WHERE supply_id = %s AND type = 'POSITIVE' AND status = 'ACTIVE' "
                f"ORDER BY id DESC",
                (src["sid"],)
            )
            for rid, rq in cur.fetchall():
                if src["overflow"] <= 0:
                    break
                row_qty = int(rq or 0)
                need = min(row_qty, src["overflow"])
                while need > 0:
                    dst = next((d for d in st if d is not src and d["free"] > 0), None)
                    if dst is not None:
                        # 1) перевешиваем резерв на партию со свободным товаром
                        chunk = min(dst["free"], need)
                        if chunk == row_qty:
                            cur.execute(
                                f"UPDATE {SCHEMA}.warehouse_reserves "
                                f"SET supply_id = %s, updated_at = NOW() WHERE id = %s",
                                (dst["sid"], rid)
                            )
                        else:
                            cur.execute(
                                f"UPDATE {SCHEMA}.warehouse_reserves "
                                f"SET qty = qty - %s, updated_at = NOW() WHERE id = %s",
                                (chunk, rid)
                            )
                            cur.execute(
                                f"INSERT INTO {SCHEMA}.warehouse_reserves "
                                f"(order_id, group_id, supply_id, slot, qty, type, status) "
                                f"SELECT order_id, group_id, %s, slot, %s, '{POSITIVE}', 'ACTIVE' "
                                f"FROM {SCHEMA}.warehouse_reserves WHERE id = %s",
                                (dst["sid"], chunk, rid)
                            )
                        dst["free"] -= chunk
                        dst["new_res"] += chunk
                        src["rebound"] += chunk
                    else:
                        # 2) в группе товара нет — резерв становится дефицитом
                        chunk = need
                        if chunk == row_qty:
                            cur.execute(
                                f"UPDATE {SCHEMA}.warehouse_reserves "
                                f"SET type = '{NEGATIVE}', updated_at = NOW() WHERE id = %s",
                                (rid,)
                            )
                        else:
                            cur.execute(
                                f"UPDATE {SCHEMA}.warehouse_reserves "
                                f"SET qty = qty - %s, updated_at = NOW() WHERE id = %s",
                                (chunk, rid)
                            )
                            cur.execute(
                                f"INSERT INTO {SCHEMA}.warehouse_reserves "
                                f"(order_id, group_id, supply_id, slot, qty, type, status) "
                                f"SELECT order_id, group_id, supply_id, slot, %s, '{NEGATIVE}', 'ACTIVE' "
                                f"FROM {SCHEMA}.warehouse_reserves WHERE id = %s",
                                (chunk, rid)
                            )
                        src["converted"] += chunk
                        src["want_neg"] += chunk
                    row_qty -= chunk
                    need -= chunk
                    src["overflow"] -= chunk

        for s in st:
            new_res = s["new_res"]
            new_qty = s["physical"] - new_res
            want_neg = s["want_neg"]
            if (s["qty_res"] == new_res and s["qty"] == new_qty and s["qty_neg"] == want_neg
                    and s["converted"] == 0 and s["rebound"] == 0):
                continue
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies "
                f"SET qty = %s, qty_reserved = %s, qty_negative = %s, updated_at = NOW() "
                f"WHERE id = %s",
                (new_qty, new_res, want_neg, s["sid"])
            )
            log(cur, "recalc_reserves", group_id=gid, delta=s["qty_res"] - new_res, payload={
                "supply_id": s["sid"],
                "qty_reserved": {"was": s["qty_res"], "now": new_res},
                "qty_negative": {"was": s["qty_neg"], "now": want_neg},
                "qty": {"was": s["qty"], "now": new_qty},
                "pos_to_neg_converted": s["converted"],
                "rebound_to_other_supply": s["rebound"],
            })
            fixed.append({
                "supply_id": s["sid"], "group_id": gid,
                "reserved_was": s["qty_res"], "reserved_now": new_res,
                "negative_was": s["qty_neg"], "negative_now": want_neg,
                "qty_was": s["qty"], "qty_now": new_qty,
                "pos_to_neg_converted": s["converted"], "rebound": s["rebound"],
            })

    # Корзина закупки = сумма активных NEGATIVE-резервов
    basket_where = f"WHERE b.group_id = {int(group_id)}" if group_id else ""
    cur.execute(
        f"UPDATE {SCHEMA}.warehouse_purchase_basket b SET "
        f"required_qty = COALESCE((SELECT SUM(r.qty) FROM {SCHEMA}.warehouse_reserves r "
        f"  WHERE r.group_id = b.group_id AND r.type='{NEGATIVE}' AND r.status='ACTIVE'), 0), "
        f"updated_at = NOW() {basket_where}"
    )
    log(cur, "recalc_reserves_run", delta=len(fixed),
        payload={"fixed_supplies": len(fixed), "stale_closed": stale_closed})
    return {"fixed": fixed, "stale_closed": stale_closed}
