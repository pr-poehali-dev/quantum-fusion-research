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


def ensure_order_reserves(cur, order_id, build_id=None):
    """
    Идемпотентно гарантирует, что резервы под сборку заказа созданы.
    Если у заказа уже есть активные резервы (POSITIVE/NEGATIVE) — ничего не
    делает. Иначе берёт состав сборки из pc_builds.components и резервирует
    каждую позицию через handle_reserve_and_purchase.

    Нужна, потому что сборка может уйти в рабочую стадию («Ожидание железа» и
    т.п.) в обход ручного перехода на «Заказ» (через автопереход этапа при
    установке ETA / приёмке) — и тогда резервы не создавались.
    Возвращает список результатов резервирования (или [] если резервы уже были).
    """
    if not order_id:
        return []
    # Уже есть активные резервы заказа → не дублируем
    cur.execute(
        f"SELECT 1 FROM {SCHEMA}.warehouse_reserves "
        f"WHERE order_id = %s AND status = 'ACTIVE' LIMIT 1",
        (order_id,),
    )
    if cur.fetchone():
        return []
    # Определяем build_id, если не передан
    if build_id is None:
        cur.execute(
            f"SELECT build_id FROM {SCHEMA}.wip_builds WHERE order_id = %s AND build_id IS NOT NULL LIMIT 1",
            (order_id,),
        )
        r = cur.fetchone()
        build_id = r[0] if r else None
    if not build_id:
        return []
    cur.execute(f"SELECT components FROM {SCHEMA}.pc_builds WHERE id = %s", (build_id,))
    pb = cur.fetchone()
    if not pb or not pb[0]:
        return []
    import json as _json
    comps = pb[0] if isinstance(pb[0], list) else _json.loads(pb[0] or "[]")
    lines = []
    for c in comps:
        lines.append({
            "product_id": int(c["source_id"]) if c.get("source_id") else None,
            "qty": int(c.get("qty", 1)),
            "slot": c.get("slot", ""),
        })
    if not lines:
        return []
    return handle_reserve_and_purchase(cur, order_id, lines)


def reserve_parts_order(cur, order_id):
    """
    Идемпотентно зарезервировать товары parts-заказа по его items.
    Вызывается после подтверждения предоплаты (prepayment_confirmed).
    Если у заказа уже есть активные резервы — ничего не делает.
    Возвращает список результатов (или [] если резервировать нечего/уже есть).
    """
    if not order_id:
        return []
    cur.execute(
        f"SELECT 1 FROM {SCHEMA}.warehouse_reserves "
        f"WHERE order_id = %s AND status = 'ACTIVE' LIMIT 1",
        (order_id,),
    )
    if cur.fetchone():
        return []
    cur.execute(
        f"SELECT order_type, items FROM {SCHEMA}.orders WHERE id = %s",
        (order_id,),
    )
    row = cur.fetchone()
    if not row or row[0] != "parts":
        return []
    import json as _json
    items = row[1] if isinstance(row[1], list) else _json.loads(row[1] or "[]")
    lines = [
        {"product_id": int(it["id"]), "qty": int(it.get("quantity", 1)), "slot": "product"}
        for it in items
        if it.get("item_type") == "product" and it.get("id")
    ]
    if not lines:
        return []
    return handle_reserve_and_purchase(cur, order_id, lines)


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
            # Оставляем нехватку в закупке ТОЛЬКО если товар уже заказан у
            # поставщика и ещё не пришёл (ORDERED). NEW (не заказан) и RECEIVED
            # (получен, лежит в наличии) — снимаем.
            if only_new_negative and basket_status == "ORDERED":
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


