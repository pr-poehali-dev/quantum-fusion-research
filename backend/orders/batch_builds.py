"""
Массовая сборка ПК (партия): один заказ = набор групп-вариантов.

Каждая группа (order_build_groups) = своя конфигурация (components) + кол-во ПК
(qty) + свой статус сборки (wip_builds). Отдельные ПК (order_build_units) внутри
группы нужны для серийников и поэтапной выдачи.

Одиночные заказы (order_type='pc_build') сюда НЕ попадают — у них своя логика в
index.py. Массовые заказы имеют order_type='pc_batch'.

Резервы партии привязаны к order_id (как обычно), а слот кодируется как
"g{group_id}:{slot}", чтобы различать одинаковые слоты в разных группах.
"""

import json

SCHEMA = "t_p72635010_quantum_fusion_resea"

# Слоты и человекочитаемые ярлыки (совпадают с одиночной сборкой)
SLOT_LABELS = {
    "cpu": "Процессор", "motherboard": "Материнская плата", "ram": "ОЗУ",
    "gpu": "Видеокарта", "storage": "Накопитель", "psu": "Блок питания",
    "case": "Корпус", "cooling": "Охлаждение", "extra": "Доп.",
}

# Маппинг слота конфигуратора → колонка/статус wip_builds
PC_TO_WIP_SLOT = {
    "cpu": "cpu", "motherboard": "motherboard", "ram": "ram", "gpu": "gpu",
    "storage": "storage", "psu": "psu", "case": "case", "cooling": "cooling",
    "extra": "extra", "fan": "extra", "accessory": "extra",
}
WIP_SLOT_COL = {  # wip-слот → имя колонки-названия в wip_builds
    "cpu": "cpu", "motherboard": "motherboard", "ram": "ram", "gpu": "gpu",
    "storage": "storage", "psu": "psu", "case": "case_name", "cooling": "cooling",
    "extra": "extra",
}


def _components_of(group_row_components):
    c = group_row_components
    if isinstance(c, str):
        try:
            c = json.loads(c)
        except Exception:
            c = []
    return c or []


def _calc_group_totals(components):
    """parts_total и total_price за 1 ПК группы (цена компонентов × qty каждого)."""
    parts = 0.0
    for comp in components:
        price = float(comp.get("price", 0) or 0)
        q = int(comp.get("qty", 1) or 1)
        parts += price * q
    return round(parts, 2)


def _ensure_wip_for_group(cur, order_id, group_id, label, order_number, components):
    """Создаёт (или обновляет) wip_builds для группы: один статус сборки на всю
    строку-вариант. Заполняет названия слотов из состава группы."""
    # Названия слотов из состава (склеиваем повторяющиеся)
    slot_names = {}
    for comp in components:
        wip_slot = PC_TO_WIP_SLOT.get(comp.get("slot") or "", "extra")
        col = WIP_SLOT_COL.get(wip_slot)
        if not col:
            continue
        nm = (comp.get("name") or "").strip()
        if not nm:
            continue
        slot_names.setdefault(col, [])
        slot_names[col].append(nm)
    cols_val = {c: " + ".join(v)[:250] for c, v in slot_names.items()}

    cur.execute(
        f"SELECT wip_id FROM {SCHEMA}.order_build_groups WHERE id=%s", (group_id,))
    row = cur.fetchone()
    wip_id = row[0] if row and row[0] else None

    set_cols = ", ".join(f"{c}=%s" for c in cols_val.keys())
    vals = list(cols_val.values())

    if wip_id:
        if set_cols:
            cur.execute(
                f"UPDATE {SCHEMA}.wip_builds SET {set_cols}, updated_at=NOW() WHERE id=%s",
                (*vals, wip_id))
        return wip_id

    # Создаём новый wip
    base_cols = ["order_number", "stage", "order_id"]
    base_vals = [f"{order_number}·{label}"[:32], "Ожидание железа", order_id]
    all_cols = base_cols + list(cols_val.keys())
    all_vals = base_vals + vals
    ph = ", ".join(["%s"] * len(all_vals))
    cur.execute(
        f"INSERT INTO {SCHEMA}.wip_builds ({', '.join(all_cols)}) VALUES ({ph}) RETURNING id",
        tuple(all_vals))
    wip_id = cur.fetchone()[0]
    cur.execute(
        f"UPDATE {SCHEMA}.order_build_groups SET wip_id=%s WHERE id=%s", (wip_id, group_id))
    return wip_id


