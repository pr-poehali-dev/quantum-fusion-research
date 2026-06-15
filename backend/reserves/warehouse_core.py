"""
Ядро складской логики: Минус-резерв + Автозакупка (Этап 1).

Переносимый модуль на чистом psycopg2 — не зависит от облачной обвязки,
может работать на собственном сервере. Все функции принимают КУРСОР
(cur) уже открытой транзакции и НЕ делают commit/rollback сами —
управление транзакцией остаётся за вызывающим кодом (ACID).

Термины и инвариант — см. WAREHOUSE_LOGIC.md.
"""

SCHEMA = "t_p72635010_quantum_fusion_resea"

POSITIVE = "POSITIVE"
NEGATIVE = "NEGATIVE"


# ── Технический лог (временный, для анализа на Этапе 1) ──────────────────────
def log(cur, event, group_id=None, order_id=None, delta=None, payload=None):
    import json
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


# ── Резолв group_id по product_id ───────────────────────────────────────────
def resolve_group_id(cur, product_id):
    """Вернуть group_id (SKU) для товара. None если товара/группы нет."""
    if not product_id:
        return None
    cur.execute(
        f"SELECT id FROM {SCHEMA}.warehouse_groups WHERE product_id = %s LIMIT 1",
        (product_id,),
    )
    row = cur.fetchone()
    return row[0] if row else None