# ── Выдача заказа клиенту: списание резервов со склада ───────────────────────
def fulfill_order_reserves(cur, order_id):
    """
    Списать резервы заказа при ВЫДАЧЕ клиенту (этап «Забрали»).
    POSITIVE -> товар уходит клиенту: qty_reserved -= r, qty НЕ растёт
                (в отличие от отмены, где товар возвращается в наличие).
                Резерв закрывается со статусом FULFILLED.
    NEGATIVE -> закрываем долг как FULFILLED, qty_negative -= r
                (товар выдан — дефицита под этот заказ больше нет).
    Идемпотентно: повторный вызов ничего не делает (нет ACTIVE-резервов).
    Возвращает {"positive": n, "negative": n}.
    """
    cur.execute(
        f"SELECT id, group_id, supply_id, qty, type FROM {SCHEMA}.warehouse_reserves "
        f"WHERE order_id = %s AND status = 'ACTIVE' FOR UPDATE",
        (order_id,),
    )
    rows = cur.fetchall()
    fulfilled = {"positive": 0, "negative": 0}
    for rid, group_id, supply_id, r_qty, r_type in rows:
        if r_type == POSITIVE:
            # Товар физически ушёл клиенту: снимаем из резерва, в наличие НЕ возвращаем
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies "
                f"SET qty_reserved = GREATEST(0, qty_reserved - %s), updated_at = NOW() "
                f"WHERE id = %s",
                (r_qty, supply_id),
            )
            _movement(cur, group_id, supply_id, order_id, "issued", -r_qty,
                      note=f"Выдача клиенту (заказ #{order_id})")
            fulfilled["positive"] += r_qty
        else:  # NEGATIVE
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies "
                f"SET qty_negative = GREATEST(0, qty_negative - %s), updated_at = NOW() "
                f"WHERE id = %s",
                (r_qty, supply_id),
            )
            fulfilled["negative"] += r_qty
        cur.execute(
            f"UPDATE {SCHEMA}.warehouse_reserves SET status = 'FULFILLED', updated_at = NOW() WHERE id = %s",
            (rid,),
        )
    log(cur, "fulfill_order", order_id=order_id, payload=fulfilled)
    return fulfilled


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


# ── Авто-пересчёт этапа сборки и даты прихода железа ─────────────────────────
_WIP_SLOT_FIELDS = [
    ("cpu", "cpu_status"), ("motherboard", "motherboard_status"),
    ("ram", "ram_status"), ("gpu", "gpu_status"), ("storage", "storage_status"),
    ("psu", "psu_status"), ("case_name", "case_status"),
    ("cooling", "cooling_status"), ("extra", "extra_status"),
]

# Статусы, означающие что железка заказана и едет (не финал, но в работе)
_ORDERED_STATUSES = ("ordered_transit", "ordered_delay")


