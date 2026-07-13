import json
import os
import psycopg2

import warehouse_core as core
# v8 - авто-этап + страховка резервов + предоплата/остаток (prepayment)

SCHEMA = "t_p72635010_quantum_fusion_resea"

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

STAGES = [
    "Согласование", "Заказ", "Ожидание железа", "Ожидание сборки",
    "Сборка", "Настройка", "Тесты", "Досборать",
    "Проверка перед выдачей", "Ожидание упаковки",
    "Готов, можно забрать", "Отнести в сдэк", "Забрали", "Отменён",
]

COMPONENT_STATUSES = ["pending", "ordered_delay", "ordered_transit", "ready", "need_order"]
# pending = не обработано
# need_order = надо заказать
# ordered_delay = заказано, проблемы со сроками
# ordered_transit = заказано, едет
# ready = в наличии / отложено

COMPONENT_FIELDS = ["cpu", "motherboard", "ram", "gpu", "storage", "psu", "case_name", "case", "cooling", "extra"]

_AUTO_STAGE_SLOTS = [
    ("cpu", "cpu_status"), ("motherboard", "motherboard_status"),
    ("ram", "ram_status"), ("gpu", "gpu_status"), ("storage", "storage_status"),
    ("psu", "psu_status"), ("case_name", "case_status"),
    ("cooling", "cooling_status"), ("extra", "extra_status"),
]
_ORDERED = ("ordered_transit", "ordered_delay")


def _auto_stage_wip(cur, wip_id):
    """
    Авто-переход этапа сборки по статусам заполненных железок:
      • все ready/pending                       → "Ожидание сборки" (всё приехало)
      • все ready/ordered/pending + есть ordered → "Ожидание железа" (всё заказано)
    Переходы только из рабочих этапов. Синхронизирует orders.status.
    """
    cols = ", ".join(n for n, _ in _AUTO_STAGE_SLOTS)
    stats = ", ".join(s for _, s in _AUTO_STAGE_SLOTS)
    cur.execute(
        f"SELECT {cols}, {stats}, stage, order_id FROM {SCHEMA}.wip_builds WHERE id = %s",
        (wip_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    n = len(_AUTO_STAGE_SLOTS)
    names, statuses, cur_stage, order_id = row[:n], row[n:2 * n], row[2 * n], row[2 * n + 1]
    if cur_stage not in ("Заказ", "Ожидание железа", "Ожидание сборки"):
        return None
    # Страховка: сборка в рабочей стадии, но резервы заказа ещё не созданы
    # (ушла в работу в обход ручного «Заказ») — создаём идемпотентно.
    core.ensure_order_reserves(cur, order_id)
    filled = [(nm, st) for nm, st in zip(names, statuses) if nm]
    if not filled:
        return None
    all_ready = all(st in ("ready", "pending") for _, st in filled)
    all_ordered_or_ready = all(st in ("ready", "pending") + _ORDERED for _, st in filled)
    has_ordered = any(st in _ORDERED for _, st in filled)
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
    ostatus = {"Ожидание железа": "ordering", "Ожидание сборки": "waiting_assembly"}.get(new_stage)
    if ostatus and order_id:
        cur.execute(
            f"UPDATE {SCHEMA}.orders SET status=%s, updated_at=NOW() WHERE id=%s",
            (ostatus, order_id),
        )
    return new_stage


def fmt_row(row):
    keys = [
        "id", "order_number", "stage", "contact", "delivery_type", "delivery_address",
        "received_at", "issued_at", "comment",
        "cpu", "motherboard", "ram", "gpu", "storage", "psu", "case_name", "cooling", "extra",
        "cpu_status", "motherboard_status", "ram_status", "gpu_status", "storage_status",
        "psu_status", "case_status", "cooling_status", "extra_status",
        "order_id", "created_at", "updated_at",
        "customer_name", "customer_phone", "total", "order_status",
        "client_token", "build_id", "build_components",
        "prepayment_percent", "prepayment_amount", "prepayment_confirmed",
        "assembled_by", "assembler_name", "for_sale",
        "source_id", "source_name",
    ]
    d = dict(zip(keys, row))
    for k in ["received_at", "issued_at"]:
        if d[k]:
            d[k] = d[k].isoformat()
    for k in ["created_at", "updated_at"]:
        if d[k]:
            d[k] = d[k].isoformat()
    if d.get("total") is not None:
        d["total"] = float(d["total"])
    # Предоплата: процент (дефолт 30) и сумма; остаток = итог − предоплата
    total = d.get("total") or 0
    pct = float(d["prepayment_percent"]) if d.get("prepayment_percent") is not None else 30.0
    if d.get("prepayment_amount") is not None:
        prepay = float(d["prepayment_amount"])
    else:
        prepay = round(total * pct / 100, 2)
    confirmed = bool(d.get("prepayment_confirmed"))
    d["prepayment_percent"] = pct
    d["prepayment_amount"] = prepay
    d["prepayment_confirmed"] = confirmed
    d["remaining_amount"] = round(total - prepay, 2)
    # Для клиента важна только подтверждённая предоплата
    d["prepayment_confirmed_amount"] = prepay if confirmed else 0
    return d


def attach_need_qty(cur, dicts):
    """Добавляет каждому WIP словарь need_by_slot: {slot: сколько_заказать}.
    Источник — активные NEGATIVE-резервы заказа (дефицит на складе).
    Слоты складываются как в WIP: 'case' → 'case', вентиляторы (fan) и прочие
    аксессуары агрегируются в 'extra' (столбец «Доп.»)."""
    if not dicts:
        return dicts
    order_ids = [d["order_id"] for d in dicts if d.get("order_id")]
    if not order_ids:
        for d in dicts:
            d["need_by_slot"] = {}
        return dicts
    ids_sql = ",".join(str(int(o)) for o in set(order_ids))
    cur.execute(
        f"SELECT r.order_id, r.slot, SUM(r.qty) "
        f"FROM {SCHEMA}.warehouse_reserves r "
        f"WHERE r.order_id IN ({ids_sql}) AND r.type = 'NEGATIVE' AND r.status = 'ACTIVE' "
        f"GROUP BY r.order_id, r.slot"
    )
    # Маппинг slot резерва → слот WIP (fan/аксессуары → extra)
    SLOT_TO_WIP = {"fan": "extra", "accessory": "extra"}
    need = {}  # order_id -> {wip_slot: qty}
    for oid, slot, qty in cur.fetchall():
        wip_slot = SLOT_TO_WIP.get(slot or "", slot or "extra")
        bucket = need.setdefault(oid, {})
        bucket[wip_slot] = bucket.get(wip_slot, 0) + int(qty or 0)
    for d in dicts:
        d["need_by_slot"] = need.get(d.get("order_id"), {})
    return dicts


def resp(status, data):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data, ensure_ascii=False, default=str)}

