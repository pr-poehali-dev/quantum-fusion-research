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

    def mk_product(stock):
        cur.execute(
            f"INSERT INTO {SCHEMA}.products (name, price, in_stock, stock_qty) "
            f"VALUES ('__selftest_prod__', 0, true, %s) RETURNING id",
            (stock,),
        )
        pid = cur.fetchone()[0]
        cur.execute(
            f"INSERT INTO {SCHEMA}.warehouse_groups (product_id, name, sku) "
            f"VALUES (%s, '__selftest_grp__', %s) RETURNING id",
            (pid, "ST" + str(pid)[:6]),
        )
        gid = cur.fetchone()[0]
        if stock > 0:
            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_supplies (group_id, qty, qty_reserved, qty_negative, cost_price) "
                f"VALUES (%s, %s, 0, 0, 0)",
                (gid, stock),
            )
        return pid, gid

    report = []

    # ── Базовые сценарии резервирования (Этап 1) ──
    for c in cases:
        pid, gid = mk_product(c["stock"])
        core.handle_reserve_and_purchase(cur, order_id, [{"product_id": pid, "qty": c["order"], "slot": "test"}])
        st = _group_state(cur, gid)
        basket = _basket_qty(cur, gid)
        ok = (st["reserved"] == c["exp_pos"] and st["negative"] == c["exp_neg"] and basket == c["exp_neg"])
        report.append({"case": c["name"], "passed": ok,
                       "expected": {"pos": c["exp_pos"], "neg": c["exp_neg"], "basket": c["exp_neg"]},
                       "actual": {"pos": st["reserved"], "neg": st["negative"], "basket": basket,
                                  "on_hand": st["on_hand"]}})

    # ── Хвост Этапа 1: пользовательское железо (нет product_id) → пропуск ──
    res = core.handle_reserve_and_purchase(cur, order_id, [{"product_id": None, "qty": 3, "slot": "test"}])
    ok = (res[0]["status"] == "skipped" and res[0]["skipped_reason"] == "user_hardware")
    report.append({"case": "user_hardware -> skipped", "passed": ok, "actual": res[0]})

    # ── Хвост Этапа 1: возврат qty<=0 → минус-резерв НЕ применяется ──
    pid, gid = mk_product(0)
    res = core.handle_reserve_and_purchase(cur, order_id, [{"product_id": pid, "qty": -2, "slot": "test"}])
    st = _group_state(cur, gid)
    ok = (res[0]["status"] == "skipped" and st["negative"] == 0 and _basket_qty(cur, gid) == 0)
    report.append({"case": "negative qty -> skipped", "passed": ok,
                   "actual": {"res": res[0], "neg": st["negative"]}})

    # ── Хвост Этапа 1: отмена заказа возвращает POSITIVE в наличие ──
    pid, gid = mk_product(10)
    cur.execute(
        f"INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, order_type, items, total, status, created_at, updated_at) "
        f"VALUES ('__selftest2__','0','parts','[]'::jsonb,0,'new',NOW(),NOW()) RETURNING id"
    )
    oid2 = cur.fetchone()[0]
    core.handle_reserve_and_purchase(cur, oid2, [{"product_id": pid, "qty": 4}])
    before = _group_state(cur, gid)
    core.release_order_reserves(cur, oid2)
    after = _group_state(cur, gid)
    ok = (before["reserved"] == 4 and before["on_hand"] == 6 and
          after["reserved"] == 0 and after["on_hand"] == 10)
    report.append({"case": "cancel order -> stock restored", "passed": ok,
                   "actual": {"before": before, "after": after}})

    # ── ЭТАП 2: приход гасит минус-резерв (0/0/5 -> приход 5 -> pos5 neg0) ──
    pid, gid = mk_product(0)
    cur.execute(
        f"INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, order_type, items, total, status, created_at, updated_at) "
        f"VALUES ('__selftest3__','0','parts','[]'::jsonb,0,'new',NOW(),NOW()) RETURNING id"
    )
    oid3 = cur.fetchone()[0]
    core.handle_reserve_and_purchase(cur, oid3, [{"product_id": pid, "qty": 5}])
    mid = _group_state(cur, gid)  # ожидаем neg5
    recv = core.receive_stock(cur, gid, 5, cost_price=100)
    fin = _group_state(cur, gid)
    ok = (mid["negative"] == 5 and fin["negative"] == 0 and fin["reserved"] == 5 and
          fin["on_hand"] == 0 and recv["fulfilled"] == 5 and _basket_qty(cur, gid) == 0)
    report.append({"case": "receive fully clears negative -> positive", "passed": ok,
                   "actual": {"after_order": mid, "after_receive": fin, "recv": recv}})

    # ── ЭТАП 2: FIFO по дате заказа (2 заказа, приход 3 = первому 2, второму 1) ──
    pid, gid = mk_product(0)
    cur.execute(
        f"INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, order_type, items, total, status, created_at, updated_at) "
        f"VALUES ('__selftestA__','0','parts','[]'::jsonb,0,'new', NOW() - INTERVAL '2 hours', NOW()) RETURNING id"
    )
    oid_a = cur.fetchone()[0]
    cur.execute(
        f"INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, order_type, items, total, status, created_at, updated_at) "
        f"VALUES ('__selftestB__','0','parts','[]'::jsonb,0,'new', NOW() - INTERVAL '1 hours', NOW()) RETURNING id"
    )
    oid_b = cur.fetchone()[0]
    core.handle_reserve_and_purchase(cur, oid_a, [{"product_id": pid, "qty": 2}])
    core.handle_reserve_and_purchase(cur, oid_b, [{"product_id": pid, "qty": 3}])
    recv = core.receive_stock(cur, gid, 3, cost_price=100)
    # Проверяем, что первый заказ (раньше) погашен полностью, второй частично
    cur.execute(
        f"SELECT order_id, COALESCE(SUM(CASE WHEN type='POSITIVE' AND status='ACTIVE' THEN qty ELSE 0 END),0), "
        f"COALESCE(SUM(CASE WHEN type='NEGATIVE' AND status='ACTIVE' THEN qty ELSE 0 END),0) "
        f"FROM {SCHEMA}.warehouse_reserves WHERE order_id IN (%s,%s) GROUP BY order_id ORDER BY order_id",
        (oid_a, oid_b),
    )
    rows = {r[0]: {"pos": int(r[1]), "neg": int(r[2])} for r in cur.fetchall()}
    a, b = rows.get(oid_a, {}), rows.get(oid_b, {})
    ok = (a.get("pos") == 2 and a.get("neg") == 0 and  # первый: полностью погашен
          b.get("pos") == 1 and b.get("neg") == 2)      # второй: 1 погашен, 2 ещё в минусе
    report.append({"case": "FIFO by order date (2+3, recv 3)", "passed": ok,
                   "actual": {"order_a": a, "order_b": b, "recv": recv}})

    report.append({"summary": {
        "total": len([r for r in report if "passed" in r]),
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

        # ── ЭТАП 2: Приход товара + FIFO-гашение минус-резервов ─────────────
        if action == "receive" and method == "POST":
            group_id = int(body["group_id"])
            qty = int(body.get("qty", 0))
            res = core.receive_stock(
                cur, group_id, qty,
                cost_price=float(body.get("cost_price", 0)),
                store_id=body.get("store_id"),
                cell=body.get("cell"),
                purchase_date=body.get("purchase_date"),
                supply_id=body.get("supply_id"),
            )

            # ── Авто-обновление slot_status в wip_builds ────────────────────
            # Для каждого заказа которому пришёл товар — найти слот в wip_builds,
            # обновить его статус на "ready" и проверить: всё ли железо готово.
            wip_updates = []
            if res.get("fulfilled_orders"):
                # Узнаём product_id группы
                cur.execute(
                    f"SELECT product_id FROM {SCHEMA}.warehouse_groups WHERE id = %s",
                    (group_id,)
                )
                grp_row = cur.fetchone()
                product_id = grp_row[0] if grp_row else None

                for fo in res["fulfilled_orders"]:
                    order_id_fo = fo["order_id"]
                    if not product_id:
                        continue
                    # Найти wip_build по order_id
                    cur.execute(
                        f"SELECT wb.id, wb.build_id, wb.stage FROM {SCHEMA}.wip_builds wb "
                        f"WHERE wb.order_id = %s LIMIT 1",
                        (order_id_fo,)
                    )
                    wb_row = cur.fetchone()
                    if not wb_row:
                        continue
                    wb_id, build_id, wb_stage = wb_row
                    if not build_id:
                        continue
                    # Найти слот компонента по product_id
                    cur.execute(
                        f"SELECT components FROM {SCHEMA}.pc_builds WHERE id = %s", (build_id,)
                    )
                    pb = cur.fetchone()
                    if not pb or not pb[0]:
                        continue
                    import json as _json
                    comps = pb[0] if isinstance(pb[0], list) else _json.loads(pb[0] or "[]")
                    slot = None
                    for c in comps:
                        if c.get("source_id") and int(c["source_id"]) == product_id:
                            slot = c.get("slot")
                            break
                    if not slot:
                        continue
                    # Обновляем статус слота на "ready"
                    field = "case_status" if slot == "case" else slot + "_status"
                    cur.execute(
                        f"UPDATE {SCHEMA}.wip_builds SET {field}='ready', updated_at=NOW() WHERE id=%s",
                        (wb_id,)
                    )
                    # Обновляем статус в purchase_basket на RECEIVED
                    cur.execute(
                        f"UPDATE {SCHEMA}.warehouse_purchase_basket "
                        f"SET status='RECEIVED', updated_at=NOW() WHERE group_id=%s",
                        (group_id,)
                    )
                    # Проверяем: все ли слоты сборки теперь "ready" или "pending"
                    slot_fields = [
                        "cpu_status", "motherboard_status", "ram_status", "gpu_status",
                        "storage_status", "psu_status", "case_status", "cooling_status", "extra_status"
                    ]
                    cur.execute(
                        f"SELECT wb.cpu, wb.motherboard, wb.ram, wb.gpu, wb.storage, wb.psu, "
                        f"wb.case_name, wb.cooling, wb.extra, "
                        f"wb.cpu_status, wb.motherboard_status, wb.ram_status, wb.gpu_status, "
                        f"wb.storage_status, wb.psu_status, wb.case_status, wb.cooling_status, "
                        f"wb.extra_status, wb.stage "
                        f"FROM {SCHEMA}.wip_builds wb WHERE wb.id = %s",
                        (wb_id,)
                    )
                    wrow = cur.fetchone()
                    if wrow:
                        comp_names = wrow[:9]   # значения компонентов (None если не заполнен)
                        comp_statuses = wrow[9:18]  # статусы
                        current_stage = wrow[18]
                        # Считаем только заполненные слоты
                        all_ready = all(
                            st in ("ready", "pending") or name is None
                            for name, st in zip(comp_names, comp_statuses)
                            if name is not None
                        )
                        not_ready = [
                            st for name, st in zip(comp_names, comp_statuses)
                            if name is not None and st not in ("ready", "pending")
                        ]
                        if len(not_ready) == 0 and current_stage == "Ожидание железа":
                            cur.execute(
                                f"UPDATE {SCHEMA}.wip_builds SET stage='Ожидание сборки', updated_at=NOW() WHERE id=%s",
                                (wb_id,)
                            )
                            cur.execute(
                                f"UPDATE {SCHEMA}.orders SET status='waiting_assembly', updated_at=NOW() "
                                f"WHERE id=(SELECT order_id FROM {SCHEMA}.wip_builds WHERE id=%s)",
                                (wb_id,)
                            )
                            wip_updates.append({"wip_id": wb_id, "auto_stage": "Ожидание сборки"})
                        else:
                            wip_updates.append({"wip_id": wb_id, "slot": slot, "slot_status": "ready"})

            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "result": res, "wip_updates": wip_updates})}

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

        # ── Корзина закупки, сгруппированная по сборкам ─────────────────────
        if action == "basket_by_wip" and method == "GET":
            cur.execute(
                f"""
                SELECT
                    b.group_id, g.name, g.sku, b.required_qty, b.status, g.url_supplier,
                    wb.id as wip_id, wb.order_number, wb.order_id, wb.stage,
                    comp->>'slot' as slot,
                    CASE comp->>'slot'
                        WHEN 'cpu'         THEN wb.cpu_status
                        WHEN 'motherboard' THEN wb.motherboard_status
                        WHEN 'ram'         THEN wb.ram_status
                        WHEN 'gpu'         THEN wb.gpu_status
                        WHEN 'storage'     THEN wb.storage_status
                        WHEN 'psu'         THEN wb.psu_status
                        WHEN 'case'        THEN wb.case_status
                        WHEN 'cooling'     THEN wb.cooling_status
                        WHEN 'extra'       THEN wb.extra_status
                        ELSE 'pending'
                    END as slot_status
                FROM {SCHEMA}.warehouse_purchase_basket b
                JOIN {SCHEMA}.warehouse_groups g ON g.id = b.group_id
                JOIN {SCHEMA}.pc_builds pcb ON true
                JOIN jsonb_array_elements(pcb.components) comp ON (comp->>'source_id')::int = g.product_id
                JOIN {SCHEMA}.wip_builds wb ON wb.build_id = pcb.id
                WHERE b.required_qty > 0
                  AND wb.stage NOT IN ('Архив', 'Забрали', 'Отменён')
                ORDER BY wb.order_number, b.status
                """
            )
            rows = cur.fetchall()
            by_wip = {}
            for r in rows:
                group_id, name, sku, req_qty, status, url_supplier, wip_id, order_number, order_id, stage, slot, slot_status = r
                key = str(wip_id)
                if key not in by_wip:
                    by_wip[key] = {"wip_id": wip_id, "order_number": order_number, "order_id": order_id, "stage": stage, "items": []}
                by_wip[key]["items"].append({
                    "group_id": group_id, "name": name, "sku": sku,
                    "required_qty": req_qty, "status": status,
                    "url_supplier": url_supplier, "slot": slot, "slot_status": slot_status,
                })
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"builds": list(by_wip.values())})}

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