def _sync_units(cur, order_id, group_id, qty):
    """Приводит число ПК-юнитов группы к qty. Добавляет недостающие, лишние
    (в статусе pending, без серийника) — удаляет."""
    cur.execute(
        f"SELECT id, unit_no, status, serial_number FROM {SCHEMA}.order_build_units "
        f"WHERE group_id=%s ORDER BY unit_no", (group_id,))
    units = cur.fetchall()
    cur_qty = len(units)
    if cur_qty < qty:
        for n in range(cur_qty + 1, qty + 1):
            cur.execute(
                f"INSERT INTO {SCHEMA}.order_build_units (group_id, order_id, unit_no, status) "
                f"VALUES (%s, %s, %s, 'pending')", (group_id, order_id, n))
    elif cur_qty > qty:
        # Удаляем лишние с конца, но только «пустые» (pending, без серийника/выдачи)
        removable = [u for u in units if u[2] == "pending" and not u[3]]
        removable.sort(key=lambda u: u[1], reverse=True)
        to_remove = cur_qty - qty
        for u in removable[:to_remove]:
            cur.execute(f"DELETE FROM {SCHEMA}.order_build_units WHERE id=%s", (u[0],))


def list_groups(cur, order_id):
    """Полный состав партии: группы + их units. Для админки."""
    cur.execute(
        f"SELECT id, label, qty, components, parts_total, total_price, wip_id, sort_order "
        f"FROM {SCHEMA}.order_build_groups WHERE order_id=%s ORDER BY sort_order, id",
        (order_id,))
    groups = []
    for r in cur.fetchall():
        gid = r[0]
        comps = _components_of(r[3])
        # wip-статусы слотов
        statuses = {}
        stage = None
        if r[6]:
            cur.execute(
                f"SELECT stage, cpu_status, motherboard_status, ram_status, gpu_status, "
                f"storage_status, psu_status, case_status, cooling_status, extra_status "
                f"FROM {SCHEMA}.wip_builds WHERE id=%s", (r[6],))
            w = cur.fetchone()
            if w:
                stage = w[0]
                statuses = {
                    "cpu": w[1], "motherboard": w[2], "ram": w[3], "gpu": w[4],
                    "storage": w[5], "psu": w[6], "case": w[7], "cooling": w[8],
                    "extra": w[9],
                }
        # units
        cur.execute(
            f"SELECT id, unit_no, serial_number, status, warranty_until, issued_at, comment, comp_serials "
            f"FROM {SCHEMA}.order_build_units WHERE group_id=%s ORDER BY unit_no", (gid,))
        units = []
        for u in cur.fetchall():
            cs = u[7]
            if isinstance(cs, str):
                try:
                    cs = json.loads(cs)
                except Exception:
                    cs = {}
            units.append({
                "id": u[0], "unit_no": u[1], "serial_number": u[2], "status": u[3],
                "warranty_until": u[4].isoformat() if u[4] else None,
                "issued_at": u[5].isoformat() if u[5] else None, "comment": u[6],
                "comp_serials": cs or {},
            })
        groups.append({
            "id": gid, "label": r[1], "qty": r[2], "components": comps,
            "parts_total": float(r[4]), "total_price": float(r[5]),
            "wip_id": r[6], "sort_order": r[7], "stage": stage,
            "slot_statuses": statuses, "units": units,
            "issued_count": sum(1 for u in units if u["status"] == "issued"),
            "assembled_count": sum(1 for u in units if u["status"] in ("assembled", "issued")),
        })
    return groups


