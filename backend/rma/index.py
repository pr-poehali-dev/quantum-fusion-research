"""
RMA — гарантийные случаи (Этап 3, Вариант B).

Механика:
- Создание RMA: выбор заказа + конкретная железка → запись в warehouse_rma,
  бракованная единица уходит в карантинную партию (is_quarantine=true).
- Получение железок заказа: вернуть список компонентов из wip_builds + pc_builds
  для выбора в форме.
- Смена статуса: new → to_supplier → in_progress → resolved → closed.
- Замена пришла (resolve с replacement): новая партия поступает на склад,
  может гасить минус-резервы через warehouse_core.receive_stock.
- Возврат денег (resolve с refund): карантин просто закрывается.
"""

import json
import os
from datetime import date, datetime

import psycopg2

SCHEMA = "t_p72635010_quantum_fusion_resea"
cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token, X-Session-Id",
}

SLOT_LABELS = {
    "cpu": "Процессор", "gpu": "Видеокарта", "ram": "Оперативная память",
    "storage": "Накопитель", "psu": "Блок питания", "case": "Корпус",
    "case_name": "Корпус", "motherboard": "Материнская плата",
    "cooling": "Охлаждение", "extra": "Доп.",
}

STATUS_LABELS = {
    "new": "Новый",
    "to_supplier": "Отправлен поставщику",
    "in_progress": "В процессе",
    "resolved": "Решён",
    "closed": "Закрыт",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def serial(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def fmt_rma(row):
    return {
        "id": row[0],
        "order_id": row[1],
        "group_id": row[2],
        "product_id": row[3],
        "slot": row[4],
        "item_name": row[5],
        "qty": row[6],
        "reason": row[7],
        "source_type": row[8],
        "status": row[9],
        "status_label": STATUS_LABELS.get(row[9], row[9]),
        "supplier_note": row[10],
        "resolution": row[11],
        "detected_at": serial(row[12]),
        "resolved_at": serial(row[13]),
        "quarantine_qty": row[14],
        "replacement_supply_id": row[15],
        "created_at": serial(row[16]),
        "updated_at": serial(row[17]),
        # JOIN поля
        "customer_name": row[18] if len(row) > 18 else None,
        "customer_phone": row[19] if len(row) > 19 else None,
        "group_name": row[20] if len(row) > 20 else None,
        "group_sku": row[21] if len(row) > 21 else None,
        "warranty_until": serial(row[22]) if len(row) > 22 else None,
        "replacement_order_id": row[23] if len(row) > 23 else None,
        "replace_from_stock": row[24] if len(row) > 24 else False,
    }


def handler(event: dict, context) -> dict:
    """
    RMA: создание, список, обновление статуса, получение компонентов заказа,
    закрытие с заменой (товар на склад + гашение минус-резервов).
    """
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    body = json.loads(event["body"]) if event.get("body") else {}
    action = params.get("action") or body.get("action", "")

    conn = get_conn()
    cur = conn.cursor()

    try:
        # ── Список RMA-записей ───────────────────────────────────────────────
        if action == "list" and method == "GET":
            status_filter = params.get("status", "")
            where = f"WHERE r.status = '{status_filter}'" if status_filter else ""
            cur.execute(
                f"SELECT r.id, r.order_id, r.group_id, r.product_id, r.slot, r.item_name, "
                f"r.qty, r.reason, r.source_type, r.status, r.supplier_note, r.resolution, "
                f"r.detected_at, r.resolved_at, r.quarantine_qty, r.replacement_supply_id, "
                f"r.created_at, r.updated_at, "
                f"o.customer_name, o.customer_phone, "
                f"g.name AS group_name, g.sku AS group_sku, "
                f"NULL AS warranty_until, "
                f"r.replacement_order_id, r.replace_from_stock "
                f"FROM {SCHEMA}.warehouse_rma r "
                f"LEFT JOIN {SCHEMA}.orders o ON o.id = r.order_id "
                f"LEFT JOIN {SCHEMA}.warehouse_groups g ON g.id = r.group_id "
                f"{where} "
                f"ORDER BY r.created_at DESC LIMIT 200"
            )
            rows = cur.fetchall()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"rma": [fmt_rma(r) for r in rows]})}

        # ── Остаток на складе по group_id (для галочки «заменить со склада») ─
        if action == "stock_qty" and method == "GET":
            group_id = params.get("group_id")
            if not group_id:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "group_id required"})}
            cur.execute(
                f"SELECT COALESCE(SUM(qty), 0), COALESCE(SUM(qty_reserved), 0) "
                f"FROM {SCHEMA}.warehouse_supplies "
                f"WHERE group_id = %s AND is_quarantine = FALSE",
                (int(group_id),),
            )
            row = cur.fetchone()
            on_hand = int(row[0])
            reserved = int(row[1])
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"on_hand": on_hand, "reserved": reserved,
                                        "free": max(0, on_hand - reserved)})}

        # ── Получить компоненты заказа для выбора в форме RMA ───────────────
        if action == "order_components" and method == "GET":
            order_id = int(params.get("order_id", 0))
            if not order_id:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "order_id required"})}

            # Берём заказ
            cur.execute(
                f"SELECT o.id, o.customer_name, o.customer_phone, o.items, o.order_type "
                f"FROM {SCHEMA}.orders o WHERE o.id = %s",
                (order_id,),
            )
            orow = cur.fetchone()
            if not orow:
                return {"statusCode": 404, "headers": cors,
                        "body": json.dumps({"error": "Order not found"})}

            oid, cname, cphone, items_raw, order_type = orow
            items = items_raw if isinstance(items_raw, list) else json.loads(items_raw or "[]")

            components = []

            # 1. Из wip_builds — слоты cpu/gpu/etc с именами
            cur.execute(
                f"SELECT id, cpu, motherboard, ram, gpu, storage, psu, case_name, cooling, extra, build_id "
                f"FROM {SCHEMA}.wip_builds WHERE order_id = %s LIMIT 1",
                (order_id,),
            )
            wip = cur.fetchone()
            if wip:
                wip_id, cpu, mb, ram, gpu, storage, psu, case_n, cooling, extra, build_id = wip
                slot_map = [
                    ("cpu", cpu), ("motherboard", mb), ("ram", ram), ("gpu", gpu),
                    ("storage", storage), ("psu", psu), ("case_name", case_n),
                    ("cooling", cooling), ("extra", extra),
                ]
                # Попробуем подтянуть product_id из pc_builds.components по имени
                build_comps = {}
                if build_id:
                    cur.execute(
                        f"SELECT components FROM {SCHEMA}.pc_builds WHERE id = %s",
                        (build_id,),
                    )
                    br = cur.fetchone()
                    if br and br[0]:
                        bcomps = br[0] if isinstance(br[0], list) else json.loads(br[0] or "[]")
                        for c in bcomps:
                            build_comps[c.get("slot", "")] = c

                for slot, name in slot_map:
                    if not name:
                        continue
                    bc = build_comps.get(slot, {})
                    pid = bc.get("source_id")
                    gid = None
                    warranty_until = None
                    if pid:
                        cur.execute(
                            f"SELECT wg.id, "
                            f"(SELECT MIN(ws.warranty_until) FROM {SCHEMA}.warehouse_supplies ws "
                            f" WHERE ws.group_id = wg.id AND ws.qty_reserved > 0) "
                            f"FROM {SCHEMA}.warehouse_groups wg WHERE wg.product_id = %s",
                            (pid,),
                        )
                        gr = cur.fetchone()
                        if gr:
                            gid, warranty_until = gr[0], serial(gr[1]) if gr[1] else None
                    components.append({
                        "slot": slot,
                        "slot_label": SLOT_LABELS.get(slot, slot),
                        "name": name,
                        "product_id": pid,
                        "group_id": gid,
                        "warranty_until": warranty_until,
                        "source": "wip",
                    })

            # 2. Из items заказа (parts-тип) — product items
            for item in items:
                if item.get("item_type") == "product" and item.get("id"):
                    pid = int(item["id"])
                    cur.execute(
                        f"SELECT wg.id, g.warranty_months "
                        f"FROM {SCHEMA}.warehouse_groups wg "
                        f"JOIN {SCHEMA}.warehouse_groups g ON g.id = wg.id "
                        f"WHERE wg.product_id = %s LIMIT 1",
                        (pid,),
                    )
                    gr = cur.fetchone()
                    gid = gr[0] if gr else None
                    components.append({
                        "slot": "product",
                        "slot_label": "Товар",
                        "name": item.get("name", ""),
                        "product_id": pid,
                        "group_id": gid,
                        "warranty_until": None,
                        "source": "items",
                        "qty": item.get("quantity", 1),
                    })

            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "order_id": order_id,
                "customer_name": cname,
                "customer_phone": cphone,
                "order_type": order_type,
                "components": components,
            })}

        # ── Создать RMA-запись ───────────────────────────────────────────────
        if action == "create" and method == "POST":
            order_id = body.get("order_id")
            group_id = body.get("group_id")
            product_id = body.get("product_id")
            slot = body.get("slot", "")
            item_name = body.get("item_name", "").strip()
            qty = int(body.get("qty", 1))
            reason = body.get("reason", "").strip()
            source_type = body.get("source_type", "order")

            if not item_name or not reason:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "item_name и reason обязательны"})}
            if qty <= 0:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "qty должен быть > 0"})}

            # Создаём карантинную партию (is_quarantine=TRUE) если есть group_id
            quarantine_supply_id = None
            if group_id:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.warehouse_supplies "
                    f"(group_id, qty, qty_reserved, qty_negative, cost_price, is_quarantine) "
                    f"VALUES (%s, %s, 0, 0, 0, TRUE) RETURNING id",
                    (group_id, qty),
                )
                quarantine_supply_id = cur.fetchone()[0]
                # Логируем движение
                cur.execute(
                    f"INSERT INTO {SCHEMA}.warehouse_movements "
                    f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
                    f"VALUES (%s, %s, %s, 'quarantine_in', %s, %s, NOW())",
                    (group_id, quarantine_supply_id, order_id, qty,
                     f"Брак в карантин: {item_name} (RMA)"),
                )

            replace_from_stock = bool(body.get("replace_from_stock", False))
            replacement_order_id = None

            # Замена на ДРУГОЙ товар (опц.): свой product_id/group_id/название +
            # ручная доплата. Если товар замены не задан — меняем на тот же товар.
            repl_product_id = body.get("replacement_product_id")
            repl_group_id = body.get("replacement_group_id")
            repl_name = (body.get("replacement_name") or "").strip()
            repl_slot = body.get("replacement_slot") or ""
            surcharge = float(body.get("surcharge") or 0)

            # Что реально пойдёт в заказ-замену: товар замены или исходный товар.
            rep_pid = repl_product_id if repl_product_id else product_id
            rep_name = repl_name if repl_name else item_name
            rep_slot = repl_slot if repl_product_id else slot
            rep_price = surcharge if repl_product_id else 0

            # ── Замена со склада: создаём новый заказ-«замена по гарантии» ──
            if replace_from_stock and order_id:
                # Берём данные исходного заказа
                cur.execute(
                    f"SELECT customer_name, customer_phone, customer_email, comment "
                    f"FROM {SCHEMA}.orders WHERE id = %s",
                    (order_id,),
                )
                orig = cur.fetchone()
                if orig:
                    orig_name, orig_phone, orig_email, orig_comment = orig
                    padded = str(order_id).zfill(5)
                    note_extra = f" → {rep_name}" if repl_product_id else ""
                    new_comment = f"Замена по гарантии (заказ #{padded}){note_extra}. {orig_comment or ''}".strip()
                    item_payload = json.dumps([{
                        "item_type": "product",
                        "id": rep_pid,
                        "name": rep_name,
                        "quantity": qty,
                        "price": rep_price,
                    }]) if rep_pid else json.dumps([])
                    order_total = rep_price * qty

                    cur.execute(
                        f"INSERT INTO {SCHEMA}.orders "
                        f"(customer_name, customer_phone, customer_email, order_type, "
                        f"items, total, comment, status, created_at, updated_at) "
                        f"VALUES (%s, %s, %s, 'parts', %s, %s, %s, 'processing', NOW(), NOW()) "
                        f"RETURNING id",
                        (orig_name, orig_phone, orig_email, item_payload, order_total, new_comment),
                    )
                    replacement_order_id = cur.fetchone()[0]

                    # ── Сразу резервируем товар замены в рамках той же транзакции ──
                    if rep_pid:
                        import warehouse_core as wc
                        wc.handle_reserve_and_purchase(cur, replacement_order_id, [{
                            "product_id": int(rep_pid),
                            "qty": int(qty),
                            "slot": rep_slot or "product",
                        }])
                        print(f"RMA: резерв по заказу-замене #{replacement_order_id}, product={rep_pid}, qty={qty}, доплата={rep_price}")

            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_rma "
                f"(order_id, group_id, product_id, slot, item_name, qty, reason, "
                f"source_type, status, quarantine_qty, replace_from_stock, "
                f"replacement_order_id, detected_at, created_at, updated_at) "
                f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'new', %s, %s, %s, CURRENT_DATE, NOW(), NOW()) "
                f"RETURNING id",
                (order_id, group_id, product_id, slot, item_name, qty, reason,
                 source_type, qty, replace_from_stock, replacement_order_id),
            )
            rma_id = cur.fetchone()[0]
            conn.commit()

            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "rma_id": rma_id,
                                        "quarantine_supply_id": quarantine_supply_id,
                                        "replacement_order_id": replacement_order_id})}

        # ── Обновить статус / заметку поставщика ────────────────────────────
        if action == "update" and method == "PATCH":
            rma_id = int(body.get("id", 0))
            if not rma_id:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "id required"})}

            fields, vals = [], []
            if "status" in body:
                s = body["status"]
                if s not in ("new", "to_supplier", "in_progress", "resolved", "closed"):
                    return {"statusCode": 400, "headers": cors,
                            "body": json.dumps({"error": "bad status"})}
                fields.append("status = %s"); vals.append(s)
                if s in ("resolved", "closed"):
                    fields.append("resolved_at = CURRENT_DATE")
            if "supplier_note" in body:
                fields.append("supplier_note = %s"); vals.append(body["supplier_note"])
            if "resolution" in body:
                fields.append("resolution = %s"); vals.append(body["resolution"])
            if not fields:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "no fields to update"})}

            fields.append("updated_at = NOW()")
            vals.append(rma_id)
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_rma SET {', '.join(fields)} WHERE id = %s",
                vals,
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── Закрыть RMA с заменой: товар приходит на склад ──────────────────
        if action == "resolve_replacement" and method == "POST":
            """
            Замена пришла от поставщика:
            1. Создаём партию прихода (не карантинную).
            2. Через warehouse_core.receive_stock гасим минус-резервы (если есть).
            3. Обновляем RMA: status=resolved, resolution=replacement, replacement_supply_id.
            4. Карантинную партию помечаем qty=0 (товар ушёл поставщику).
            """
            import sys, os as _os
            sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
            # warehouse_core лежит в backend/reserves — импортируем относительно
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "warehouse_core",
                _os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                              "..", "reserves", "warehouse_core.py"),
            )
            wc = importlib.util.util if spec is None else None
            if spec:
                wc = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(wc)

            rma_id = int(body.get("rma_id", 0))
            group_id = int(body.get("group_id", 0))
            qty = int(body.get("qty", 1))
            cost_price = float(body.get("cost_price", 0))
            store_id = body.get("store_id")

            if not rma_id or not group_id or qty <= 0:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "rma_id, group_id, qty required"})}

            # Гасим карантинную партию (товар ушёл поставщику)
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_supplies "
                f"SET qty = 0, updated_at = NOW() "
                f"WHERE group_id = %s AND is_quarantine = TRUE "
                f"AND id = (SELECT id FROM {SCHEMA}.warehouse_supplies "
                f"          WHERE group_id = %s AND is_quarantine = TRUE "
                f"          ORDER BY created_at DESC LIMIT 1)",
                (group_id, group_id),
            )

            # Приход замены через ядро резервов
            recv_result = None
            if wc:
                recv_result = wc.receive_stock(cur, group_id, qty,
                                               cost_price=cost_price, store_id=store_id)
                supply_id = recv_result["supply_id"]
            else:
                # fallback: простое создание партии
                cur.execute(
                    f"INSERT INTO {SCHEMA}.warehouse_supplies "
                    f"(group_id, store_id, qty, qty_reserved, qty_negative, cost_price) "
                    f"VALUES (%s, %s, %s, 0, 0, %s) RETURNING id",
                    (group_id, store_id, qty, cost_price),
                )
                supply_id = cur.fetchone()[0]

            # Обновляем RMA
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_rma "
                f"SET status = 'resolved', resolution = 'replacement', "
                f"replacement_supply_id = %s, resolved_at = CURRENT_DATE, "
                f"quarantine_qty = 0, updated_at = NOW() "
                f"WHERE id = %s",
                (supply_id, rma_id),
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "ok": True,
                "supply_id": supply_id,
                "recv_result": recv_result,
            })}

        # ── Закрыть RMA возвратом денег ─────────────────────────────────────
        if action == "resolve_refund" and method == "POST":
            rma_id = int(body.get("rma_id", 0))
            group_id = int(body.get("group_id", 0))
            cash_account_id = body.get("cash_account_id")
            if not rma_id:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "rma_id required"})}
            # Данные РМА для расчёта суммы и описания
            cur.execute(
                f"SELECT order_id, qty, item_name FROM {SCHEMA}.warehouse_rma WHERE id = %s",
                (rma_id,),
            )
            rma_row = cur.fetchone()
            order_id_rma = rma_row[0] if rma_row else None
            rma_qty = int(rma_row[1]) if rma_row and rma_row[1] else 1
            item_name = rma_row[2] if rma_row else ""
            # Сумма возврата: передана с фронта, иначе розничная цена группы × qty
            refund_amount = 0.0
            try:
                refund_amount = float(body.get("refund_amount") or 0)
            except (TypeError, ValueError):
                refund_amount = 0.0
            if refund_amount <= 0 and group_id:
                cur.execute(
                    f"SELECT price_retail FROM {SCHEMA}.warehouse_groups WHERE id = %s",
                    (group_id,),
                )
                pr = cur.fetchone()
                if pr and pr[0]:
                    refund_amount = float(pr[0]) * rma_qty
            # Обнуляем карантинную партию
            if group_id:
                cur.execute(
                    f"UPDATE {SCHEMA}.warehouse_supplies "
                    f"SET qty = 0, updated_at = NOW() "
                    f"WHERE group_id = %s AND is_quarantine = TRUE "
                    f"ORDER BY created_at DESC LIMIT 1",
                    (group_id,),
                )
            # Финансовый расход с выбранного денежного счёта
            if cash_account_id and refund_amount > 0:
                acc_id = int(cash_account_id)
                note = f"Возврат средств по RMA #{rma_id}" + (f" (заказ #{order_id_rma})" if order_id_rma else "") + (f": {item_name}" if item_name else "")
                cur.execute(
                    f"UPDATE {SCHEMA}.cash_accounts SET balance = balance - %s, updated_at = NOW() WHERE id = %s",
                    (refund_amount, acc_id),
                )
                cur.execute(
                    f"INSERT INTO {SCHEMA}.cash_account_tx (cash_account_id, amount, note, order_id, created_at) "
                    f"VALUES (%s, %s, %s, %s, NOW())",
                    (acc_id, -refund_amount, note, order_id_rma),
                )
                # Тип операции «Возврат средств» (создаём при отсутствии)
                cur.execute(
                    f"SELECT id FROM {SCHEMA}.finance_types WHERE name = 'Возврат средств' LIMIT 1"
                )
                tr = cur.fetchone()
                if tr:
                    type_id = tr[0]
                else:
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.finance_types (name, direction, is_system, sort_order) "
                        f"VALUES ('Возврат средств', 'expense', TRUE, 6) RETURNING id"
                    )
                    type_id = cur.fetchone()[0]
                cur.execute(
                    f"INSERT INTO {SCHEMA}.finance_transactions "
                    f"(kind, type_id, amount, note, affects_pnl, cash_account_id, order_id, occurred_at) "
                    f"VALUES ('expense', %s, %s, %s, TRUE, %s, %s, NOW())",
                    (type_id, refund_amount, note, acc_id, order_id_rma),
                )
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_rma "
                f"SET status = 'resolved', resolution = 'refund', "
                f"quarantine_qty = 0, resolved_at = CURRENT_DATE, updated_at = NOW() "
                f"WHERE id = %s",
                (rma_id,),
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "refund_amount": refund_amount})}

        # ── Получить одну запись RMA ─────────────────────────────────────────
        if action == "get" and method == "GET":
            rma_id = int(params.get("id", 0))
            cur.execute(
                f"SELECT r.id, r.order_id, r.group_id, r.product_id, r.slot, r.item_name, "
                f"r.qty, r.reason, r.source_type, r.status, r.supplier_note, r.resolution, "
                f"r.detected_at, r.resolved_at, r.quarantine_qty, r.replacement_supply_id, "
                f"r.created_at, r.updated_at, "
                f"o.customer_name, o.customer_phone, g.name, g.sku, NULL, "
                f"r.replacement_order_id, r.replace_from_stock "
                f"FROM {SCHEMA}.warehouse_rma r "
                f"LEFT JOIN {SCHEMA}.orders o ON o.id = r.order_id "
                f"LEFT JOIN {SCHEMA}.warehouse_groups g ON g.id = r.group_id "
                f"WHERE r.id = %s",
                (rma_id,),
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors,
                        "body": json.dumps({"error": "not found"})}
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"rma": fmt_rma(row)})}

        # ── Статистика ───────────────────────────────────────────────────────
        if action == "stats" and method == "GET":
            cur.execute(
                f"SELECT status, COUNT(*) FROM {SCHEMA}.warehouse_rma "
                f"GROUP BY status"
            )
            stats = {r[0]: r[1] for r in cur.fetchall()}
            cur.execute(
                f"SELECT COUNT(*) FROM {SCHEMA}.warehouse_supplies "
                f"WHERE is_quarantine = TRUE AND qty > 0"
            )
            quarantine_count = cur.fetchone()[0]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "by_status": stats,
                "quarantine_partitions": int(quarantine_count),
            })}

        return {"statusCode": 400, "headers": cors,
                "body": json.dumps({"error": f"unknown action: {action}"})}

    except Exception as e:
        conn.rollback()
        import traceback
        return {"statusCode": 500, "headers": cors,
                "body": json.dumps({"error": str(e), "trace": traceback.format_exc()})}
    finally:
        cur.close()
        conn.close()