def recompute_wip_stage(cur, wip_id):
    """
    Авто-переход этапа сборки по статусам железок (только для заполненных слотов):
      • все ready/pending           → "Ожидание сборки" (всё приехало)
      • все ready/ordered/pending,
        но есть хотя бы один ordered → "Ожидание железа" (всё заказано, ждём)
    Переходы делаются только из рабочих этапов ("Заказ"/"Ожидание железа"/
    "Ожидание сборки"), чтобы не сбивать ручные поздние стадии.
    Также синхронизирует orders.status.
    Возвращает новый stage или None, если не менялся.
    """
    cols = ", ".join(name for name, _ in _WIP_SLOT_FIELDS)
    stats = ", ".join(st for _, st in _WIP_SLOT_FIELDS)
    cur.execute(
        f"SELECT {cols}, {stats}, stage, order_id "
        f"FROM {SCHEMA}.wip_builds WHERE id = %s",
        (wip_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    n = len(_WIP_SLOT_FIELDS)
    names = row[:n]
    statuses = row[n:2 * n]
    cur_stage = row[2 * n]
    order_id = row[2 * n + 1]

    if cur_stage not in ("Заказ", "Ожидание железа", "Ожидание сборки"):
        return None

    # Страховка: если сборка в рабочей стадии, но резервы заказа ещё не созданы
    # (ушла в работу в обход ручного «Заказ») — создаём их идемпотентно.
    ensure_order_reserves(cur, order_id)

    filled = [(nm, st) for nm, st in zip(names, statuses) if nm]
    if not filled:
        return None

    all_ready = all(st in ("ready", "pending") for _, st in filled)
    all_ordered_or_ready = all(
        st in ("ready", "pending") + _ORDERED_STATUSES for _, st in filled
    )
    has_ordered = any(st in _ORDERED_STATUSES for _, st in filled)

    new_stage = None
    if all_ready:
        new_stage = "Ожидание сборки"
    elif all_ordered_or_ready and has_ordered:
        new_stage = "Ожидание железа"

    if not new_stage or new_stage == cur_stage:
        return None

    cur.execute(
        f"UPDATE {SCHEMA}.wip_builds SET stage=%s, updated_at=NOW() WHERE id=%s",
        (new_stage, wip_id),
    )
    order_status = {"Ожидание железа": "ordering", "Ожидание сборки": "waiting_assembly"}.get(new_stage)
    if order_status and order_id:
        cur.execute(
            f"UPDATE {SCHEMA}.orders SET status=%s, updated_at=NOW() WHERE id=%s",
            (order_status, order_id),
        )
    return new_stage


def recompute_wip_received_at(cur, wip_id):
    """
    received_at сборки = самая поздняя ETA среди её железок (wip_component_eta).
    Дублируем дату в заказ не отдельным полем (у orders нет такого поля) —
    дата хранится в wip_builds.received_at и читается фронтом для заказа.
    Возвращает дату (str) или None.
    """
    cur.execute(
        f"SELECT MAX(eta_date) FROM {SCHEMA}.wip_component_eta "
        f"WHERE wip_id = %s AND eta_date IS NOT NULL",
        (wip_id,),
    )
    row = cur.fetchone()
    max_eta = row[0] if row else None
    cur.execute(
        f"UPDATE {SCHEMA}.wip_builds SET received_at=%s, updated_at=NOW() WHERE id=%s",
        (max_eta, wip_id),
    )
    return max_eta.isoformat() if max_eta else None


_SLOT_NAME_FIELD = {
    "cpu": "cpu", "motherboard": "motherboard", "ram": "ram", "gpu": "gpu",
    "storage": "storage", "psu": "psu", "case": "case_name",
    "cooling": "cooling", "extra": "extra", "fan": "extra",
}
_SLOT_RU = {
    "cpu": "Процессор", "motherboard": "Материнская плата", "ram": "Память",
    "gpu": "Видеокарта", "storage": "Накопитель", "psu": "Блок питания",
    "case": "Корпус", "cooling": "Охлаждение", "extra": "Доп.", "fan": "Доп.",
}


def mark_overdue_delays(cur):
    """
    Помечает железки как "ordered_delay" (Задержка), если их ETA прошла,
    а товар ещё не приехал (статус не ready). Вызывается при загрузке корзины.
    Обновляет wip_builds.{slot}_status по данным wip_component_eta.
    Возвращает СПИСОК позиций, ТОЛЬКО ЧТО перешедших в задержку (для уведомлений
    и дублирования в календарь). Повторный вызов их уже не вернёт — статус
    станет 'ordered_delay' и условие перехода не сработает.
    """
    cur.execute(
        f"SELECT wip_id, slot, eta_date FROM {SCHEMA}.wip_component_eta "
        f"WHERE eta_date IS NOT NULL AND eta_date < CURRENT_DATE"
    )
    rows = cur.fetchall()
    newly_delayed = []
    for wip_id, slot, eta_date in rows:
        field = "case_status" if slot == "case" else slot + "_status"
        if field not in (
            "cpu_status", "motherboard_status", "ram_status", "gpu_status",
            "storage_status", "psu_status", "case_status", "cooling_status", "extra_status",
        ):
            continue
        cur.execute(
            f"UPDATE {SCHEMA}.wip_builds SET {field}='ordered_delay', updated_at=NOW() "
            f"WHERE id=%s AND {field}='ordered_transit'",
            (wip_id,),
        )
        if cur.rowcount:
            name_field = _SLOT_NAME_FIELD.get(slot, "extra")
            # Тянем номер заказа из orders (display_number — надёжный «PC00001»),
            # компонент — из колонки слота wip_builds.
            cur.execute(
                f"SELECT wb.order_number, wb.order_id, wb.{name_field}, "
                f"       o.display_number, wb.build_id "
                f"FROM {SCHEMA}.wip_builds wb "
                f"LEFT JOIN {SCHEMA}.orders o ON o.id = wb.order_id "
                f"WHERE wb.id=%s",
                (wip_id,),
            )
            wr = cur.fetchone()
            display_number = wr[3] if wr else None
            order_number = wr[0] if wr else None
            component_name = (wr[2] if wr else None)
            build_id = wr[4] if wr else None
            # Если в колонке слота пусто — пробуем достать название из components сборки
            if (not component_name) and build_id:
                try:
                    cur.execute(
                        f"SELECT components FROM {SCHEMA}.pc_builds WHERE id=%s",
                        (build_id,),
                    )
                    pr = cur.fetchone()
                    comps = pr[0] if pr and pr[0] else []
                    if isinstance(comps, str):
                        import json as _json
                        comps = _json.loads(comps)
                    canon = "extra" if slot == "fan" else slot
                    for c in (comps or []):
                        cs = c.get("slot")
                        cs = "extra" if cs == "fan" else cs
                        if cs == canon and c.get("name"):
                            component_name = c["name"]
                            break
                except Exception as _ce:
                    print(f"DELAY comp lookup: {_ce}")
            newly_delayed.append({
                "wip_id": wip_id,
                "slot": slot,
                "slot_label": _SLOT_RU.get(slot, slot),
                "eta_date": eta_date.isoformat() if eta_date else None,
                # Приоритет: красивый display_number → order_number → id
                "order_number": display_number or order_number,
                "order_id": wr[1] if wr else None,
                "component_name": component_name or "—",
            })
    return newly_delayed