def add_group(cur, order_id, order_number, label, qty, components):
    qty = max(1, int(qty or 1))
    comps = components or []
    parts = _calc_group_totals(comps)
    cur.execute(
        f"SELECT COALESCE(MAX(sort_order), 0) + 1 FROM {SCHEMA}.order_build_groups WHERE order_id=%s",
        (order_id,))
    sort_order = cur.fetchone()[0]
    cur.execute(
        f"INSERT INTO {SCHEMA}.order_build_groups "
        f"(order_id, label, qty, components, parts_total, total_price, sort_order) "
        f"VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (order_id, (label or "Вариант")[:128], qty, json.dumps(comps), parts, parts, sort_order))
    group_id = cur.fetchone()[0]
    _ensure_wip_for_group(cur, order_id, group_id, label or "Вариант", order_number, comps)
    _sync_units(cur, order_id, group_id, qty)
    _recalc_order_total(cur, order_id)
    return group_id


def update_group(cur, order_id, order_number, group_id, label=None, qty=None, components=None):
    cur.execute(
        f"SELECT label, qty, components FROM {SCHEMA}.order_build_groups WHERE id=%s AND order_id=%s",
        (group_id, order_id))
    row = cur.fetchone()
    if not row:
        return False
    new_label = label if label is not None else row[0]
    new_qty = max(1, int(qty)) if qty is not None else row[1]
    new_comps = components if components is not None else _components_of(row[2])
    parts = _calc_group_totals(new_comps)
    cur.execute(
        f"UPDATE {SCHEMA}.order_build_groups "
        f"SET label=%s, qty=%s, components=%s, parts_total=%s, total_price=%s, updated_at=NOW() "
        f"WHERE id=%s",
        (new_label[:128], new_qty, json.dumps(new_comps), parts, parts, group_id))
    _ensure_wip_for_group(cur, order_id, group_id, new_label, order_number, new_comps)
    _sync_units(cur, order_id, group_id, new_qty)
    _recalc_order_total(cur, order_id)
    return True


def remove_group(cur, order_id, group_id):
    cur.execute(
        f"SELECT wip_id FROM {SCHEMA}.order_build_groups WHERE id=%s AND order_id=%s",
        (group_id, order_id))
    row = cur.fetchone()
    if not row:
        return False
    wip_id = row[0]
    cur.execute(f"DELETE FROM {SCHEMA}.order_build_units WHERE group_id=%s", (group_id,))
    cur.execute(f"DELETE FROM {SCHEMA}.order_build_groups WHERE id=%s", (group_id,))
    if wip_id:
        cur.execute(f"DELETE FROM {SCHEMA}.wip_component_eta WHERE wip_id=%s", (wip_id,))
        cur.execute(f"DELETE FROM {SCHEMA}.wip_builds WHERE id=%s", (wip_id,))
    _recalc_order_total(cur, order_id)
    return True


def _recalc_order_total(cur, order_id):
    """Итог заказа-партии = Σ(total_price × qty) по всем группам."""
    cur.execute(
        f"SELECT COALESCE(SUM(total_price * qty), 0) FROM {SCHEMA}.order_build_groups WHERE order_id=%s",
        (order_id,))
    total = float(cur.fetchone()[0] or 0)
    cur.execute(
        f"UPDATE {SCHEMA}.orders SET total=%s, updated_at=NOW() WHERE id=%s", (total, order_id))
    return total


def update_unit(cur, order_id, unit_id, serial_number=None, status=None,
                warranty_until=None, issued_at=None, comment=None,
                comp_serials=None, comp_slot=None, comp_serial=None):
    """Серийник / статус / выдача отдельного ПК.

    comp_serials — полный map {slot: серийник} (перезаписывает).
    comp_slot + comp_serial — точечно один слот (не трогая остальные)."""
    cur.execute(
        f"SELECT id, comp_serials FROM {SCHEMA}.order_build_units WHERE id=%s AND order_id=%s",
        (unit_id, order_id))
    _row = cur.fetchone()
    if not _row:
        return False

    # Серийники комплектующих (map slot -> серийник)
    if comp_serials is not None or comp_slot is not None:
        cur_map = _row[1]
        if isinstance(cur_map, str):
            try:
                cur_map = json.loads(cur_map)
            except Exception:
                cur_map = {}
        cur_map = cur_map or {}
        if comp_serials is not None:
            cur_map = {str(k): (str(v).strip() or None) for k, v in dict(comp_serials).items() if str(v).strip()}
        if comp_slot is not None:
            sn = (comp_serial or "").strip()
            if sn:
                cur_map[str(comp_slot)] = sn
            else:
                cur_map.pop(str(comp_slot), None)
        cur.execute(
            f"UPDATE {SCHEMA}.order_build_units SET comp_serials=%s, updated_at=NOW() WHERE id=%s",
            (json.dumps(cur_map), unit_id))

    sets, vals = [], []
    if serial_number is not None:
        sets.append("serial_number=%s"); vals.append((serial_number or "").strip() or None)
    if status is not None:
        sets.append("status=%s"); vals.append(status)
        # Отметка выдачи ставит дату, снятие — очищает
        if status == "issued":
            sets.append("issued_at=COALESCE(issued_at, CURRENT_DATE)")
        elif status in ("pending", "assembled"):
            sets.append("issued_at=NULL")
    if warranty_until is not None:
        sets.append("warranty_until=%s"); vals.append(warranty_until or None)
    if issued_at is not None:
        sets.append("issued_at=%s"); vals.append(issued_at or None)
    if comment is not None:
        sets.append("comment=%s"); vals.append(comment)
    if not sets:
        return True
    sets.append("updated_at=NOW()")
    cur.execute(
        f"UPDATE {SCHEMA}.order_build_units SET {', '.join(sets)} WHERE id=%s",
        (*vals, unit_id))
    return True


def sync_batch(cur, wc, order_id):
    """Пересчёт резервов всей партии: по каждой группе резервируем
    component.qty × group.qty. Слот кодируем "g{gid}:{slot}" для различения групп.
    Возвращает сводку reserved/need_order."""
    wc.lock_order(cur, order_id)
    # Снимаем все прошлые резервы заказа-партии
    wc.release_order_reserves(cur, order_id, only_new_negative=False)

    cur.execute(
        f"SELECT id, qty, components, label FROM {SCHEMA}.order_build_groups "
        f"WHERE order_id=%s ORDER BY sort_order, id", (order_id,))
    groups = cur.fetchall()

    reserved, need_order = [], []
    for (gid, gqty, gcomps, glabel) in groups:
        comps = _components_of(gcomps)
        gqty = max(1, int(gqty or 1))
        for comp in comps:
            if comp.get("source") != "catalog" or not comp.get("source_id"):
                continue  # пользовательское железо — не резервируем
            slot = comp.get("slot") or "extra"
            comp_qty = int(comp.get("qty", 1) or 1) * gqty
            if comp_qty <= 0:
                continue
            product_id = int(comp["source_id"])
            res = wc.reserve_line(cur, order_id, product_id=product_id,
                                  qty=comp_qty, slot=f"g{gid}:{slot}")
            pos = int(res.get("positive", 0) or 0)
            neg = int(res.get("negative", 0) or 0)
            cname = comp.get("name") or ""
            if pos > 0:
                reserved.append({"group_id": gid, "label": glabel, "slot": slot,
                                 "name": cname, "reserved": pos})
            if neg > 0:
                need_order.append({"group_id": gid, "label": glabel, "slot": slot,
                                   "name": cname, "shortage": neg})
    return {"reserved": reserved, "need_order": need_order}


def writeoff_batch(cur, order_id):
    """Выдача всей партии целиком: списывает всё зарезервированное со склада
    (по ACTIVE POSITIVE-резервам заказа), закрывает резервы FULFILLED, все
    ПК-юниты → issued, все wip-группы → «Забрали», заказ → done.

    Списание идёт напрямую по warehouse_reserves (там уже есть supply_id/qty),
    в отличие от одиночного writeoff_order (по items).
    Возвращает {wrote_off: N, units: N}."""
    # Списываем зарезервированные партии по POSITIVE-резервам заказа
    cur.execute(
        f"SELECT r.id, r.supply_id, r.group_id, r.qty, s.cost_price "
        f"FROM {SCHEMA}.warehouse_reserves r "
        f"JOIN {SCHEMA}.warehouse_supplies s ON s.id = r.supply_id "
        f"WHERE r.order_id = %s AND r.type = 'POSITIVE' AND r.status = 'ACTIVE' "
        f"FOR UPDATE OF r", (order_id,))
    rows = cur.fetchall()
    wrote_off = 0
    touched_groups = set()
    for (rid, supply_id, group_id, qty, cost) in rows:
        if not supply_id or qty <= 0:
            continue
        cur.execute(
            f"UPDATE {SCHEMA}.warehouse_supplies "
            f"SET qty_reserved = GREATEST(0, qty_reserved - %s), updated_at = NOW() "
            f"WHERE id = %s", (qty, supply_id))
        cur.execute(
            f"INSERT INTO {SCHEMA}.warehouse_movements "
            f"(group_id, supply_id, order_id, type, qty_delta, cost_price, note, created_at) "
            f"VALUES (%s, %s, %s, 'sale', %s, %s, %s, NOW())",
            (group_id, supply_id, order_id, -qty, float(cost or 0),
             f"Выдача партии #{order_id}"))
        wrote_off += qty
        touched_groups.add(group_id)

    # Пересчёт stock_qty/in_stock по затронутым товарам
    for gid in touched_groups:
        cur.execute(
            f"UPDATE {SCHEMA}.products SET "
            f"stock_qty = (SELECT COALESCE(SUM(s2.qty),0) FROM {SCHEMA}.warehouse_supplies s2 "
            f"  JOIN {SCHEMA}.warehouse_groups g2 ON g2.id = s2.group_id WHERE g2.product_id = products.id), "
            f"in_stock = (SELECT COALESCE(SUM(s2.qty),0) > 0 FROM {SCHEMA}.warehouse_supplies s2 "
            f"  JOIN {SCHEMA}.warehouse_groups g2 ON g2.id = s2.group_id WHERE g2.product_id = products.id) "
            f"WHERE id = (SELECT product_id FROM {SCHEMA}.warehouse_groups WHERE id = %s)",
            (gid,))

    # Закрываем ACTIVE-резервы заказа → FULFILLED
    cur.execute(
        f"UPDATE {SCHEMA}.warehouse_reserves SET status='FULFILLED', updated_at=NOW() "
        f"WHERE order_id=%s AND status='ACTIVE'", (order_id,))

    # Все ПК-юниты партии → issued (с датой выдачи)
    cur.execute(
        f"UPDATE {SCHEMA}.order_build_units "
        f"SET status='issued', issued_at=COALESCE(issued_at, CURRENT_DATE), updated_at=NOW() "
        f"WHERE order_id=%s", (order_id,))
    cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.order_build_units WHERE order_id=%s", (order_id,))
    units_cnt = int(cur.fetchone()[0] or 0)

    # Все wip-сборки групп → «Забрали»
    cur.execute(
        f"UPDATE {SCHEMA}.wip_builds SET stage='Забрали', issued_at=CURRENT_DATE, updated_at=NOW() "
        f"WHERE order_id=%s", (order_id,))

    # Заказ → done
    cur.execute(f"UPDATE {SCHEMA}.orders SET status='done', updated_at=NOW() WHERE id=%s", (order_id,))
    return {"wrote_off": wrote_off, "units": units_cnt}


def warranty_data(cur, order_id):
    """Данные для единого гарантийного талона на всю партию: клиент + список ПК
    (по каждой группе × каждому юниту) с серийниками комплектующих."""
    cur.execute(
        f"SELECT customer_name, customer_phone, customer_email, display_number, created_at "
        f"FROM {SCHEMA}.orders WHERE id=%s", (order_id,))
    o = cur.fetchone()
    if not o:
        return None
    groups = list_groups(cur, order_id)
    pcs = []
    for g in groups:
        for u in g["units"]:
            comp_sn = u.get("comp_serials") or {}
            comps = []
            for c in g["components"]:
                if not c.get("name"):
                    continue
                comps.append({
                    "slot": c.get("slot"),
                    "slot_label": SLOT_LABELS.get(c.get("slot"), c.get("slot")),
                    "name": c.get("name"),
                    "serial": comp_sn.get(c.get("slot")) or "",
                })
            pcs.append({
                "group_label": g["label"],
                "unit_no": u["unit_no"],
                "pc_serial": u.get("serial_number") or "",
                "warranty_until": u.get("warranty_until"),
                "components": comps,
            })
    return {
        "customer_name": o[0], "customer_phone": o[1], "customer_email": o[2],
        "display_number": o[3] or f"PB{str(order_id).zfill(5)}",
        "created_at": o[4].isoformat() if o[4] else None,
        "pcs": pcs,
    }