# ── Блокировка партий группы (FOR UPDATE) ───────────────────────────────────
def lock_group_supplies(cur, group_id):
    """
    Заблокировать все партии группы для текущей транзакции (защита от гонок).
    Возвращает список партий [(id, qty, qty_reserved, qty_negative, cost_price)],
    отсортированных FIFO (по дате/себестоимости).
    """
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
    """
    Гарантировать наличие партии-буфера для хранения qty_negative,
    когда физических партий нет. Возвращает supply_id.
    Берём первую партию группы; если партий нет — создаём пустую.
    """
    cur.execute(
        f"SELECT id FROM {SCHEMA}.warehouse_supplies WHERE group_id = %s "
        f"ORDER BY id ASC LIMIT 1",
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


# ── Корзина закупки (агрегированная, источник истины) ───────────────────────
def basket_add(cur, group_id, qty):
    """Увеличить потребность по группе в корзине закупки (upsert)."""
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
    """
    Уменьшить потребность в корзине (при отмене заказа, если строка ещё NEW).
    Если строка ORDERED/RECEIVED — НЕ трогаем (товар уже заказан у поставщика).
    """
    if qty <= 0:
        return
    cur.execute(
        f"UPDATE {SCHEMA}.warehouse_purchase_basket "
        f"SET required_qty = GREATEST(0, required_qty - %s), updated_at = NOW() "
        f"WHERE group_id = %s AND status = 'NEW'",
        (qty, group_id),
    )
    log(cur, "basket_reduce", group_id=group_id, delta=-qty)


# ── ОСНОВНАЯ ФУНКЦИЯ: зарезервировать одну позицию ──────────────────────────
def reserve_line(cur, order_id, product_id, qty, slot=None):
    """
    Зарезервировать qty единиц товара под заказ.
    Реализует ветвление POSITIVE / частично / NEGATIVE.

    Возвращает dict с результатом:
      {status, group_id, positive, negative, skipped_reason}
    """
    # Пользовательское железо — нет привязки к складу
    group_id = resolve_group_id(cur, product_id)
    if group_id is None:
        return {"status": "skipped", "skipped_reason": "user_hardware", "group_id": None,
                "positive": 0, "negative": 0}

    # Возврат / некорректное кол-во — минус-резерв не применяем
    if qty is None or qty <= 0:
        return {"status": "skipped", "skipped_reason": "non_positive_qty", "group_id": group_id,
                "positive": 0, "negative": 0}

    supplies = lock_group_supplies(cur, group_id)  # FOR UPDATE
    free = sum(max(s[1], 0) for s in supplies) - sum(max(s[2], 0) for s in supplies)
    free = max(free, 0)

    take = min(free, qty)
    positive_done = 0

    # POSITIVE: раскладываем по партиям FIFO
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

    # NEGATIVE: остаток → минус-резерв + корзина закупки
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


# ── Обработка всего заказа ───────────────────────────────────────────────────
def handle_reserve_and_purchase(cur, order_id, lines):
    """
    Обработать резервирование всего заказа.
    lines: список dict {product_id, qty, slot}.
    Вызывается внутри транзакции вызывающего кода.
    """
    results = []
    log(cur, "handle_start", order_id=order_id, payload={"lines": len(lines)})
    for ln in lines:
        res = reserve_line(
            cur, order_id,
            product_id=ln.get("product_id"),
            qty=int(ln.get("qty", 0) or 0),
            slot=ln.get("slot"),
        )
        res["input"] = ln
        results.append(res)
    log(cur, "handle_done", order_id=order_id, payload={"results": len(results)})
    return results


# ── Снятие всех резервов заказа (отмена / пересчёт) ──────────────────────────
def release_order_reserves(cur, order_id, only_new_negative=True):
    """
    Снять активные резервы заказа.
    POSITIVE -> вернуть товар в наличие (qty += r, qty_reserved -= r).
    NEGATIVE -> уменьшить qty_negative и корзину, НО только если строка
                корзины ещё NEW (only_new_negative=True). Если ORDERED — не трогаем.
    """
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
        else:  # NEGATIVE
            # Проверяем статус строки корзины
            cur.execute(
                f"SELECT status FROM {SCHEMA}.warehouse_purchase_basket WHERE group_id = %s",
                (group_id,),
            )
            brow = cur.fetchone()
            basket_status = brow[0] if brow else "NEW"
            if only_new_negative and basket_status != "NEW":
                released["kept_ordered"] += r_qty
                continue  # товар уже заказан у поставщика — минус не снимаем
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


# ── ЭТАП 2: Приход товара + FIFO-гашение минус-резервов ──────────────────────
def receive_stock(cur, group_id, qty, cost_price=0, store_id=None, cell=None,
                  purchase_date=None, supply_id=None):
    """
    Приход товара на склад.
    1. Создаёт новую партию (или использует переданную supply_id).
    2. Гасит NEGATIVE-резервы группы FIFO по дате заказа (раньше заказ = приоритет):
       NEGATIVE -> POSITIVE (товар приехал и лёг под заказ).
    3. Уменьшает корзину закупки.

    Возвращает {supply_id, received, fulfilled, free_added, fulfilled_orders[]}.
    """
    if qty <= 0:
        return {"supply_id": supply_id, "received": 0, "fulfilled": 0,
                "free_added": 0, "fulfilled_orders": []}

    # 1. Создаём партию прихода (если не передана готовая)
    if supply_id is None:
        cur.execute(
            f"INSERT INTO {SCHEMA}.warehouse_supplies "
            f"(group_id, store_id, qty, qty_reserved, qty_negative, cost_price, cell, purchase_date) "
            f"VALUES (%s, %s, %s, 0, 0, %s, %s, %s) RETURNING id",
            (group_id, store_id, qty, cost_price, cell, purchase_date),
        )
        supply_id = cur.fetchone()[0]
    _movement(cur, group_id, supply_id, None, "supply_in", qty,
              note=f"Приход {qty} шт. на группу #{group_id}")
    log(cur, "receive_stock", group_id=group_id, delta=qty, payload={"supply_id": supply_id})

    # 2. Гасим NEGATIVE-резервы FIFO по дате заказа.
    #    Резервы отменённых/архивных заказов ИГНОРИРУЕМ — товар уйдёт в свободное наличие.
    cur.execute(
        f"SELECT r.id, r.order_id, r.supply_id, r.qty "
        f"FROM {SCHEMA}.warehouse_reserves r "
        f"JOIN {SCHEMA}.orders o ON o.id = r.order_id "
        f"WHERE r.group_id = %s AND r.type = '{NEGATIVE}' AND r.status = 'ACTIVE' "
        f"AND o.status NOT IN ('cancelled', 'archived') "
        f"ORDER BY o.created_at ASC, r.id ASC "
        f"FOR UPDATE OF r",
        (group_id,),
    )
    neg_reserves = cur.fetchall()

    available = qty           # сколько из прихода можем направить на гашение
    fulfilled_total = 0
    fulfilled_orders = []

    for rid, order_id, neg_supply_id, neg_qty in neg_reserves:
        if available <= 0:
            break
        clear = min(neg_qty, available)

        # Снимаем минус-резерв с его партии-буфера
        cur.execute(
            f"UPDATE {SCHEMA}.warehouse_supplies "
            f"SET qty_negative = GREATEST(0, qty_negative - %s), updated_at = NOW() WHERE id = %s",
            (clear, neg_supply_id),
        )
        # Переводим товар прихода в POSITIVE-резерв под этот заказ
        cur.execute(
            f"UPDATE {SCHEMA}.warehouse_supplies "
            f"SET qty = qty - %s, qty_reserved = qty_reserved + %s, updated_at = NOW() WHERE id = %s",
            (clear, clear, supply_id),
        )

        if clear == neg_qty:
            # Полностью погашен: NEGATIVE-резерв становится POSITIVE
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_reserves "
                f"SET type = '{POSITIVE}', status = 'ACTIVE', supply_id = %s, updated_at = NOW() "
                f"WHERE id = %s",
                (supply_id, rid),
            )
        else:
            # Частично: помечаем исходный FULFILLED на clear, создаём POSITIVE на clear,
            # уменьшаем остаток NEGATIVE
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_reserves "
                f"SET qty = qty - %s, updated_at = NOW() WHERE id = %s",
                (clear, rid),
            )
            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_reserves "
                f"(order_id, group_id, supply_id, slot, qty, type, status) "
                f"SELECT order_id, group_id, %s, slot, %s, '{POSITIVE}', 'ACTIVE' "
                f"FROM {SCHEMA}.warehouse_reserves WHERE id = %s",
                (supply_id, clear, rid),
            )

        _movement(cur, group_id, supply_id, order_id, "fulfilled", clear,
                  note=f"Гашение минус-резерва заказа #{order_id} приходом")
        basket_reduce(cur, group_id, clear)
        available -= clear
        fulfilled_total += clear
        fulfilled_orders.append({"order_id": order_id, "qty": clear})
        log(cur, "fulfill_negative", group_id=group_id, order_id=order_id, delta=clear)

    return {
        "supply_id": supply_id,
        "received": qty,
        "fulfilled": fulfilled_total,
        "free_added": available,           # осталось свободным на складе
        "fulfilled_orders": fulfilled_orders,
    }


# ── Пересчёт резервов заказа (при изменении состава) ─────────────────────────
def recalc_order_reserves(cur, order_id, lines):
    """
    ⚠️ ПРОВЕРИТЬ НА БАГИ (WAREHOUSE_BUGS.md).
    Снять все активные резервы заказа и наложить заново.
    Безопаснее дельт: пересобирает состояние с нуля.
    Минус-резервы со статусом корзины != NEW не снимаются — поэтому
    повторное наложение учтёт уже существующую потребность.
    """
    log(cur, "recalc_start", order_id=order_id, payload={"lines": len(lines)})
    release_order_reserves(cur, order_id, only_new_negative=True)
    results = handle_reserve_and_purchase(cur, order_id, lines)
    log(cur, "recalc_done", order_id=order_id)
    return results