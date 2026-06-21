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


def _cleanup_selftest(cur):
    """
    Физически удаляет ВСЕ следы селф-тестов из БД (метки __selftest__).
    Безопасно: трогает только записи с тест-метками. Вызывается до и после
    прогона теста — гарантирует, что мусор не накапливается, даже если
    предыдущий rollback не сработал.
    Возвращает кол-во удалённых заказов/групп/товаров.
    Чистит заказы (customer_name __selftest*), тест-группы и зависимые записи.
    """
    # id тестовых заказов и групп
    cur.execute(
        f"SELECT id FROM {SCHEMA}.orders "
        f"WHERE customer_name LIKE '\\_\\_selftest%' OR customer_name LIKE '\\_\\_SELFTEST%'"
    )
    order_ids = [r[0] for r in cur.fetchall()]
    cur.execute(f"SELECT id FROM {SCHEMA}.warehouse_groups WHERE name = '__selftest_grp__'")
    group_ids = [r[0] for r in cur.fetchall()]

    def _in(ids):
        return "(" + ",".join(str(int(i)) for i in ids) + ")" if ids else "(-1)"

    oi, gi = _in(order_ids), _in(group_ids)

    # Зависимые таблицы (по заказам и по группам)
    for col, vals in (("order_id", oi), ("group_id", gi)):
        cur.execute(f"DELETE FROM {SCHEMA}.warehouse_reserves WHERE {col} IN {vals}")
        cur.execute(f"DELETE FROM {SCHEMA}.warehouse_movements WHERE {col} IN {vals}")
        cur.execute(f"DELETE FROM {SCHEMA}.warehouse_stock_log WHERE {col} IN {vals}")
    cur.execute(f"DELETE FROM {SCHEMA}.warehouse_purchase_basket WHERE group_id IN {gi}")
    cur.execute(f"DELETE FROM {SCHEMA}.warehouse_supplies WHERE group_id IN {gi}")
    cur.execute(f"DELETE FROM {SCHEMA}.warehouse_groups WHERE id IN {gi}")
    cur.execute(f"DELETE FROM {SCHEMA}.orders WHERE id IN {oi}")
    cur.execute(f"DELETE FROM {SCHEMA}.products WHERE name = '__selftest_prod__'")
    return {"orders": len(order_ids), "groups": len(group_ids)}


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

    # ── ОТМЕНА: NEGATIVE со статусом NEW снимается, корзина уменьшается ──
    pid, gid = mk_product(0)
    cur.execute(
        f"INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, order_type, items, total, status, created_at, updated_at) "
        f"VALUES ('__selftestC__','0','pc_build','[]'::jsonb,0,'new',NOW(),NOW()) RETURNING id"
    )
    oid_c = cur.fetchone()[0]
    core.handle_reserve_and_purchase(cur, oid_c, [{"product_id": pid, "qty": 3}])
    before = {"neg": _group_state(cur, gid)["negative"], "basket": _basket_qty(cur, gid)}
    core.release_order_reserves(cur, oid_c, only_new_negative=True)
    after = {"neg": _group_state(cur, gid)["negative"], "basket": _basket_qty(cur, gid)}
    ok = (before["neg"] == 3 and before["basket"] == 3 and
          after["neg"] == 0 and after["basket"] == 0)
    report.append({"case": "cancel NEW negative -> basket cleared", "passed": ok,
                   "actual": {"before": before, "after": after}})

    # ── ОТМЕНА: NEGATIVE со статусом ORDERED НЕ снимается (железо заказано) ──
    pid, gid = mk_product(0)
    cur.execute(
        f"INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, order_type, items, total, status, created_at, updated_at) "
        f"VALUES ('__selftestD__','0','pc_build','[]'::jsonb,0,'new',NOW(),NOW()) RETURNING id"
    )
    oid_d = cur.fetchone()[0]
    core.handle_reserve_and_purchase(cur, oid_d, [{"product_id": pid, "qty": 4}])
    # Менеджер пометил "Заказано"
    cur.execute(
        f"UPDATE {SCHEMA}.warehouse_purchase_basket SET status='ORDERED' WHERE group_id=%s",
        (gid,)
    )
    before = {"neg": _group_state(cur, gid)["negative"], "basket": _basket_qty(cur, gid)}
    rel = core.release_order_reserves(cur, oid_d, only_new_negative=True)
    after = {"neg": _group_state(cur, gid)["negative"], "basket": _basket_qty(cur, gid)}
    # ORDERED железо остаётся: neg и корзина НЕ меняются, kept_ordered=4
    ok = (before["neg"] == 4 and after["neg"] == 4 and
          after["basket"] == 4 and rel["kept_ordered"] == 4 and rel["negative"] == 0)
    report.append({"case": "cancel ORDERED negative -> kept in basket", "passed": ok,
                   "actual": {"before": before, "after": after, "released": rel}})

    # ── ОТМЕНА: ORDERED железо приходит и ложится в наличие даже после отмены ──
    pid, gid = mk_product(0)
    cur.execute(
        f"INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, order_type, items, total, status, created_at, updated_at) "
        f"VALUES ('__selftestE__','0','pc_build','[]'::jsonb,0,'new',NOW(),NOW()) RETURNING id"
    )
    oid_e = cur.fetchone()[0]
    core.handle_reserve_and_purchase(cur, oid_e, [{"product_id": pid, "qty": 2}])
    cur.execute(
        f"UPDATE {SCHEMA}.warehouse_purchase_basket SET status='ORDERED' WHERE group_id=%s",
        (gid,)
    )
    # Реальная отмена: снимаем резервы (ORDERED минус сохраняется) + заказ в архив
    core.release_order_reserves(cur, oid_e, only_new_negative=True)
    cur.execute(f"UPDATE {SCHEMA}.orders SET status='archived' WHERE id=%s", (oid_e,))
    # Железо приехало — должно лечь в СВОБОДНОЕ наличие, а не под отменённый заказ
    recv = core.receive_stock(cur, gid, 2, cost_price=100)
    st = _group_state(cur, gid)
    free = st["on_hand"] - st["reserved"]
    # Приёмка игнорирует резерв отменённого заказа: ничего не "fulfilled",
    # товар лёг в свободный остаток (free=2), под призрака ничего не зарезервировано
    ok = (recv["fulfilled"] == 0 and recv["free_added"] == 2 and
          st["reserved"] == 0 and free == 2)
    report.append({"case": "ORDERED hardware arrives after cancel -> free stock", "passed": ok,
                   "actual": {"state": st, "free": free, "recv": recv}})

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
        # ── ТЕСТ: одно уведомление о задержке по РЕАЛЬНОЙ позиции ───────────
        # Ничего в БД не меняет. Берёт ближайшую просроченную ETA живой сборки
        # (или самую раннюю запланированную, если просрочек нет) и шлёт пинг
        # с реальным номером заказа и названием компонента.
        if action == "test_delay_notify" and method == "GET":
            _name_fields = {
                "cpu": "cpu", "motherboard": "motherboard", "ram": "ram", "gpu": "gpu",
                "storage": "storage", "psu": "psu", "case": "case_name",
                "cooling": "cooling", "extra": "extra", "fan": "extra",
            }
            _ru = {
                "cpu": "Процессор", "motherboard": "Материнская плата", "ram": "Память",
                "gpu": "Видеокарта", "storage": "Накопитель", "psu": "Блок питания",
                "case": "Корпус", "cooling": "Охлаждение", "extra": "Доп.", "fan": "Доп.",
            }
            cur.execute(
                f"SELECT eta.wip_id, eta.slot, eta.eta_date, wb.order_number, "
                f"       wb.order_id, o.display_number, wb.build_id, "
                f"       (eta.eta_date < CURRENT_DATE) AS overdue "
                f"FROM {SCHEMA}.wip_component_eta eta "
                f"JOIN {SCHEMA}.wip_builds wb ON wb.id = eta.wip_id "
                f"LEFT JOIN {SCHEMA}.orders o ON o.id = wb.order_id "
                f"WHERE eta.eta_date IS NOT NULL "
                f"AND wb.stage NOT IN ('Архив','Забрали','Отменён','Готов, можно забрать','Отнести в сдэк') "
                f"ORDER BY (eta.eta_date < CURRENT_DATE) DESC, eta.eta_date ASC LIMIT 1"
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 200, "headers": cors,
                        "body": json.dumps({"ok": False, "reason": "Нет позиций с ETA для теста"})}
            wip_id, slot, eta_date, order_number, order_id, display_number, build_id, overdue = row
            slot_canon = "extra" if slot == "fan" else slot
            nf = _name_fields.get(slot, "extra")
            cur.execute(
                f"SELECT {nf} FROM {SCHEMA}.wip_builds WHERE id=%s", (wip_id,)
            )
            nr = cur.fetchone()
            component_name = (nr[0] if nr else None)
            if (not component_name) and build_id:
                cur.execute(f"SELECT components FROM {SCHEMA}.pc_builds WHERE id=%s", (build_id,))
                pr = cur.fetchone()
                comps = pr[0] if pr and pr[0] else []
                if isinstance(comps, str):
                    comps = json.loads(comps)
                for c in (comps or []):
                    cs = "extra" if c.get("slot") == "fan" else c.get("slot")
                    if cs == slot_canon and c.get("name"):
                        component_name = c["name"]
                        break
            ordn = display_number or order_number or (str(order_id) if order_id else "—")
            slot_label = _ru.get(slot, slot)
            _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
            _link = f"\n🔗 <a href=\"{_base}/admin/wip_builds\">Открыть в сборках</a>" if _base else ""
            _tag = "" if overdue else "\n<i>(тест — позиция ещё не просрочена)</i>"
            try:
                from tg_notify import notify_tasks
                notify_tasks(
                    f"🧪 <b>ТЕСТ · Задержка железа</b>\n"
                    f"Заказ: #{ordn}\n"
                    f"Компонент: {component_name or '—'} ({slot_label})\n"
                    f"Ожидался: {eta_date.isoformat() if eta_date else '—'}"
                    f"{_tag}{_link}"
                )
            except Exception as _te:
                return {"statusCode": 200, "headers": cors,
                        "body": json.dumps({"ok": False, "error": str(_te)})}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "ok": True, "sent": True, "overdue": bool(overdue),
                "order": ordn, "component": component_name or "—",
                "slot": slot_label, "eta_date": eta_date.isoformat() if eta_date else None,
            })}

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
                    # Обновляем статус слота на "ready" ТОЛЬКО у этой сборки (индивидуально).
                    # purchase_basket.status НЕ трогаем — он общий на товар и в UI больше
                    # не используется как источник статуса позиции (см. basket_by_wip).
                    field = "case_status" if slot == "case" else slot + "_status"
                    cur.execute(
                        f"UPDATE {SCHEMA}.wip_builds SET {field}='ready', updated_at=NOW() WHERE id=%s",
                        (wb_id,)
                    )
                    # Товар приехал — снимаем его ETA (если была)
                    cur.execute(
                        f"DELETE FROM {SCHEMA}.wip_component_eta WHERE wip_id=%s AND slot=%s",
                        (wb_id, slot)
                    )
                    core.recompute_wip_received_at(cur, wb_id)
                    # Авто-этап: всё приехало → «Ожидание сборки», всё заказано → «Ожидание железа»
                    new_stage = core.recompute_wip_stage(cur, wb_id)
                    if new_stage:
                        wip_updates.append({"wip_id": wb_id, "auto_stage": new_stage})
                    else:
                        wip_updates.append({"wip_id": wb_id, "slot": slot, "slot_status": "ready"})

            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "result": res, "wip_updates": wip_updates})}

        # ── Дата прихода железки (ETA) для конкретной сборки ─────────────────
        # Указание даты = «Заказано»: железка переводится в "ordered_transit".
        if action == "set_component_eta" and method == "POST":
            wip_id = int(body["wip_id"])
            slot = body["slot"]
            # Допы приходят со слотом 'fan' — нормализуем к 'extra' (единая колонка).
            if slot == "fan":
                slot = "extra"
            _ALLOWED_SLOTS = {"cpu", "motherboard", "ram", "gpu", "storage",
                              "psu", "case", "cooling", "extra"}
            if slot not in _ALLOWED_SLOTS:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "bad_slot"})}
            eta = body.get("eta_date") or None  # 'YYYY-MM-DD' или null (сброс)
            # Магазин: если ключ store_id вообще не передан — НЕ трогаем уже
            # сохранённый магазин (иначе выбор даты затирал бы его в NULL).
            store_passed = "store_id" in body
            store_id = body.get("store_id")
            store_id = int(store_id) if store_id not in (None, "") else None
            # 1) Сохраняем/сбрасываем ETA позиции (+ магазин если передан)
            if store_passed:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.wip_component_eta (wip_id, slot, eta_date, store_id) "
                    f"VALUES (%s, %s, %s, %s) "
                    f"ON CONFLICT (wip_id, slot) DO UPDATE SET "
                    f"eta_date = EXCLUDED.eta_date, store_id = EXCLUDED.store_id, updated_at = NOW()",
                    (wip_id, slot, eta, store_id),
                )
            else:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.wip_component_eta (wip_id, slot, eta_date) "
                    f"VALUES (%s, %s, %s) "
                    f"ON CONFLICT (wip_id, slot) DO UPDATE SET "
                    f"eta_date = EXCLUDED.eta_date, updated_at = NOW()",
                    (wip_id, slot, eta),
                )
            # 2) Статус железки: дата задана → "ordered_transit" (Едет/Заказано),
            #    если дата уже в прошлом → "ordered_delay" (Задержка); сброс → "need_order"
            field = "case_status" if slot == "case" else slot + "_status"
            if eta:
                cur.execute(
                    f"UPDATE {SCHEMA}.wip_builds SET {field}="
                    f"CASE WHEN %s::date < CURRENT_DATE THEN 'ordered_delay' ELSE 'ordered_transit' END, "
                    f"updated_at=NOW() WHERE id=%s AND {field} <> 'ready'",
                    (eta, wip_id),
                )
            else:
                cur.execute(
                    f"UPDATE {SCHEMA}.wip_builds SET {field}='need_order', updated_at=NOW() "
                    f"WHERE id=%s AND {field} <> 'ready'",
                    (wip_id,),
                )
            # 3) Пересчёт даты прихода сборки и авто-этапа
            received_at = core.recompute_wip_received_at(cur, wip_id)
            new_stage = core.recompute_wip_stage(cur, wip_id)
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps(
                {"ok": True, "received_at": received_at, "auto_stage": new_stage})}

        # ── Магазин «откуда забирать» железку (для календаря заборов) ────────
        if action == "set_component_store" and method == "POST":
            wip_id = int(body["wip_id"])
            slot = body["slot"]
            if slot == "fan":
                slot = "extra"
            store_id = body.get("store_id")
            store_id = int(store_id) if store_id not in (None, "") else None
            cur.execute(
                f"INSERT INTO {SCHEMA}.wip_component_eta (wip_id, slot, store_id) "
                f"VALUES (%s, %s, %s) "
                f"ON CONFLICT (wip_id, slot) DO UPDATE SET store_id = EXCLUDED.store_id, updated_at = NOW()",
                (wip_id, slot, store_id),
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

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
            # Сначала помечаем просроченные ETA как «Задержка» (ordered_delay).
            # Возвращает только что задержавшиеся позиции — уведомляем и дублируем
            # в календарь (однократно, т.к. повторно статус уже ordered_delay).
            newly_delayed = core.mark_overdue_delays(cur)
            for d in (newly_delayed or []):
                ordn = d.get("order_number") or (str(d.get("order_id")) if d.get("order_id") else "—")
                title = f"⚠️ Задержка: {d.get('slot_label')} (заказ #{ordn})"
                descr = (
                    f"Компонент: {d.get('component_name')}\n"
                    f"Слот: {d.get('slot_label')}\n"
                    f"Заказ: #{ordn}\n"
                    f"Ожидался: {d.get('eta_date') or '—'}"
                )
                # Событие в календаре (на сегодня, как задача)
                try:
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.calendar_events "
                        f"(event_date, title, description, kind, status, origin_date) "
                        f"VALUES (CURRENT_DATE, %s, %s, 'task', 'new', CURRENT_DATE)",
                        (title, descr),
                    )
                except Exception as _ce:
                    print(f"DELAY calendar: {_ce}")
                # Уведомление в беседу задач
                try:
                    from tg_notify import notify_tasks
                    _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
                    _link = f"\n🔗 <a href=\"{_base}/admin/wip_builds\">Открыть в сборках</a>" if _base else ""
                    notify_tasks(
                        f"⚠️ <b>Задержка железа</b>\n"
                        f"Заказ: #{ordn}\n"
                        f"Компонент: {d.get('component_name')} ({d.get('slot_label')})\n"
                        f"Ожидался: {d.get('eta_date') or '—'}"
                        f"{_link}"
                    )
                except Exception as _te:
                    print(f"DELAY notify: {_te}")
            cur.execute(
                f"""
                SELECT
                    b.group_id, g.name, g.sku,
                    COALESCE((comp->>'qty')::int, 1) as required_qty,
                    b.status, g.url_supplier,
                    wb.id as wip_id, wb.order_number, wb.order_id, wb.stage,
                    -- Допы хранятся со слотом 'fan', но статус-колонка одна — extra_status.
                    -- Нормализуем slot к каноничному ключу слота wip_builds.
                    CASE comp->>'slot' WHEN 'fan' THEN 'extra' ELSE comp->>'slot' END as slot,
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
                        WHEN 'fan'         THEN wb.extra_status
                        ELSE 'pending'
                    END as slot_status,
                    eta.eta_date, eta.store_id
                FROM {SCHEMA}.warehouse_purchase_basket b
                JOIN {SCHEMA}.warehouse_groups g ON g.id = b.group_id
                JOIN {SCHEMA}.pc_builds pcb ON true
                JOIN jsonb_array_elements(pcb.components) comp ON (comp->>'source_id')::int = g.product_id
                JOIN {SCHEMA}.wip_builds wb ON wb.build_id = pcb.id
                LEFT JOIN {SCHEMA}.wip_component_eta eta
                    ON eta.wip_id = wb.id
                    AND eta.slot = CASE comp->>'slot' WHEN 'fan' THEN 'extra' ELSE comp->>'slot' END
                WHERE b.required_qty > 0
                  AND wb.stage NOT IN ('Архив', 'Забрали', 'Отменён', 'Согласование')
                ORDER BY wb.order_number, b.status
                """
            )
            rows = cur.fetchall()
            # Статус позиции в корзине — ИНДИВИДУАЛЬНЫЙ для каждой сборки:
            # выводим его из wip_builds.{slot}_status, а НЕ из общего purchase_basket.status
            # (иначе одинаковые товары в разных заказах делили бы один статус).
            WIP_TO_BASKET = {
                "ready": "RECEIVED",
                "ordered_transit": "ORDERED",
                "ordered_delay": "ORDERED",
            }
            by_wip = {}
            for r in rows:
                group_id, name, sku, req_qty, status, url_supplier, wip_id, order_number, order_id, stage, slot, slot_status, eta_date, store_id = r
                item_status = WIP_TO_BASKET.get(slot_status, "NEW")
                key = str(wip_id)
                if key not in by_wip:
                    by_wip[key] = {"wip_id": wip_id, "order_number": order_number, "order_id": order_id, "stage": stage, "items": []}
                by_wip[key]["items"].append({
                    "group_id": group_id, "name": name, "sku": sku,
                    "required_qty": req_qty, "status": item_status,
                    "url_supplier": url_supplier, "slot": slot, "slot_status": slot_status,
                    "eta_date": eta_date.isoformat() if eta_date else None,
                    "is_delayed": slot_status == "ordered_delay",
                    "store_id": store_id,
                })
            # Сортировка сборок: сверху те, где есть незаказанные (NEW) позиции,
            # затем по номеру заказа от нового к старому.
            def _order_key(b):
                has_new = any(i["status"] == "NEW" for i in b["items"])
                try:
                    num = int(b["order_number"])
                except (TypeError, ValueError):
                    num = b["wip_id"]
                return (0 if has_new else 1, -num)
            builds_sorted = sorted(by_wip.values(), key=_order_key)
            conn.commit()  # фиксируем авто-пометку «Задержка»
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"builds": builds_sorted})}

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
            # Гарантированная зачистка: удаляем любой накопившийся тест-мусор
            # (например, если прошлый прогон не откатился). Отдельная транзакция.
            cleaned = _cleanup_selftest(cur)
            conn.commit()
            cases = [r for r in report if "passed" in r]
            failed = [r for r in cases if not r.get("passed")]
            summary = {
                "total": len(cases),
                "passed": sum(1 for r in cases if r.get("passed")),
                "failed": len(failed),
                "all_passed": len(failed) == 0,
                "failed_cases": [{"case": r["case"], "actual": r.get("actual")} for r in failed],
                "cleaned": cleaned,
            }
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "summary": summary, "report": report})}

        # ── Принудительная зачистка тест-мусора (на случай ручного вызова) ─────
        if action == "cleanup_selftest" and method in ("POST", "GET"):
            cleaned = _cleanup_selftest(cur)
            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "cleaned": cleaned})}

        return {"statusCode": 400, "headers": cors,
                "body": json.dumps({"error": f"unknown action: {action}"})}

    except Exception as e:
        conn.rollback()
        return {"statusCode": 500, "headers": cors, "body": json.dumps({"error": str(e)})}
    finally:
        cur.close()
        conn.close()