import json
import os
import secrets
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def get_user_by_session(cur, session_id):
    if not session_id:
        return None
    cur.execute(
        "SELECT u.id FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.id = %s AND s.expires_at > NOW()",
        (session_id,)
    )
    row = cur.fetchone()
    return row[0] if row else None

def handler(event: dict, context) -> dict:
    """
    Заказы: POST создать, GET список (для админа или для пользователя по сессии), PATCH статус.
    При создании заказа автоматически привязывается к пользователю по X-Session-Id.
    GET ?my=true — вернуть заказы текущего пользователя (для ЛК).
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")

    conn = get_conn()
    cur = conn.cursor()

    def fmt_order(row):
        return {
            "id": row[0], "customer_name": row[1], "customer_phone": row[2],
            "customer_email": row[3], "order_type": row[4], "items": row[5],
            "total": float(row[6]), "comment": row[7], "status": row[8],
            "created_at": row[9].isoformat() if row[9] else None,
            "updated_at": row[10].isoformat() if row[10] else None,
            "user_id": row[11],
            "wip_stage": row[12] if len(row) > 12 else None,
        }

    try:
        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            user_id = get_user_by_session(cur, session_id)
            cur.execute(
                """INSERT INTO orders (customer_name, customer_phone, customer_email, order_type,
                   items, total, comment, status, user_id, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 'new', %s, NOW(), NOW()) RETURNING id""",
                (body["customer_name"], body["customer_phone"],
                 body.get("customer_email"), body.get("order_type", "cart"),
                 json.dumps(body["items"]), body["total"],
                 body.get("comment"), user_id)
            )
            order_id = cur.fetchone()[0]

            order_type = body.get("order_type", "cart")
            items = body.get("items") or []
            parts_total = float(body["total"])
            customer = body["customer_name"]

            print(f"ORDER {order_id}: type={order_type}, items={json.dumps(items)}")

            # ── АВТОРЕЗЕРВ: резервируем товары на складе по product_id ──────────
            schema = "t_p72635010_quantum_fusion_resea"
            for item in items:
                if item.get("item_type") == "product" and item.get("id"):
                    pid = int(item["id"])
                    need_qty = int(item.get("quantity", 1))
                    # берём поставки с доступным остатком, сортируем по FIFO
                    cur.execute(
                        f"SELECT s.id, s.qty - s.qty_reserved as free "
                        f"FROM {schema}.warehouse_supplies s "
                        f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                        f"WHERE g.product_id = %s AND s.qty - s.qty_reserved > 0 "
                        f"ORDER BY s.id ASC",
                        (pid,)
                    )
                    supplies = cur.fetchall()
                    for supply_id, free in supplies:
                        if need_qty <= 0:
                            break
                        reserve = min(need_qty, free)
                        cur.execute(
                            f"UPDATE {schema}.warehouse_supplies SET qty_reserved = qty_reserved + %s "
                            f"WHERE id = %s AND qty - qty_reserved >= %s",
                            (reserve, supply_id, reserve)
                        )
                        cur.execute(
                            f"INSERT INTO {schema}.warehouse_movements "
                            f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
                            f"VALUES ((SELECT group_id FROM {schema}.warehouse_supplies WHERE id = %s), "
                            f"%s, %s, 'reserved', %s, %s, NOW())",
                            (supply_id, supply_id, order_id, reserve, f"Авторезерв по заказу #{order_id}")
                        )
                        need_qty -= reserve

            def is_catalog_id(v):
                try:
                    return 0 < int(str(v)) < 10**9
                except Exception:
                    return False

            def extract_components(items_list, with_assembly):
                """Извлечь компоненты из списка items. Приоритет: components в item -> каталог по id -> fallback."""
                result = []
                asm_type = "percent" if with_assembly else "manual"
                asm_fee_val = round(parts_total * 0.07) if with_assembly else 0

                for it in items_list:
                    # Конфигуратор передаёт components прямо в item
                    if it.get("components"):
                        result.extend(it["components"])
                    elif it.get("item_type") == "config" and is_catalog_id(it.get("id")):
                        # Готовая сборка из каталога — берём компоненты из БД
                        cur.execute("SELECT components, assembly_type, assembly_fee FROM pc_builds WHERE id = %s", (it["id"],))
                        row = cur.fetchone()
                        if row and row[0]:
                            result.extend(row[0])
                            asm_type = row[1] or asm_type
                            asm_fee_val = float(row[2] or asm_fee_val)
                        else:
                            result.append({"name": it.get("name", ""), "slot": "other",
                                           "price": it.get("price", 0), "source": "order", "qty": 1})
                    elif it.get("item_type") == "product" and is_catalog_id(it.get("id")):
                        result.append({"name": it.get("name", ""), "slot": "other",
                                       "price": it.get("price", 0), "source": "catalog",
                                       "source_id": it["id"], "qty": it.get("quantity", 1)})
                    else:
                        result.append({"name": it.get("name", ""), "slot": "other",
                                       "price": it.get("price", 0), "source": "order",
                                       "qty": it.get("quantity", 1)})
                return result, asm_type, asm_fee_val

            if order_type == "pc_build":
                build_name = f"Заказ {order_id:05d}"
                description = f"Заказ ПК #{order_id:05d} от {customer}"
                has_assembly = any(it.get("assembly", True) for it in items if it.get("item_type") == "config")
                components, asm_type, asm_fee = extract_components(items, has_assembly)

                # Генерируем клиентский токен для ссылки на сборку
                client_token = secrets.token_urlsafe(32)

                cur.execute(
                    """INSERT INTO pc_builds (name, description, components, parts_total, assembly_fee,
                       total_price, assembly_type, status, client_token, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, 'client', %s, NOW()) RETURNING id""",
                    (build_name, description, json.dumps(components), parts_total, asm_fee, parts_total, asm_type, client_token)
                )
                build_id = cur.fetchone()[0]

                # Раскладываем компоненты по слотам для wip_builds
                slot_map = {}
                for c in components:
                    slot = c.get("slot", "other")
                    name = c.get("name", "")
                    if slot == "cpu": slot_map["cpu"] = name
                    elif slot == "gpu": slot_map["gpu"] = name
                    elif slot == "ram": slot_map["ram"] = name
                    elif slot == "storage": slot_map["storage"] = name
                    elif slot == "psu": slot_map["psu"] = name
                    elif slot == "case": slot_map["case_name"] = name
                    elif slot == "motherboard": slot_map["motherboard"] = name
                    elif slot == "cooling": slot_map["cooling"] = name
                    else: slot_map.setdefault("extra", name)

                cur.execute(
                    """INSERT INTO wip_builds (order_number, stage, order_id, build_id, client_token,
                       cpu, motherboard, ram, gpu, storage, psu, case_name, cooling, extra,
                       cpu_status, motherboard_status, ram_status, gpu_status, storage_status,
                       psu_status, case_status, cooling_status, extra_status, updated_at)
                       VALUES (%s, 'Согласование', %s, %s, %s, %s,%s,%s,%s,%s,%s,%s,%s,%s,
                       'pending','pending','pending','pending','pending','pending','pending','pending','pending', NOW())""",
                    (f"{order_id:05d}", order_id, build_id, client_token,
                     slot_map.get("cpu"), slot_map.get("motherboard"), slot_map.get("ram"),
                     slot_map.get("gpu"), slot_map.get("storage"), slot_map.get("psu"),
                     slot_map.get("case_name"), slot_map.get("cooling"), slot_map.get("extra"))
                )

                # TODO: notify_telegram(order_id, body["customer_name"], body["customer_phone"])
                # Отправить уведомление менеджеру в Telegram о новом заказе ПК

            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": order_id, "ok": True})}

        elif method == "GET":
            # Один заказ по id
            if params.get("id"):
                cur.execute(
                    """SELECT id, customer_name, customer_phone, customer_email, order_type,
                              items, total, comment, status, created_at, updated_at, user_id
                       FROM orders WHERE id = %s""",
                    (int(params["id"]),)
                )
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
                order = fmt_order(row)
                schema = "t_p72635010_quantum_fusion_resea"

                if order.get("order_type") == "pc_build":
                    # Для ПК-заказов: items = слоты из wip_build с данными склада и статусами
                    cur.execute(
                        f"SELECT wb.id, wb.stage, wb.cpu, wb.motherboard, wb.ram, wb.gpu, wb.storage, "
                        f"wb.psu, wb.case_name, wb.cooling, wb.extra, "
                        f"wb.cpu_status, wb.motherboard_status, wb.ram_status, wb.gpu_status, wb.storage_status, "
                        f"wb.psu_status, wb.case_status, wb.cooling_status, wb.extra_status, "
                        f"wb.build_id "
                        f"FROM wip_builds wb WHERE wb.order_id = %s LIMIT 1",
                        (int(params["id"]),)
                    )
                    wip = cur.fetchone()
                    if wip:
                        slot_names = ["cpu", "motherboard", "ram", "gpu", "storage", "psu", "case_name", "cooling", "extra"]
                        slot_labels = {"cpu": "Процессор", "motherboard": "Материнская плата", "ram": "ОЗУ",
                                       "gpu": "Видеокарта", "storage": "Накопитель", "psu": "Блок питания",
                                       "case_name": "Корпус", "cooling": "Охлаждение", "extra": "Доп."}
                        # Маппинг slot -> source_id из pc_build
                        slot_product_map = {}  # slot -> product_id
                        slot_price_map = {}    # slot -> price из pc_builds.components
                        assembly_fee = 0
                        build_id = wip[20]
                        if build_id:
                            cur.execute(f"SELECT components, assembly_fee FROM {schema}.pc_builds WHERE id = %s LIMIT 1", (build_id,))
                            pc_row = cur.fetchone()
                            if pc_row and pc_row[0]:
                                raw = pc_row[0] if isinstance(pc_row[0], list) else json.loads(pc_row[0])
                                for comp in raw:
                                    s = comp.get("slot")
                                    if s:
                                        if comp.get("source") == "catalog" and comp.get("source_id"):
                                            slot_product_map[s] = int(comp["source_id"])
                                        if comp.get("price"):
                                            slot_price_map[s] = float(comp["price"])
                            if pc_row and pc_row[1]:
                                assembly_fee = float(pc_row[1])

                        # Серийники и финальные цены из items заказа (по slot)
                        slot_serials = {}
                        slot_final_price = {}
                        slot_item_status = {}
                        for it in order["items"]:
                            s = it.get("slot")
                            if s:
                                sn = it.get("serial_numbers") or []
                                if not sn and it.get("serial_number"):
                                    sn = [it["serial_number"]]
                                slot_serials[s] = [x for x in sn if x and str(x).strip()]
                                if it.get("final_price"):
                                    slot_final_price[s] = float(it["final_price"])
                                if it.get("item_status"):
                                    slot_item_status[s] = it["item_status"]

                        wip_items = []
                        for i, slot in enumerate(slot_names):
                            name = wip[2 + i]
                            wip_status = wip[11 + i] or "pending"
                            if not name or not name.strip():
                                continue
                            product_id = slot_product_map.get(slot)
                            # Ищем product_id по имени если нет маппинга
                            if not product_id:
                                cur.execute(f"SELECT id FROM {schema}.products p WHERE p.name = %s LIMIT 1", (name,))
                                pr = cur.fetchone()
                                if pr:
                                    product_id = pr[0]
                            # Цена: финальная из заказа → из pc_builds.components → из warehouse_groups
                            price = slot_final_price.get(slot) or slot_price_map.get(slot, 0)
                            if not price and product_id:
                                cur.execute(f"SELECT price_retail FROM {schema}.warehouse_groups WHERE product_id = %s LIMIT 1", (product_id,))
                                pr2 = cur.fetchone()
                                if pr2 and pr2[0]:
                                    price = float(pr2[0])
                            # Складские остатки
                            supplies = []
                            if product_id:
                                cur.execute(
                                    f"SELECT s.id, s.qty, s.qty_reserved, s.qty_negative, wg.warranty_months, wg.id "
                                    f"FROM {schema}.warehouse_supplies s "
                                    f"JOIN {schema}.warehouse_groups wg ON wg.id = s.group_id "
                                    f"WHERE wg.product_id = %s ORDER BY s.id ASC",
                                    (product_id,)
                                )
                                supplies = [{"id": r[0], "qty": r[1], "qty_reserved": r[2],
                                             "free": r[1] - r[2], "qty_negative": r[3],
                                             "warranty_months": r[4], "group_id": r[5]}
                                            for r in cur.fetchall()]
                            wip_items.append({
                                "id": product_id,
                                "name": name,
                                "price": price,
                                "quantity": 1,
                                "item_type": "product",
                                "slot": slot,
                                "slot_label": slot_labels.get(slot, slot),
                                "wip_status": wip_status,
                                "item_status": slot_item_status.get(slot),
                                "serial_numbers": slot_serials.get(slot, []),
                                "_supplies": supplies,
                            })

                        # Строка стоимости сборки
                        if assembly_fee:
                            wip_items.append({
                                "id": None,
                                "name": "Работа по сборке и настройке ПК",
                                "price": assembly_fee,
                                "quantity": 1,
                                "item_type": "assembly",
                                "slot": None,
                                "slot_label": "Услуга",
                                "wip_status": None,
                                "item_status": None,
                                "serial_numbers": [],
                                "_supplies": [],
                            })

                        order["items"] = wip_items
                        order["_wip_stage"] = wip[1]
                else:
                    # Для обычных заказов — подтягиваем складские остатки
                    for item in order["items"]:
                        pid = item.get("id")
                        if pid and item.get("item_type") == "product":
                            cur.execute(
                                f"SELECT s.id, s.qty, s.qty_reserved, wg.warranty_months, wg.id as gid "
                                f"FROM {schema}.warehouse_supplies s "
                                f"JOIN {schema}.warehouse_groups wg ON wg.id = s.group_id "
                                f"WHERE wg.product_id = %s ORDER BY s.id ASC",
                                (int(pid),)
                            )
                            supplies = [{"id": r[0], "qty": r[1], "qty_reserved": r[2],
                                         "free": r[1] - r[2], "warranty_months": r[3], "group_id": r[4]}
                                        for r in cur.fetchall()]
                            item["_supplies"] = supplies
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"order": order})}

            # Заказы текущего пользователя (для ЛК)
            if params.get("my") == "true":
                user_id = get_user_by_session(cur, session_id)
                if not user_id:
                    return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
                cur.execute(
                    """SELECT id, customer_name, customer_phone, customer_email, order_type,
                              items, total, comment, status, created_at, updated_at, user_id
                       FROM orders WHERE user_id = %s ORDER BY created_at DESC""",
                    (user_id,)
                )
                orders = [fmt_order(r) for r in cur.fetchall()]
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"orders": orders})}

            # Все заказы (для админа)
            status_filter = params.get("status")
            where = "WHERE o.status = %s" if status_filter else ""
            args = [status_filter] if status_filter else []
            cur.execute(
                f"""SELECT o.id, o.customer_name, o.customer_phone, o.customer_email, o.order_type,
                           o.items, o.total, o.comment, o.status, o.created_at, o.updated_at, o.user_id,
                           wb.stage as wip_stage
                    FROM orders o
                    LEFT JOIN wip_builds wb ON wb.order_id = o.id
                    {where} ORDER BY o.created_at DESC LIMIT 200""",
                args
            )
            orders = [fmt_order(r) for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"orders": orders})}

        elif method == "PUT":
            # Обновление позиций заказа: серийник, цена, статус, замена товара, резерв
            body = json.loads(event.get("body") or "{}")
            order_id = int(body["id"])
            action = body.get("action")
            schema = "t_p72635010_quantum_fusion_resea"

            cur.execute("SELECT items, total FROM orders WHERE id = %s", (order_id,))
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
            items = row[0] if isinstance(row[0], list) else json.loads(row[0])

            item_idx = body.get("item_idx")  # индекс позиции в items

            if action == "set_serial":
                # Сохранить серийные номера позиции (массив — по одному на каждую штуку)
                if "serial_numbers" in body:
                    items[item_idx]["serial_numbers"] = body["serial_numbers"]
                else:
                    items[item_idx]["serial_number"] = body.get("serial_number", "")
                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))

            elif action == "set_price":
                # Изменить финальную цену позиции
                items[item_idx]["final_price"] = float(body["price"])
                # Пересчитать total
                total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1)
                            for it in items)
                cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), total, order_id))

            elif action == "set_warranty":
                # Установить срок гарантии для позиции (в месяцах)
                items[item_idx]["warranty_months"] = int(body.get("warranty_months", 12))
                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))

            elif action == "set_status":
                # Статус позиции: reserved / issued / returned
                items[item_idx]["item_status"] = body.get("item_status", "reserved")
                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))

            elif action == "unreserve":
                # Снять резерв по позиции и вернуть на склад
                pid = items[item_idx].get("id")
                qty = int(items[item_idx].get("quantity", 1))
                if pid:
                    cur.execute(
                        f"SELECT s.id FROM {schema}.warehouse_supplies s "
                        f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                        f"WHERE g.product_id = %s AND s.qty_reserved > 0 ORDER BY s.id ASC",
                        (int(pid),)
                    )
                    supplies = cur.fetchall()
                    left = qty
                    for (sid,) in supplies:
                        if left <= 0: break
                        cur.execute(
                            f"UPDATE {schema}.warehouse_supplies "
                            f"SET qty_reserved = GREATEST(0, qty_reserved - %s) WHERE id = %s "
                            f"RETURNING group_id",
                            (left, sid)
                        )
                        r = cur.fetchone()
                        if r:
                            cur.execute(
                                f"INSERT INTO {schema}.warehouse_movements "
                                f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
                                f"VALUES (%s, %s, %s, 'unreserved', %s, %s, NOW())",
                                (r[0], sid, order_id, -left, f"Снят резерв по заказу #{order_id}")
                            )
                        left -= left
                items[item_idx]["item_status"] = "returned"
                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))

            elif action == "replace_item":
                # Заменить товар в позиции на другой из склада
                new_product_id = int(body["new_product_id"])
                cur.execute(
                    f"SELECT p.name, p.price, wg.warranty_months "
                    f"FROM {schema}.products p "
                    f"LEFT JOIN {schema}.warehouse_groups wg ON wg.product_id = p.id "
                    f"WHERE p.id = %s LIMIT 1",
                    (new_product_id,)
                )
                pr = cur.fetchone()
                if not pr:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Товар не найден"})}
                qty = int(items[item_idx].get("quantity", 1))
                # Проверить наличие нового товара
                cur.execute(
                    f"SELECT COALESCE(SUM(s.qty - s.qty_reserved), 0) FROM {schema}.warehouse_supplies s "
                    f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id WHERE g.product_id = %s",
                    (new_product_id,)
                )
                available = int((cur.fetchone() or [0])[0])
                if available < qty:
                    return {"statusCode": 400, "headers": cors, "body": json.dumps({
                        "error": f"Недостаточно товара на складе. Свободно: {available} шт."
                    })}
                # Снять резерв со старого товара
                old_pid = items[item_idx].get("id")
                if old_pid:
                    cur.execute(
                        f"UPDATE {schema}.warehouse_supplies SET qty_reserved = GREATEST(0, qty_reserved - %s) "
                        f"WHERE id = (SELECT s.id FROM {schema}.warehouse_supplies s "
                        f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                        f"WHERE g.product_id = %s AND s.qty_reserved > 0 LIMIT 1)",
                        (qty, int(old_pid))
                    )
                # Зарезервировать новый (FIFO)
                cur.execute(
                    f"SELECT s.id, s.qty - s.qty_reserved as free FROM {schema}.warehouse_supplies s "
                    f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                    f"WHERE g.product_id = %s AND s.qty - s.qty_reserved > 0 ORDER BY s.id ASC",
                    (new_product_id,)
                )
                left = qty
                for (sid, sfree) in cur.fetchall():
                    if left <= 0: break
                    reserve = min(left, sfree)
                    cur.execute(
                        f"UPDATE {schema}.warehouse_supplies SET qty_reserved = qty_reserved + %s WHERE id = %s",
                        (reserve, sid)
                    )
                    left -= reserve
                # Обновляем позицию
                items[item_idx]["id"] = new_product_id
                items[item_idx]["name"] = pr[0]
                items[item_idx]["price"] = float(pr[1])
                items[item_idx].pop("final_price", None)
                items[item_idx].pop("serial_number", None)
                items[item_idx].pop("serial_numbers", None)
                items[item_idx]["item_status"] = "reserved"
                total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1)
                            for it in items)
                cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), total, order_id))

            elif action == "sync_order":
                # Синхронизировать заказ ПК: резервировать наличие, отрицательный резерв для отсутствующих
                # Получаем wip_build и pc_build для этого заказа
                cur.execute(
                    f"SELECT wb.id, wb.cpu, wb.motherboard, wb.ram, wb.gpu, wb.storage, wb.psu, wb.cooling, wb.extra, "
                    f"wb.cpu_status, wb.motherboard_status, wb.ram_status, wb.gpu_status, wb.storage_status, "
                    f"wb.psu_status, wb.cooling_status, wb.extra_status, wb.build_id "
                    f"FROM wip_builds wb WHERE wb.order_id = %s LIMIT 1",
                    (order_id,)
                )
                wip = cur.fetchone()
                if not wip:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Сборка в процессе не найдена"})}

                wip_id = wip[0]
                build_id = wip[17]
                slot_names = ["cpu", "motherboard", "ram", "gpu", "storage", "psu", "cooling", "extra"]
                slot_values = list(wip[1:9])    # названия компонентов
                slot_statuses = list(wip[9:17]) # текущие статусы

                # Получаем компоненты из pc_builds для сопоставления product_id
                pc_components = []
                if build_id:
                    cur.execute(f"SELECT components FROM {schema}.pc_builds WHERE id = %s LIMIT 1", (build_id,))
                    pc_row = cur.fetchone()
                    if pc_row and pc_row[0]:
                        raw = pc_row[0] if isinstance(pc_row[0], list) else json.loads(pc_row[0])
                        pc_components = raw

                # Строим маппинг slot -> source_id (product_id из каталога)
                slot_product_map = {}
                for comp in pc_components:
                    slot = comp.get("slot")
                    if slot and comp.get("source") == "catalog" and comp.get("source_id"):
                        slot_product_map[slot] = int(comp["source_id"])

                reserved_items = []
                negative_items = []
                new_statuses = {}

                for slot, name, status in zip(slot_names, slot_values, slot_statuses):
                    if not name or name.strip() == "":
                        continue
                    # Уже обработан — пропускаем
                    if status in ("ready", "need_order", "ordered_transit", "ordered_delay"):
                        continue

                    product_id = slot_product_map.get(slot)
                    if not product_id:
                        # Пробуем найти по названию
                        cur.execute(
                            f"SELECT p.id FROM {schema}.products p WHERE p.name = %s LIMIT 1",
                            (name,)
                        )
                        pr = cur.fetchone()
                        if pr:
                            product_id = pr[0]

                    if not product_id:
                        new_statuses[slot] = "need_order"
                        negative_items.append({"slot": slot, "name": name, "reason": "product_not_found"})
                        continue

                    # Проверяем свободный остаток
                    cur.execute(
                        f"SELECT s.id, s.qty - s.qty_reserved as free FROM {schema}.warehouse_supplies s "
                        f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                        f"WHERE g.product_id = %s AND s.qty - s.qty_reserved > 0 ORDER BY s.id ASC LIMIT 1",
                        (product_id,)
                    )
                    supply = cur.fetchone()

                    if supply:
                        # Резервируем
                        cur.execute(
                            f"UPDATE {schema}.warehouse_supplies SET qty_reserved = qty_reserved + 1 WHERE id = %s",
                            (supply[0],)
                        )
                        cur.execute(
                            f"INSERT INTO {schema}.warehouse_movements "
                            f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
                            f"VALUES ((SELECT group_id FROM {schema}.warehouse_supplies WHERE id=%s), %s, %s, 'reserved', 1, %s, NOW())",
                            (supply[0], supply[0], order_id, f"Авторезерв слот {slot} по заказу #{order_id}")
                        )
                        new_statuses[slot] = "ready"
                        reserved_items.append({"slot": slot, "name": name, "product_id": product_id})
                    else:
                        # Ставим отрицательный резерв
                        cur.execute(
                            f"SELECT s.id FROM {schema}.warehouse_supplies s "
                            f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                            f"WHERE g.product_id = %s ORDER BY s.id DESC LIMIT 1",
                            (product_id,)
                        )
                        neg_supply = cur.fetchone()
                        if neg_supply:
                            cur.execute(
                                f"UPDATE {schema}.warehouse_supplies SET qty_negative = qty_negative + 1 WHERE id = %s",
                                (neg_supply[0],)
                            )
                        else:
                            # Нет ни одной поставки — создаём виртуальную запись с qty_negative
                            cur.execute(
                                f"SELECT g.id FROM {schema}.warehouse_groups g WHERE g.product_id = %s LIMIT 1",
                                (product_id,)
                            )
                            grp = cur.fetchone()
                            if grp:
                                cur.execute(
                                    f"INSERT INTO {schema}.warehouse_supplies (group_id, qty, qty_reserved, qty_negative, cost_price, created_at) "
                                    f"VALUES (%s, 0, 0, 1, 0, NOW())",
                                    (grp[0],)
                                )
                        new_statuses[slot] = "need_order"
                        negative_items.append({"slot": slot, "name": name, "product_id": product_id})

                # Обновляем статусы слотов в wip_build
                set_parts = []
                for slot, st in new_statuses.items():
                    set_parts.append(f"{slot}_status = '{st}'")
                if set_parts:
                    cur.execute(
                        f"UPDATE wip_builds SET {', '.join(set_parts)}, updated_at=NOW() WHERE id = %s",
                        (wip_id,)
                    )

                # Если всё в ready — меняем статус заказа на waiting_assembly
                all_slots_filled = all(
                    not v or not v.strip() or
                    new_statuses.get(s, slot_statuses[i]) == "ready"
                    for i, (s, v) in enumerate(zip(slot_names, slot_values))
                )
                if all_slots_filled and not negative_items:
                    cur.execute("UPDATE orders SET status='waiting_assembly', updated_at=NOW() WHERE id=%s", (order_id,))
                    cur.execute("UPDATE wip_builds SET stage='Ожидание сборки', updated_at=NOW() WHERE id=%s", (wip_id,))

                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({
                    "ok": True,
                    "reserved": reserved_items,
                    "need_order": negative_items,
                    "auto_status": "waiting_assembly" if (all_slots_filled and not negative_items) else None
                })}

            elif action == "add_item":
                # Добавить новый товар со склада в заказ
                new_product_id = int(body["new_product_id"])
                qty = int(body.get("quantity", 1))
                cur.execute(
                    f"SELECT p.name, p.price FROM {schema}.products p WHERE p.id = %s LIMIT 1",
                    (new_product_id,)
                )
                pr = cur.fetchone()
                if not pr:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Товар не найден"})}
                # Проверить наличие
                cur.execute(
                    f"SELECT COALESCE(SUM(s.qty - s.qty_reserved), 0) FROM {schema}.warehouse_supplies s "
                    f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id WHERE g.product_id = %s",
                    (new_product_id,)
                )
                available = int((cur.fetchone() or [0])[0])
                if available < qty:
                    return {"statusCode": 400, "headers": cors, "body": json.dumps({
                        "error": f"Недостаточно товара на складе. Свободно: {available} шт."
                    })}
                # Зарезервировать (FIFO)
                cur.execute(
                    f"SELECT s.id, s.qty - s.qty_reserved as free FROM {schema}.warehouse_supplies s "
                    f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                    f"WHERE g.product_id = %s AND s.qty - s.qty_reserved > 0 ORDER BY s.id ASC",
                    (new_product_id,)
                )
                left = qty
                for (sid, sfree) in cur.fetchall():
                    if left <= 0: break
                    reserve = min(left, sfree)
                    cur.execute(
                        f"UPDATE {schema}.warehouse_supplies SET qty_reserved = qty_reserved + %s WHERE id = %s",
                        (reserve, sid)
                    )
                    cur.execute(
                        f"INSERT INTO {schema}.warehouse_movements "
                        f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
                        f"VALUES ((SELECT group_id FROM {schema}.warehouse_supplies WHERE id=%s), %s, %s, 'reserved', %s, %s, NOW())",
                        (sid, sid, order_id, reserve, f"Добавлен товар в заказ #{order_id}")
                    )
                    left -= reserve
                items.append({
                    "id": new_product_id,
                    "name": pr[0],
                    "price": float(pr[1]),
                    "quantity": qty,
                    "item_type": "product",
                    "item_status": "reserved",
                })
                total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1) for it in items)
                cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), total, order_id))

            elif action == "change_qty":
                # Изменить количество позиции: снять старый резерв, поставить новый
                new_qty = int(body.get("quantity", 1))
                if new_qty < 1:
                    return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Количество должно быть >= 1"})}
                pid = items[item_idx].get("id")
                old_qty = int(items[item_idx].get("quantity", 1))
                delta = new_qty - old_qty  # положительный = добавляем, отрицательный = убираем
                if pid and delta != 0:
                    if delta > 0:
                        # Проверить наличие свободного остатка
                        cur.execute(
                            f"SELECT COALESCE(SUM(s.qty - s.qty_reserved), 0) as free "
                            f"FROM {schema}.warehouse_supplies s "
                            f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                            f"WHERE g.product_id = %s",
                            (int(pid),)
                        )
                        row = cur.fetchone()
                        available = int(row[0]) if row else 0
                        if available < delta:
                            return {"statusCode": 400, "headers": cors, "body": json.dumps({
                                "error": f"Недостаточно товара на складе. Свободно: {available} шт."
                            })}
                        # Зарезервировать дополнительное количество (FIFO)
                        left = delta
                        cur.execute(
                            f"SELECT s.id, s.qty - s.qty_reserved as free FROM {schema}.warehouse_supplies s "
                            f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                            f"WHERE g.product_id = %s AND s.qty - s.qty_reserved > 0 ORDER BY s.id ASC",
                            (int(pid),)
                        )
                        for (sid, sfree) in cur.fetchall():
                            if left <= 0: break
                            reserve = min(left, sfree)
                            cur.execute(
                                f"UPDATE {schema}.warehouse_supplies SET qty_reserved = qty_reserved + %s WHERE id = %s",
                                (reserve, sid)
                            )
                            cur.execute(
                                f"INSERT INTO {schema}.warehouse_movements "
                                f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
                                f"VALUES ((SELECT group_id FROM {schema}.warehouse_supplies WHERE id=%s), %s, %s, 'reserved', %s, %s, NOW())",
                                (sid, sid, order_id, reserve, f"Увеличено кол-во по заказу #{order_id}")
                            )
                            left -= reserve
                    else:
                        # Снять лишний резерв (FIFO)
                        left = abs(delta)
                        cur.execute(
                            f"SELECT s.id FROM {schema}.warehouse_supplies s "
                            f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                            f"WHERE g.product_id = %s AND s.qty_reserved > 0 ORDER BY s.id ASC",
                            (int(pid),)
                        )
                        for (sid,) in cur.fetchall():
                            if left <= 0: break
                            cur.execute(
                                f"UPDATE {schema}.warehouse_supplies "
                                f"SET qty_reserved = GREATEST(0, qty_reserved - %s) WHERE id = %s "
                                f"RETURNING group_id",
                                (left, sid)
                            )
                            r = cur.fetchone()
                            if r:
                                cur.execute(
                                    f"INSERT INTO {schema}.warehouse_movements "
                                    f"(group_id, supply_id, order_id, type, qty_delta, note, created_at) "
                                    f"VALUES (%s, %s, %s, 'unreserved', %s, %s, NOW())",
                                    (r[0], sid, order_id, -left, f"Уменьшено кол-во по заказу #{order_id}")
                                )
                            left -= left
                items[item_idx]["quantity"] = new_qty
                items[item_idx]["item_status"] = "reserved"
                total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1) for it in items)
                cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), total, order_id))

            elif action == "writeoff_order":
                # Списать все зарезервированные товары заказа и перевести статус в done
                wrote_off = []
                for it in items:
                    pid = it.get("id")
                    qty = int(it.get("quantity", 1))
                    item_status = it.get("item_status", "reserved")
                    if not pid or item_status == "returned":
                        continue
                    sale_price = float(it.get("final_price") or it.get("price", 0))
                    # Находим поставки с достаточным qty (не только резерв — резерв мог быть снят вручную)
                    cur.execute(
                        f"SELECT s.id, s.qty, s.qty_reserved, s.cost_price, g.id as gid "
                        f"FROM {schema}.warehouse_supplies s "
                        f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                        f"WHERE g.product_id = %s AND s.qty > 0 ORDER BY s.id ASC",
                        (int(pid),)
                    )
                    supplies = cur.fetchall()
                    left = qty
                    for sid, s_qty, s_reserved, s_cost, gid in supplies:
                        if left <= 0:
                            break
                        write = min(left, s_qty)
                        margin = round((sale_price - float(s_cost)) * write, 2)
                        cur.execute(
                            f"UPDATE {schema}.warehouse_supplies "
                            f"SET qty = qty - %s, qty_reserved = GREATEST(0, qty_reserved - %s), updated_at = NOW() "
                            f"WHERE id = %s AND qty >= %s",
                            (write, write, sid, write)
                        )
                        cur.execute(
                            f"INSERT INTO {schema}.warehouse_movements "
                            f"(group_id, supply_id, order_id, type, qty_delta, cost_price, sale_price, margin, note, created_at) "
                            f"VALUES (%s, %s, %s, 'sale', %s, %s, %s, %s, %s, NOW())",
                            (gid, sid, order_id, -write, float(s_cost), sale_price, margin,
                             f"Продажа {write} шт. по заказу #{order_id}")
                        )
                        left -= write
                    # Обновить in_stock и stock_qty в products
                    cur.execute(
                        f"UPDATE {schema}.products SET "
                        f"stock_qty = (SELECT COALESCE(SUM(s2.qty), 0) FROM {schema}.warehouse_supplies s2 "
                        f"  JOIN {schema}.warehouse_groups g2 ON g2.id = s2.group_id WHERE g2.product_id = products.id), "
                        f"in_stock = (SELECT COALESCE(SUM(s2.qty), 0) > 0 FROM {schema}.warehouse_supplies s2 "
                        f"  JOIN {schema}.warehouse_groups g2 ON g2.id = s2.group_id WHERE g2.product_id = products.id) "
                        f"WHERE id = %s",
                        (int(pid),)
                    )
                    it["item_status"] = "issued"
                    wrote_off.append({"name": it.get("name"), "qty": qty - left, "price": sale_price})

                cur.execute("UPDATE orders SET items=%s, status='done', updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))
                conn.commit()
                return {"statusCode": 200, "headers": cors,
                        "body": json.dumps({"ok": True, "wrote_off": wrote_off, "items": items})}

            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "items": items})}

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            new_status = body["status"]
            order_id = body["id"]
            cur.execute("UPDATE orders SET status=%s, updated_at=NOW() WHERE id=%s", (new_status, order_id))
            # Синхронизируем стадию wip_build со статусом заказа ПК
            STATUS_TO_STAGE = {
                "new":              "Согласование",
                "ordering":         "Заказ",
                "waiting_assembly": "Ожидание сборки",
                "assembly":         "Сборка",
                "cancelled":        "Отменён",
            }
            if new_status in STATUS_TO_STAGE:
                cur.execute(
                    "UPDATE wip_builds SET stage=%s, updated_at=NOW() WHERE order_id=%s",
                    (STATUS_TO_STAGE[new_status], order_id)
                )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}