def handler(event: dict, context) -> dict:
    """Сборки в процессе (WIP): GET список/одна, POST создать, PUT обновить, PATCH статус/этап, DELETE удалить.
    
    TODO (реализовать позже):
    - При POST (создание новой сборки) → отправить уведомление в Telegram менеджеру
      (заглушка: notify_telegram(wip_id, order_number, contact))
    - При смене stage на финальный → синхронизировать статус в CRM по API
      (заглушка: sync_crm(wip_id, stage, contact))
    """
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}

    conn = get_conn()
    cur = conn.cursor()

    SELECT = """SELECT w.id, w.order_number, w.stage, w.contact, w.delivery_type, w.delivery_address,
                       w.received_at, w.issued_at, w.comment,
                       w.cpu, w.motherboard, w.ram, w.gpu, w.storage, w.psu, w.case_name, w.cooling, w.extra,
                       w.cpu_status, w.motherboard_status, w.ram_status, w.gpu_status, w.storage_status,
                       w.psu_status, w.case_status, w.cooling_status, w.extra_status,
                       w.order_id, w.created_at, w.updated_at,
                       o.customer_name, o.customer_phone, o.total, o.status as order_status,
                       w.client_token, w.build_id,
                       pb.components as build_components,
                       o.prepayment_percent, o.prepayment_amount, o.prepayment_confirmed,
                       w.assembled_by, emp.name as assembler_name, w.for_sale,
                       o.source_id, ms.name as source_name
                FROM wip_builds w
                LEFT JOIN orders o ON w.order_id = o.id
                LEFT JOIN pc_builds pb ON pb.id = w.build_id
                LEFT JOIN employees emp ON emp.id = w.assembled_by
                LEFT JOIN marketing_sources ms ON ms.id = o.source_id"""

    try:
        if method == "GET":
            wip_id = params.get("id")
            order_id = params.get("order_id")
            client_token = params.get("client_token")
            action = params.get("action")

            # Калькуляция маржи по компонентам сборки
            if action == "margin" and (wip_id or order_id):
                if wip_id:
                    cur.execute(
                        f"SELECT order_id, build_id, total FROM {SCHEMA}.wip_builds w "
                        f"LEFT JOIN orders o ON o.id = w.order_id WHERE w.id = %s", (wip_id,)
                    )
                else:
                    cur.execute(
                        f"SELECT w.order_id, w.build_id, o.total FROM {SCHEMA}.wip_builds w "
                        f"LEFT JOIN orders o ON o.id = w.order_id WHERE w.order_id = %s", (order_id,)
                    )
                wr = cur.fetchone()
                if not wr:
                    return resp(404, {"error": "Не найдено"})
                oid, bid, total = wr[0], wr[1], float(wr[2] or 0)

                # Себестоимость за 1 шт по товару (product_id) из резервов заказа.
                # Группируем по product_id, чтобы привязывать себестоимость к конкретной
                # позиции, а не к слоту (несколько одинаковых слотов раньше задваивались).
                unit_cost_by_pid = {}
                if oid:
                    cur.execute(
                        f"SELECT g.product_id, "
                        f"SUM(r.qty * COALESCE(r.cost_price_locked, sup.cost_price, 0)), SUM(r.qty) "
                        f"FROM {SCHEMA}.warehouse_reserves r "
                        f"JOIN {SCHEMA}.warehouse_groups g ON g.id = r.group_id "
                        f"LEFT JOIN {SCHEMA}.warehouse_supplies sup ON sup.id = r.supply_id "
                        f"WHERE r.order_id = %s AND r.type='POSITIVE' "
                        f"AND r.status IN ('FULFILLED','ACTIVE') GROUP BY g.product_id", (oid,)
                    )
                    for pid, total_cost, total_qty in cur.fetchall():
                        q = float(total_qty or 0)
                        unit_cost_by_pid[pid] = (float(total_cost or 0) / q) if q else 0.0

                # Цена ПРОДАЖИ (sale) — из orders.items (снимок, источник истины).
                # Себестоимость (cost) — из резервов по product_id * qty.
                # Если у заказа ещё старый формат items (нет product-строк со slot)
                # — фолбэк на расчёт из pc_builds.components.
                comps_out = []
                sum_sale = 0.0
                sum_cost = 0.0
                assembly_fee = 0.0

                order_items = []
                if oid:
                    cur.execute(f"SELECT items FROM {SCHEMA}.orders WHERE id = %s", (oid,))
                    oir = cur.fetchone()
                    if oir and oir[0]:
                        order_items = oir[0] if isinstance(oir[0], list) else json.loads(oir[0])
                # Новый формат: есть хотя бы одна product-строка со slot
                has_snapshot = any(
                    it.get("item_type") == "product" and it.get("slot")
                    for it in order_items
                )

                if has_snapshot:
                    for it in order_items:
                        itype = it.get("item_type")
                        if itype == "assembly":
                            assembly_fee = round(
                                float(it.get("final_price") if it.get("final_price") is not None
                                      else it.get("price", 0) or 0)
                                * int(it.get("quantity", 1) or 1), 2)
                            continue
                        if itype != "product":
                            continue
                        if it.get("item_status") == "returned":
                            continue
                        slot = it.get("slot")
                        qty = int(it.get("quantity", 1) or 1)
                        unit = float(it.get("final_price") if it.get("final_price") is not None
                                     else it.get("price", 0) or 0)
                        sale = unit * qty
                        pid = it.get("id")
                        cost = unit_cost_by_pid.get(pid, 0.0) * qty if pid else 0.0
                        comps_out.append({
                            "slot": slot, "name": it.get("name", ""), "qty": qty,
                            "sale": round(sale, 2), "cost": round(cost, 2),
                            "margin": round(sale - cost, 2),
                        })
                        sum_sale += sale
                        sum_cost += cost
                    # Фолбэк fee, если строки assembly нет, но в total осталась разница
                    if not assembly_fee and total > sum_sale:
                        assembly_fee = round(total - sum_sale, 2)
                elif bid:
                    # Старый формат: считаем из pc_builds.components (фолбэк)
                    cur.execute(f"SELECT components FROM {SCHEMA}.pc_builds WHERE id = %s", (bid,))
                    pbr = cur.fetchone()
                    comps = []
                    if pbr and pbr[0]:
                        comps = pbr[0] if isinstance(pbr[0], list) else json.loads(pbr[0])
                    for c in comps:
                        slot = c.get("slot")
                        qty = int(c.get("qty", 1) or 1)
                        sale = float(c.get("price", 0) or 0) * qty
                        pid = c.get("source_id")
                        cost = unit_cost_by_pid.get(pid, 0.0) * qty if pid else 0.0
                        comps_out.append({
                            "slot": slot, "name": c.get("name", ""), "qty": qty,
                            "sale": round(sale, 2), "cost": round(cost, 2),
                            "margin": round(sale - cost, 2),
                        })
                        sum_sale += sale
                        sum_cost += cost
                    # Если итог заказа больше суммы компонентов — разница это работа/сборка
                    assembly_fee = round(total - sum_sale, 2) if total > sum_sale else 0.0

                # Оплата сборщику: процент сотрудника × сумма заказа. Это затраты,
                # вычитаются из общей маржи.
                assembler_cost = 0.0
                asm_pct = 0.0
                if oid:
                    cur.execute(
                        f"SELECT e.assembler_percent FROM {SCHEMA}.wip_builds wb "
                        f"LEFT JOIN {SCHEMA}.employees e ON e.id = wb.assembled_by "
                        f"WHERE wb.order_id = %s LIMIT 1", (oid,)
                    )
                    ar = cur.fetchone()
                    asm_pct = float(ar[0] or 0) if ar else 0.0
                    if asm_pct > 0 and total > 0:
                        assembler_cost = round(total * asm_pct / 100, 2)

                return resp(200, {
                    "components": comps_out,
                    "total": round(total, 2),
                    "sum_sale": round(sum_sale, 2),
                    "sum_cost": round(sum_cost, 2),
                    "assembly_fee": assembly_fee,
                    "assembler_percent": asm_pct,
                    "assembler_cost": assembler_cost,
                    "total_margin": round(total - sum_cost - assembler_cost, 2),
                })

            if wip_id:
                cur.execute(SELECT + " WHERE w.id = %s", (wip_id,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                return resp(200, attach_need_qty(cur, [fmt_row(row)])[0])
            if order_id:
                cur.execute(SELECT + " WHERE w.order_id = %s", (order_id,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                return resp(200, attach_need_qty(cur, [fmt_row(row)])[0])
            if client_token:
                cur.execute(SELECT + " WHERE w.client_token = %s", (client_token,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                return resp(200, attach_need_qty(cur, [fmt_row(row)])[0])
            cur.execute(SELECT + " ORDER BY w.id DESC")
            rows = attach_need_qty(cur, [fmt_row(r) for r in cur.fetchall()])
            return resp(200, {"wip_builds": rows, "stages": STAGES})

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")

            if body.get("action") == "ensure_order":
                # Гарантировать наличие заказа (orders) у вручную созданной WIP-сборки,
                # чтобы работали предоплата/остаток/сумма. Если order_id уже есть — вернуть его.
                wip_id = body.get("wip_id")
                if not wip_id:
                    return resp(400, {"error": "Нет wip_id"})
                cur.execute(
                    f"SELECT order_id, build_id, contact, order_number, stage FROM {SCHEMA}.wip_builds WHERE id = %s",
                    (wip_id,)
                )
                w = cur.fetchone()
                if not w:
                    return resp(404, {"error": "Сборка не найдена"})
                order_id, build_id, contact, order_number, wip_stage = w
                if order_id:
                    return resp(200, {"order_id": order_id, "ok": True, "existed": True})
                if not build_id:
                    return resp(400, {"error": "У сборки нет карточки в каталоге. Сначала нажмите «Создать сборку в каталоге»."})

                cur.execute(
                    f"SELECT name, total_price, assembly_type, assembly_fee, components "
                    f"FROM {SCHEMA}.pc_builds WHERE id = %s",
                    (build_id,)
                )
                pb = cur.fetchone()
                if not pb:
                    return resp(404, {"error": "Карточка сборки не найдена"})
                build_name, total_price, asm_type, asm_fee, components = pb
                total_price = float(total_price or 0)
                asm_fee = float(asm_fee or 0)

                # контакты из строки contact: "Имя, +7..." → имя/телефон
                contact = (contact or "").strip()
                cust_name = contact or f"Сборка {order_number or ''}".strip() or "Клиент"
                cust_phone = ""
                if contact and "," in contact:
                    parts = [p.strip() for p in contact.split(",")]
                    cust_name = parts[0] or cust_name
                    cust_phone = parts[1] if len(parts) > 1 else ""
                if not cust_phone:
                    cust_phone = "-"

                # Снимок позиций (источник истины) из pc_builds.components:
                # по каждому компоненту — строка product, плюс строка услуги сборки.
                _slot_labels = {
                    "cpu": "Процессор", "motherboard": "Материнская плата", "ram": "ОЗУ",
                    "gpu": "Видеокарта", "storage": "Накопитель", "psu": "Блок питания",
                    "case": "Корпус", "case_name": "Корпус", "cooling": "Охлаждение",
                    "fan": "Вентилятор", "extra": "Доп.", "other": "Прочее",
                }
                comps = []
                if components:
                    comps = components if isinstance(components, list) else json.loads(components)
                items = []
                for comp in comps:
                    name = comp.get("name")
                    if not name or not str(name).strip():
                        continue
                    slot = comp.get("slot")
                    src_id = None
                    if comp.get("source") == "catalog" and comp.get("source_id"):
                        src_id = int(comp["source_id"])
                    # build_qty = 1 для ensure_order по умолчанию → qty компонента как есть
                    items.append({
                        "id": src_id,
                        "name": name,
                        "slot": slot,
                        "slot_label": _slot_labels.get(slot, slot),
                        "price": float(comp.get("price", 0) or 0),
                        "final_price": None,
                        "quantity": int(comp.get("qty", 1) or 1),
                        "item_type": "product",
                        "warranty_months": None,
                        "serial_numbers": [],
                        "item_status": None,
                    })
                # Строка услуги сборки
                items.append({
                    "id": None,
                    "name": "Работа по сборке и настройке ПК",
                    "slot": "assembly",
                    "price": asm_fee,
                    "final_price": None,
                    "quantity": 1,
                    "item_type": "assembly",
                    "warranty_months": 12,
                    "serial_numbers": [],
                })
                # total = сумма (final_price or price)*quantity по всем строкам снимка
                total_snapshot = sum(
                    (it.get("final_price") if it.get("final_price") is not None else it.get("price", 0))
                    * it.get("quantity", 1)
                    for it in items
                )
                cur.execute(
                    f"""INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, order_type,
                        items, total, status, created_at, updated_at)
                        VALUES (%s, %s, 'pc_build', %s, %s, 'new', NOW(), NOW()) RETURNING id""",
                    (cust_name[:255], cust_phone[:50], json.dumps(items), total_snapshot)
                )
                new_order_id = cur.fetchone()[0]
                # Сквозная нумерация: номер заказа-сборки = PC + внутренний id
                _display_number = "PC" + str(new_order_id).zfill(5)
                cur.execute(
                    f"UPDATE {SCHEMA}.orders SET display_number = %s WHERE id = %s",
                    (_display_number, new_order_id)
                )
                cur.execute(
                    f"UPDATE {SCHEMA}.wip_builds SET order_id = %s, updated_at = NOW() WHERE id = %s",
                    (new_order_id, wip_id)
                )
                # Резервы на этапе «Согласование» НЕ накладываем — заказ создаётся
                # без резервов (нужно для договора/согласования без блокировки склада).
                # Резервы наложатся позже, при переходе сборки на этап «Заказ»
                # (там вызывается recalc_order_reserves). Явный флаг skip_reserves
                # тоже уважаем.
                skip_reserves = bool(body.get("skip_reserves")) or (wip_stage == "Согласование")
                if not skip_reserves:
                    try:
                        core.ensure_order_reserves(cur, new_order_id, build_id)
                    except Exception:
                        pass
                conn.commit()

                try:
                    from tg_notify import notify_managers
                    _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
                    _link_line = f"\n🔗 <a href=\"{_base}/admin/wip_builds\">Открыть в сборках</a>" if _base else ""
                    _sum_str = f"{float(total_snapshot):,.0f}".replace(",", " ")
                    notify_managers(
                        f"🖥 <b>Новый заказ-сборка {_display_number}</b>\n"
                        f"Сборка: {build_name or 'Сборка ПК'}\n"
                        f"Клиент: {cust_name}\n"
                        f"Телефон: {cust_phone}\n"
                        f"Сумма: {_sum_str} ₽"
                        f"{_link_line}"
                    )
                except Exception as _e:
                    print(f"TG_NOTIFY wip ensure_order: {_e}")

                return resp(201, {"order_id": new_order_id, "total": total_snapshot, "ok": True})

            # Автогенерация номера заказа сборки, если не задан вручную:
            # отдельная нумерация PC: берём MAX среди PC-номеров и +1, формат PC00001
            order_number = (body.get("order_number") or "").strip()
            if not order_number:
                cur.execute(
                    "SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(order_number, '\\D', '', 'g'), '') AS INTEGER)), 0) "
                    "FROM wip_builds WHERE order_number LIKE 'PC%'"
                )
                next_num = (cur.fetchone()[0] or 0) + 1
                order_number = "PC" + str(next_num).zfill(5)

            cur.execute(
                """INSERT INTO wip_builds (order_number, stage, contact, delivery_type, delivery_address,
                   received_at, issued_at, comment,
                   cpu, motherboard, ram, gpu, storage, psu, case_name, cooling, extra,
                   order_id, updated_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
                   RETURNING id""",
                (
                    order_number,
                    body.get("stage", "Согласование"),
                    body.get("contact"), body.get("delivery_type"), body.get("delivery_address"),
                    body.get("received_at") or None, body.get("issued_at") or None,
                    body.get("comment"),
                    body.get("cpu"), body.get("motherboard"), body.get("ram"), body.get("gpu"),
                    body.get("storage"), body.get("psu"), body.get("case_name"),
                    body.get("cooling"), body.get("extra"),
                    body.get("order_id"),
                )
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return resp(201, {"id": new_id, "order_number": order_number, "ok": True})

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            for_sale = bool(body.get("for_sale"))
            stage = body.get("stage")
            cur.execute(
                """UPDATE wip_builds SET order_number=%s, stage=%s, contact=%s,
                   delivery_type=%s, delivery_address=%s,
                   received_at=%s, issued_at=%s, comment=%s,
                   cpu=%s, motherboard=%s, ram=%s, gpu=%s, storage=%s,
                   psu=%s, case_name=%s, cooling=%s, extra=%s,
                   order_id=%s, assembled_by=%s, for_sale=%s,
                   build_id=COALESCE(%s, build_id), updated_at=NOW()
                   WHERE id=%s""",
                (
                    body.get("order_number"), stage, body.get("contact"),
                    body.get("delivery_type"), body.get("delivery_address"),
                    body.get("received_at") or None, body.get("issued_at") or None,
                    body.get("comment"),
                    body.get("cpu"), body.get("motherboard"), body.get("ram"), body.get("gpu"),
                    body.get("storage"), body.get("psu"), body.get("case_name"),
                    body.get("cooling"), body.get("extra"),
                    body.get("order_id"), body.get("assembled_by") or None, for_sale,
                    body.get("build_id"), body["id"],
                )
            )

            # Синхронизация «свободной продажи» со сборкой в каталоге «Наши ПК»
            cur.execute(
                f"SELECT build_id, for_sale, stage FROM {SCHEMA}.wip_builds WHERE id=%s",
                (body["id"],)
            )
            row = cur.fetchone()
            if row and row[0]:
                bid, fs, st = row
                if st == "Забрали":
                    # Комп выдан → снимаем с продажи и архивируем карточку
                    cur.execute(
                        f"UPDATE {SCHEMA}.pc_builds SET status='archive', in_stock=FALSE WHERE id=%s",
                        (bid,)
                    )
                    cur.execute(f"UPDATE {SCHEMA}.wip_builds SET for_sale=FALSE WHERE id=%s", (body["id"],))
                elif fs:
                    # «В свободную продажу» отмечена → сразу публикуем на сайте с
                    # грифом «в наличии», НЕ дожидаясь этапа «Готов, можно забрать».
                    cur.execute(
                        f"UPDATE {SCHEMA}.pc_builds SET status='catalog', in_stock=TRUE WHERE id=%s",
                        (bid,)
                    )
                else:
                    # Галочка «в свободную продажу» не стоит → снимаем гриф «в наличии»
                    cur.execute(
                        f"UPDATE {SCHEMA}.pc_builds SET in_stock=FALSE WHERE id=%s AND status='catalog'",
                        (bid,)
                    )
            conn.commit()
            return resp(200, {"ok": True})

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            wip_id = body.get("id")

            # Обновить статус одного компонента
            if "component" in body and "status" in body:
                field = body["component"] + "_status"
                component = field.replace("_status", "")
                if component not in COMPONENT_FIELDS:
                    return resp(400, {"error": "Неизвестный компонент"})

                # Получаем старый статус и product_id компонента перед обновлением
                name_field = "case_name" if component == "case" else component
                cur.execute(
                    f"SELECT wb.{field}, wb.{name_field}, wb.build_id "
                    f"FROM {SCHEMA}.wip_builds wb WHERE wb.id = %s", (wip_id,)
                )
                old_row = cur.fetchone()
                old_status = old_row[0] if old_row else None
                comp_name = old_row[1] if old_row else None
                build_id = old_row[2] if old_row else None
                new_status = body["status"]

                cur.execute(f"UPDATE wip_builds SET {field}=%s, updated_at=NOW() WHERE id=%s", (new_status, wip_id))

                # Пересчитываем qty_negative в supplies:
                # need_order → другой: qty_negative -= qty компонента
                # другой → need_order: qty_negative += qty компонента
                if old_status != new_status and comp_name and build_id:
                    # Узнаём qty из pc_builds.components по названию
                    cur.execute(
                        f"SELECT components FROM {SCHEMA}.pc_builds WHERE id = %s LIMIT 1", (build_id,)
                    )
                    pb = cur.fetchone()
                    comp_qty = 1
                    if pb and pb[0]:
                        comps = pb[0] if isinstance(pb[0], list) else json.loads(pb[0])
                        slot_key = "case" if component == "case" else component
                        # Допы (extra) в составе сборки хранятся со слотом 'fan'.
                        slot_aliases = {"extra", "fan"} if slot_key == "extra" else {slot_key}
                        for c in comps:
                            if c.get("slot") in slot_aliases:
                                comp_qty = int(c.get("qty", 1))
                                break
                        # Находим supply по product_id компонента
                        product_id = None
                        for c in comps:
                            if c.get("slot") in slot_aliases and c.get("source_id"):
                                product_id = int(c["source_id"])
                                break
                        if product_id:
                            cur.execute(
                                f"SELECT s.id FROM {SCHEMA}.warehouse_supplies s "
                                f"JOIN {SCHEMA}.warehouse_groups g ON g.id = s.group_id "
                                f"WHERE g.product_id = %s ORDER BY s.id DESC LIMIT 1",
                                (product_id,)
                            )
                            sup = cur.fetchone()
                            if sup:
                                if old_status == "need_order" and new_status != "need_order":
                                    # Убираем нехватку
                                    cur.execute(
                                        f"UPDATE {SCHEMA}.warehouse_supplies "
                                        f"SET qty_negative = GREATEST(0, qty_negative - %s) WHERE id = %s",
                                        (comp_qty, sup[0])
                                    )
                                elif old_status != "need_order" and new_status == "need_order":
                                    # Добавляем нехватку
                                    cur.execute(
                                        f"UPDATE {SCHEMA}.warehouse_supplies "
                                        f"SET qty_negative = qty_negative + %s WHERE id = %s",
                                        (comp_qty, sup[0])
                                    )

                # ── Авто-переход этапа сборки по статусам железок ──
                # всё ready/pending → «Ожидание сборки»; всё заказано (есть
                # ordered_*) → «Ожидание железа». Только из рабочих этапов.
                _auto_stage_wip(cur, wip_id)

                conn.commit()
                return resp(200, {"ok": True})

            # Установить предоплату: по проценту или по сумме (пересчёт второго поля)
            if "prepayment_percent" in body or "prepayment_amount" in body:
                cur.execute(
                    f"SELECT order_id FROM {SCHEMA}.wip_builds WHERE id=%s", (wip_id,)
                )
                orow = cur.fetchone()
                order_id = orow[0] if orow else None
                if not order_id:
                    return resp(404, {"error": "Заказ не найден"})
                cur.execute(f"SELECT total FROM {SCHEMA}.orders WHERE id=%s", (order_id,))
                trow = cur.fetchone()
                total = float(trow[0]) if trow and trow[0] else 0
                if "prepayment_amount" in body and body.get("prepayment_amount") is not None:
                    amount = max(0, min(total, float(body.get("prepayment_amount") or 0)))
                    pct = round(amount / total * 100, 2) if total else 0
                else:
                    pct = max(0, min(100, float(body.get("prepayment_percent") or 0)))
                    amount = round(total * pct / 100, 2)
                cur.execute(
                    f"UPDATE {SCHEMA}.orders SET prepayment_percent=%s, "
                    f"prepayment_amount=%s, updated_at=NOW() WHERE id=%s",
                    (pct, amount, order_id),
                )
                conn.commit()
                return resp(200, {"ok": True, "prepayment_percent": pct,
                                  "prepayment_amount": amount,
                                  "remaining_amount": round(total - amount, 2)})

            # Обновить этап
            if "stage" in body:
                new_stage = body["stage"]
                # Получаем текущий этап и связанные данные
                cur.execute(
                    f"SELECT wb.stage, wb.order_id, wb.build_id "
                    f"FROM {SCHEMA}.wip_builds wb WHERE wb.id = %s",
                    (wip_id,),
                )
                wip_row = cur.fetchone()
                old_stage = wip_row[0] if wip_row else None
                wip_order_id = wip_row[1] if wip_row else None
                wip_build_id = wip_row[2] if wip_row else None

                cur.execute("UPDATE wip_builds SET stage=%s, updated_at=NOW() WHERE id=%s", (new_stage, wip_id))

                # ── Резервирование при переходе на «Заказ» ──
                if new_stage == "Заказ" and old_stage != "Заказ" and wip_order_id and wip_build_id:
                    import warehouse_core as wc
                    cur.execute(
                        f"SELECT components FROM {SCHEMA}.pc_builds WHERE id = %s", (wip_build_id,)
                    )
                    pb = cur.fetchone()
                    reserve_lines = []
                    if pb and pb[0]:
                        comps = pb[0] if isinstance(pb[0], list) else json.loads(pb[0] or "[]")
                        for c in comps:
                            reserve_lines.append({
                                "product_id": int(c["source_id"]) if c.get("source_id") else None,
                                "qty": int(c.get("qty", 1)),
                                "slot": c.get("slot", ""),
                            })
                    if reserve_lines:
                        # ИДЕМПОТЕНТНО: сначала снимаем возможные старые резервы
                        # заказа, потом накладываем заново. Раньше здесь был прямой
                        # handle_reserve_and_purchase БЕЗ снятия — при повторном
                        # заходе на «Заказ» резервы задваивались и уходили в минус.
                        wc.recalc_order_reserves(cur, wip_order_id, reserve_lines)
                        print(f"WIP {wip_id}: резерв 'Заказ' (recalc), order={wip_order_id}, lines={len(reserve_lines)}")

                # ── Снятие резервов при отмене ──
                if new_stage == "Отменён" and old_stage != "Отменён" and wip_order_id:
                    import warehouse_core as wc
                    released = wc.release_order_reserves(cur, wip_order_id)
                    print(f"WIP {wip_id}: резервы сняты, order={wip_order_id}: {released}")

                # ── Перед выдачей («Забрали») остаток должен быть оплачен ──
                if new_stage == "Забрали" and old_stage != "Забрали" and wip_order_id:
                    cur.execute(
                        f"SELECT remaining_paid, status FROM {SCHEMA}.orders WHERE id=%s",
                        (wip_order_id,)
                    )
                    rp = cur.fetchone()
                    if rp and rp[1] != "done" and not bool(rp[0]):
                        conn.rollback()
                        return resp(400, {"error": "remaining_unpaid",
                                          "message": "Перед выдачей нужно принять оплату остатка по заказу."})

                # ── Списание резервов при выдаче клиенту («Забрали»/«Архив») ──
                # Товар физически уходит клиенту: qty_reserved уменьшается,
                # резерв → FULFILLED, в наличие НЕ возвращается.
                # «Архив» = заказ выдан и убран из активной работы (выдача через WIP),
                # поэтому обрабатывается так же, как «Забрали»: иначе выданный заказ
                # продолжал бы держать активный резерв.
                if new_stage in ("Забрали", "Архив") and old_stage not in ("Забрали", "Архив") and wip_order_id:
                    import warehouse_core as wc
                    fulfilled = wc.fulfill_order_reserves(cur, wip_order_id)
                    print(f"WIP {wip_id}: выдача ({new_stage}), резервы списаны order={wip_order_id}: {fulfilled}")

                # При "Забрали", "Архив" или "Отменён" — переносим pc_build в архив
                if new_stage in ("Забрали", "Архив", "Отменён"):
                    cur.execute(
                        "UPDATE pc_builds SET status='archive' WHERE id=(SELECT build_id FROM wip_builds WHERE id=%s)",
                        (wip_id,)
                    )
                # Синхронизируем статус заказа ПК со стадией сборки
                STAGE_TO_ORDER_STATUS = {
                    "Согласование":           "new",
                    "Заказ":                  "ordering",
                    "Ожидание железа":        "ordering",
                    "Ожидание сборки":        "waiting_assembly",
                    "Сборка":                 "assembly",
                    "Настройка":              "assembly",
                    "Тесты":                  "assembly",
                    "Досборать":              "assembly",
                    "Проверка перед выдачей": "assembly",
                    "Ожидание упаковки":      "assembly",
                    "Готов, можно забрать":   "assembly",
                    "Отнести в сдэк":         "assembly",
                    "Забрали":                "done",
                    "Архив":                  "done",
                    "Отменён":                "cancelled",
                }
                order_status = STAGE_TO_ORDER_STATUS.get(new_stage)
                if order_status:
                    cur.execute(
                        "UPDATE orders SET status=%s, updated_at=NOW() WHERE id=(SELECT order_id FROM wip_builds WHERE id=%s)",
                        (order_status, wip_id)
                    )
                conn.commit()
                return resp(200, {"ok": True})

            # Обновить любые поля
            allowed = ["contact", "delivery_type", "delivery_address", "received_at", "issued_at", "comment"]
            updates = {k: body[k] for k in allowed if k in body}
            if updates:
                parts = [f"{k}=%s" for k in updates]
                cur.execute(f"UPDATE wip_builds SET {', '.join(parts)}, updated_at=NOW() WHERE id=%s",
                            list(updates.values()) + [wip_id])
                conn.commit()
            return resp(200, {"ok": True})

        elif method == "DELETE":
            wip_id = params.get("id")
            if not wip_id:
                return resp(400, {"error": "Нет id"})
            # Получаем order_id и build_id
            cur.execute(f"SELECT order_id, build_id FROM {SCHEMA}.wip_builds WHERE id = %s", (wip_id,))
            row = cur.fetchone()
            order_id = row[0] if row else None
            build_id = row[1] if row else None
            # Снимаем резервы: NEGATIVE только NEW (заказанное у поставщика остаётся в закупке)
            if order_id:
                core.release_order_reserves(cur, order_id, only_new_negative=True)
                # ВАЖНО: архивируем заказ, иначе он осиротеет (висит в заказах без WIP)
                cur.execute(f"UPDATE {SCHEMA}.orders SET status='archived', updated_at=NOW() WHERE id=%s", (order_id,))
            if build_id:
                cur.execute(f"UPDATE {SCHEMA}.pc_builds SET status='archive' WHERE id=%s", (build_id,))
            # Удаляем запись сборки
            cur.execute(f"DELETE FROM {SCHEMA}.wip_builds WHERE id = %s", (wip_id,))
            conn.commit()
            return resp(200, {"ok": True, "order_id": order_id})

        # ── Отмена заказа с проверкой пароля ────────────────────────────────
        elif method == "POST":
            body = json.loads(event.get("body") or "{}")
            action_post = body.get("action")

            if action_post == "cancel_order":
                wip_id = body.get("wip_id")
                if not wip_id:
                    return resp(400, {"error": "Нет wip_id"})

                # Получаем order_id и build_id
                cur.execute(
                    f"SELECT order_id, build_id FROM {SCHEMA}.wip_builds WHERE id = %s",
                    (wip_id,)
                )
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Сборка не найдена"})
                order_id, build_id = row

                # POSITIVE резервы → возвращаем в наличие
                # NEGATIVE резервы → снимаем только NEW; заказанное (ORDERED) остаётся в закупке
                if order_id:
                    core.release_order_reserves(cur, order_id, only_new_negative=True)

                # Заказ → архив
                if order_id:
                    cur.execute(
                        f"UPDATE {SCHEMA}.orders SET status='archived', updated_at=NOW() WHERE id=%s",
                        (order_id,)
                    )

                # pc_build → архив
                if build_id:
                    cur.execute(
                        f"UPDATE {SCHEMA}.pc_builds SET status='archive' WHERE id=%s",
                        (build_id,)
                    )

                # Сборка → удаляем
                cur.execute(f"DELETE FROM {SCHEMA}.wip_builds WHERE id=%s", (wip_id,))
                conn.commit()
                return resp(200, {"ok": True, "order_id": order_id})

    finally:
        cur.close()
        conn.close()

    return resp(405, {"error": "Method not allowed"})