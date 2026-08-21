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

SLOT_LABELS = {
    "cpu": "Процессор", "motherboard": "Материнская плата", "ram": "ОЗУ",
    "gpu": "Видеокарта", "storage": "Накопитель", "psu": "Блок питания",
    "case": "Корпус", "case_name": "Корпус", "cooling": "Охлаждение",
    "fan": "Вентилятор", "extra": "Доп.", "other": "Прочее",
}


def build_pc_snapshot(cur, schema, order_id, order_items, build_id, wip_row, build_qty):
    """Строит «чистый» снимок позиций ПК-заказа (без обогащения складом).

    Источник состава — pc_builds.components (qty*build_qty), цены из components,
    serials/final_price/item_status берутся из существующих orders.items (по slot),
    assembly_fee/assembly_warranty — из pc_builds + items. Возвращает список items
    в формате снимка (product-строки + строка assembly).

    wip_row — кортеж выборки wip_builds (см. GET-by-id) либо None; здесь не
    используется для состава (состав из pc_builds), оставлен для совместимости
    сигнатуры и возможных будущих нужд.
    """
    raw_items = order_items or []

    # Финальные цены / серийники / статусы / гарантии из существующих items.
    # Ключуем по (slot, id) — в сборке бывает несколько позиций с одним slot
    # (напр. корпус + доп. дисплей в slot='case'); ключ только по slot приводил
    # бы к перезаписи цены одной позиции ценой другой.
    slot_serials = {}          # по slot (для обратной совместимости serial-логики)
    slot_final_price = {}      # (slot, id) -> final_price
    slot_item_status = {}      # (slot, id) -> status
    slot_warranty = {}         # (slot, id) -> warranty_months
    for it in raw_items:
        stored = it.get("slot_serials") or {}
        for s, sn in stored.items():
            slot_serials[s] = sn if isinstance(sn, list) else [sn]
    for it in raw_items:
        s = it.get("slot")
        if s:
            key = (s, it.get("id"))
            sn = it.get("serial_numbers") or []
            if not sn and it.get("serial_number"):
                sn = [it["serial_number"]]
            if sn:
                slot_serials[s] = [x for x in sn if x and str(x).strip()]
            if it.get("final_price") is not None:
                slot_final_price[key] = float(it["final_price"])
            if it.get("item_status"):
                slot_item_status[key] = it["item_status"]
            if it.get("warranty_months") is not None:
                slot_warranty[key] = it["warranty_months"]

    # Гарантия / серийник / финальная цена услуги сборки
    assembly_warranty = 12
    assembly_serial = []
    assembly_final_price = None
    for it in raw_items:
        if it.get("item_type") in ("config", "assembly") or it.get("assembly"):
            if it.get("assembly_warranty"):
                assembly_warranty = int(it["assembly_warranty"])
            if it.get("warranty_months") is not None and it.get("item_type") == "assembly":
                assembly_warranty = int(it["warranty_months"])
            sn = it.get("serial_numbers") or []
            if not sn and it.get("serial_number"):
                sn = [it["serial_number"]]
            assembly_serial = [x for x in sn if x and str(x).strip()]
            if it.get("final_price") is not None:
                assembly_final_price = float(it["final_price"])

    # Состав + цены + assembly_fee из pc_builds
    build_components = []
    assembly_fee = 0.0
    if build_id:
        cur.execute(f"SELECT components, assembly_fee FROM {schema}.pc_builds WHERE id = %s LIMIT 1", (build_id,))
        pc_row = cur.fetchone()
        if pc_row:
            if pc_row[0]:
                build_components = pc_row[0] if isinstance(pc_row[0], list) else json.loads(pc_row[0])
            if pc_row[1]:
                assembly_fee = float(pc_row[1])

    snapshot = []
    for comp in build_components:
        slot = comp.get("slot")
        name = comp.get("name")
        if not name or not str(name).strip():
            continue
        product_id = None
        if comp.get("source") == "catalog" and comp.get("source_id"):
            product_id = int(comp["source_id"])
        if not product_id:
            cur.execute(f"SELECT id FROM {schema}.products p WHERE p.name = %s LIMIT 1", (name,))
            pr = cur.fetchone()
            if pr:
                product_id = pr[0]
        slot_qty = int(comp.get("qty", 1)) * build_qty
        raw_price = float(comp.get("price", 0) or 0)
        key = (slot, product_id)
        snapshot.append({
            "id": product_id,
            "name": name,
            "slot": slot,
            "slot_label": SLOT_LABELS.get(slot, slot),
            "price": raw_price,
            "final_price": slot_final_price.get(key),
            "quantity": slot_qty,
            "item_type": "product",
            "warranty_months": slot_warranty.get(key),
            "serial_numbers": slot_serials.get(slot, []),
            "item_status": slot_item_status.get(key),
        })

    # Строка услуги сборки
    snapshot.append({
        "id": None,
        "name": "Работа по сборке и настройке ПК",
        "slot": "assembly",
        "price": assembly_fee,
        "final_price": assembly_final_price,
        "quantity": 1,
        "item_type": "assembly",
        "warranty_months": assembly_warranty,
        "serial_numbers": assembly_serial,
        "item_status": None,
    })
    return snapshot


def handler(event: dict, context) -> dict:
    """
    Заказы: POST создать, GET список (для админа или для пользователя по сессии), PATCH статус.
    При создании заказа автоматически привязывается к пользователю по X-Session-Id.
    GET ?my=true — вернуть заказы текущего пользователя (для ЛК).
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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

    def fmt_order(row, disp=None, for_sale=None, is_stock_sale=None, quiz_request_id=None):
        total = float(row[6])
        # Предоплата — только для сборок ПК. Заказ комплектующих оплачивается
        # целиком при выдаче, поэтому «аванса по умолчанию» у него нет.
        is_build = row[4] == "pc_build"
        default_pct = 30.0 if is_build else 0.0
        pct = float(row[13]) if len(row) > 13 and row[13] is not None else default_pct
        if not is_build and (len(row) <= 15 or not row[15]):
            # Предоплату не вносили — считать её процентом от суммы нельзя.
            pct = 0.0
        if len(row) > 14 and row[14] is not None:
            prepay = float(row[14])
        else:
            prepay = round(total * pct / 100, 2)
        if not is_build and (len(row) <= 15 or not row[15]):
            prepay = 0.0
        # Фолбэк номера: учитываем тип заказа (сборка → PC, партия → PB, иначе HW),
        # чтобы заказы без сохранённого display_number не превращались в HW.
        _prefix = "PC" if row[4] == "pc_build" else ("PB" if row[4] == "pc_batch" else "HW")
        return {
            "id": row[0], "display_number": disp or (_prefix + str(row[0]).zfill(5)),
            "customer_name": row[1], "customer_phone": row[2],
            "customer_email": row[3], "order_type": row[4], "items": row[5],
            "total": total, "comment": row[7], "status": row[8],
            "created_at": row[9].isoformat() if row[9] else None,
            "updated_at": row[10].isoformat() if row[10] else None,
            "user_id": row[11],
            "wip_stage": row[12] if len(row) > 12 else None,
            "prepayment_percent": pct,
            "prepayment_amount": prepay,
            "remaining_amount": round(total - prepay, 2),
            "prepayment_confirmed": bool(row[15]) if len(row) > 15 and row[15] is not None else False,
            "remaining_paid": bool(row[16]) if len(row) > 16 and row[16] is not None else False,
            "remaining_paid_amount": float(row[17]) if len(row) > 17 and row[17] is not None else 0,
            "for_sale": bool(for_sale) if for_sale is not None else False,
            "is_stock_sale": bool(is_stock_sale) if is_stock_sale is not None else False,
            "quiz_request_id": quiz_request_id,
        }

    try:
        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            user_id = get_user_by_session(cur, session_id)
            quiz_request_id = body.get("quiz_request_id")  # привязка к заявке (опц.)

            # ─── МАССОВАЯ СБОРКА: создание пустого заказа-партии ───
            # Группы-варианты добавляются потом через batch_add_group.
            if body.get("order_type") == "pc_batch":
                SCHEMA = "t_p72635010_quantum_fusion_resea"
                name = (body.get("customer_name") or "").strip() or "Партия"
                phone = (body.get("customer_phone") or "").strip()
                cur.execute(
                    f"INSERT INTO {SCHEMA}.orders "
                    f"(customer_name, customer_phone, customer_email, order_type, items, total, "
                    f"comment, status, created_at, updated_at, user_id) "
                    f"VALUES (%s, %s, %s, 'pc_batch', '[]'::jsonb, 0, %s, 'new', NOW(), NOW(), %s) "
                    f"RETURNING id",
                    (name[:255], phone[:50], (body.get("customer_email") or "")[:255] or None,
                     body.get("comment"), user_id))
                new_id = cur.fetchone()[0]
                disp = "PB" + str(new_id).zfill(5)
                cur.execute(f"UPDATE {SCHEMA}.orders SET display_number=%s WHERE id=%s",
                            (disp, new_id))
                conn.commit()
                return {"statusCode": 200, "headers": cors,
                        "body": json.dumps({"ok": True, "id": new_id, "display_number": disp})}

            # ─── Промокод: серверная валидация и расчёт скидки ───
            # Итоговая сумма total уменьшается на скидку. Значения из тела
            # запроса НЕ доверяем — считаем заново по актуальному промокоду.
            SCHEMA = "t_p72635010_quantum_fusion_resea"
            promo_code = None
            promo_id = None
            discount_amount = 0.0
            _raw_total = float(body.get("total") or 0)
            _promo_input = (body.get("promo_code") or "").strip()
            if _promo_input:
                try:
                    from promo_logic import validate_and_calc
                    _pr = validate_and_calc(
                        cur, SCHEMA, _promo_input, body.get("items") or [], _raw_total,
                        user_id=user_id, customer_phone=body.get("customer_phone"),
                    )
                    if _pr.get("ok"):
                        promo_code = _pr["promo"]["code"]
                        promo_id = _pr["promo"]["id"]
                        discount_amount = float(_pr.get("discount") or 0)
                except Exception:
                    pass
            final_total = max(round(_raw_total - discount_amount, 2), 0)
            body["total"] = final_total  # дальнейшая логика (уведомления и пр.) видит итог со скидкой

            # Источник клиента: явный source_id или авто-подбор по utm_source.
            utm_source = (body.get("utm_source") or "").strip() or None
            utm_medium = (body.get("utm_medium") or "").strip() or None
            utm_campaign = (body.get("utm_campaign") or "").strip() or None
            source_id = body.get("source_id")
            if not source_id and utm_source:
                cur.execute(
                    "SELECT id FROM marketing_sources "
                    "WHERE is_active = TRUE AND LOWER(utm_source) = LOWER(%s) "
                    "ORDER BY sort_order LIMIT 1",
                    (utm_source,)
                )
                _m = cur.fetchone()
                if _m:
                    source_id = _m[0]

            cur.execute(
                """INSERT INTO orders (customer_name, customer_phone, customer_email, order_type,
                   items, total, comment, status, user_id, quiz_request_id,
                   source_id, utm_source, utm_medium, utm_campaign,
                   promo_code, discount_amount, promo_id, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 'new', %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()) RETURNING id""",
                (body["customer_name"], body["customer_phone"],
                 body.get("customer_email"), body.get("order_type", "cart"),
                 json.dumps(body["items"]), body["total"],
                 body.get("comment"), user_id, quiz_request_id,
                 source_id, utm_source, utm_medium, utm_campaign,
                 promo_code, discount_amount, promo_id)
            )
            order_id = cur.fetchone()[0]

            # Учёт использования промокода
            if promo_id:
                cur.execute(
                    f"UPDATE {SCHEMA}.promos SET used_count = used_count + 1 WHERE id = %s",
                    (promo_id,),
                )

            # Если заказ создан из заявки — помечаем заявку обработанной
            if quiz_request_id:
                cur.execute(
                    "UPDATE quiz_requests SET status='done' WHERE id=%s AND status <> 'done'",
                    (quiz_request_id,)
                )

            # Сквозная нумерация: номер = внутренний id. Префикс PC — сборки,
            # HW — заказы железа (RMA-замены нумеруются в rma).
            prefix = "PC" if body.get("order_type") == "pc_build" else "HW"
            display_number = prefix + str(order_id).zfill(5)
            cur.execute("UPDATE orders SET display_number=%s WHERE id=%s", (display_number, order_id))

            # Общее уведомление — только для НЕ-сборок (железо/корзина).
            # Для pc_build уведомления шлёт спец-логика ниже (наличие/новая/дубль),
            # иначе пришло бы два сообщения на один заказ.
            try:
              if body.get("order_type") != "pc_build":
                from tg_notify import notify_managers
                _ord_total = float(body.get("total") or 0)
                _ord_type_label = {"pc_build": "Сборка ПК", "parts": "Железо", "cart": "Корзина"}.get(
                    body.get("order_type", "cart"), body.get("order_type", "cart"))
                # Контакт хранится в customer_email как "tg:<значение>" / "vk:<url>" / "max:..."
                _contact_line = ""
                _raw_contact = (body.get("customer_email") or "").strip()
                if ":" in _raw_contact:
                    _ctype, _cval = _raw_contact.split(":", 1)
                    _ctype, _cval = _ctype.strip().lower(), _cval.strip()
                    if _ctype == "tg" and _cval:
                        if _cval.startswith("http"):
                            _uname = _cval.rstrip("/").split("/")[-1].lstrip("@")
                            _url = _cval
                        else:
                            _uname = _cval.lstrip("@")
                            _url = f"https://t.me/{_uname}"
                        _contact_line = f"\nTelegram: <a href=\"{_url}\">@{_uname}</a>"
                    elif _ctype == "vk" and _cval:
                        _contact_line = f"\nВКонтакте: {_cval}"
                    elif _cval:
                        _contact_line = f"\nКонтакт: {_cval}"
                _amount = f"{_ord_total:,.0f}".replace(",", " ")
                _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
                _link_line = ""
                if _base:
                    if body.get("order_type") == "pc_build":
                        _link_line = f"\n🔗 <a href=\"{_base}/admin/wip_builds\">Открыть в сборках</a>"
                    else:
                        _link_line = f"\n🔗 <a href=\"{_base}/admin/order/{order_id}\">Открыть заказ</a>"
                notify_managers(
                    f"🛒 <b>Новый заказ {display_number}</b>\n"
                    f"Тип: {_ord_type_label}\n"
                    f"Клиент: {body.get('customer_name','—')}\n"
                    f"Телефон: {body.get('customer_phone','—')}"
                    f"{_contact_line}\n"
                    f"Сумма: {_amount} ₽"
                    f"{_link_line}", event_key="order_new")
            except Exception as _e:
                print(f"TG_NOTIFY order: {_e}")

            order_type = body.get("order_type", "cart")
            items = body.get("items") or []
            parts_total = float(body["total"])
            customer = body["customer_name"]

            print(f"ORDER {order_id}: type={order_type}, items={json.dumps(items)}")

            # ── РЕЗЕРВ ────────────────────────────────────────────────────────
            # Заказ комплектующих оплачивается ЦЕЛИКОМ при выдаче, предоплаты
            # нет — поэтому товар резервируем сразу, иначе его успеют продать.
            # pc_build: резерв создаётся при смене этапа wip_builds на "Заказ".
            if order_type == "parts":
                try:
                    import warehouse_core as wc
                    wc.reserve_parts_order(cur, order_id)
                    conn.commit()
                except Exception as _re:
                    print(f"ORDER {order_id} reserve: {_re}")

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
                    item_qty = int(it.get("quantity", 1))
                    # Конфигуратор передаёт components прямо в item
                    if it.get("components"):
                        for comp in it["components"]:
                            c = dict(comp)
                            c["qty"] = int(c.get("qty", 1)) * item_qty
                            result.append(c)
                    elif it.get("item_type") == "config" and is_catalog_id(it.get("id")):
                        # Готовая сборка из каталога — берём компоненты из БД
                        cur.execute("SELECT components, assembly_type, assembly_fee FROM pc_builds WHERE id = %s", (it["id"],))
                        row = cur.fetchone()
                        if row and row[0]:
                            for comp in row[0]:
                                c = dict(comp)
                                c["qty"] = int(c.get("qty", 1)) * item_qty
                                result.append(c)
                            asm_type = row[1] or asm_type
                            asm_fee_val = float(row[2] or asm_fee_val)
                        else:
                            result.append({"name": it.get("name", ""), "slot": "other",
                                           "price": it.get("price", 0), "source": "order", "qty": item_qty})
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
                # ── ПРОДАЖА ИЗ НАЛИЧИЯ (модель «вечный заказ-затычка») ──────────
                # У сборки свободной продажи (for_sale=TRUE) есть ПОСТОЯННЫЙ заказ.
                # Покупка через сайт НЕ создаёт новый заказ, а вписывает данные
                # клиента в существующий заказ-затычку. Сборка остаётся in_stock
                # (баннер на витрине переключится «В наличии» → «В резерве»
                # автоматически, т.к. в затычке появились данные клиента).
                stock_build_ids = [
                    int(it["id"]) for it in items
                    if it.get("item_type") == "config" and it.get("id")
                ]
                stock_wip = None
                if stock_build_ids:
                    cur.execute(
                        "SELECT wb.id, wb.build_id, wb.order_id FROM wip_builds wb "
                        "WHERE wb.build_id = ANY(%s) AND wb.for_sale = TRUE "
                        "AND wb.order_id IS NOT NULL "
                        "AND wb.stage NOT IN ('Архив','Отменён') "
                        "ORDER BY wb.id ASC LIMIT 1",
                        (stock_build_ids,)
                    )
                    stock_wip = cur.fetchone()

                if stock_wip:
                    # Вписываем данные клиента в СУЩЕСТВУЮЩИЙ заказ-затычку,
                    # а лишний только что созданный заказ удаляем.
                    wip_id_stock, build_id_stock, stub_order_id = stock_wip[0], stock_wip[1], stock_wip[2]
                    cur.execute("DELETE FROM orders WHERE id=%s", (order_id,))
                    # Обновляем заказ-затычку реальными данными клиента
                    cur.execute(
                        "UPDATE orders SET customer_name=%s, customer_phone=%s, customer_email=%s, "
                        "comment=%s, status='waiting_assembly', updated_at=NOW() WHERE id=%s",
                        (body["customer_name"], body["customer_phone"], body.get("customer_email"),
                         body.get("comment"), stub_order_id)
                    )
                    # Контакт для карточки WIP
                    _contact = (body.get("customer_name") or "").strip()
                    _phone = (body.get("customer_phone") or "").strip()
                    if _phone:
                        _contact = f"{_contact} · {_phone}" if _contact else _phone
                    _extra_contact = (body.get("customer_email") or "").strip()
                    if _extra_contact:
                        _contact = f"{_contact} · {_extra_contact}" if _contact else _extra_contact
                    cur.execute(
                        "UPDATE wip_builds SET contact=%s, updated_at=NOW() WHERE id=%s",
                        (_contact[:128], wip_id_stock)
                    )
                    # in_stock НЕ снимаем — сборка остаётся, баннер станет «В резерве».
                    cur.execute("SELECT display_number FROM orders WHERE id=%s", (stub_order_id,))
                    _dn_row = cur.fetchone()
                    _stub_dn = _dn_row[0] if _dn_row else display_number
                    try:
                        from tg_notify import notify_managers as _notify
                        _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
                        _link = f"\n🔗 <a href=\"{_base}/admin/order/{stub_order_id}\">Открыть заказ</a>" if _base else ""
                        _notify(
                            f"🛒 <b>Покупка ПК из наличия ({_stub_dn})</b>\n"
                            f"Тип: ПК\n"
                            f"Клиент: {body.get('customer_name','—')}\n"
                            f"Телефон: {body.get('customer_phone','—')}"
                            f"{_link}", event_key="order_new")
                    except Exception as _e:
                        print(f"TG_NOTIFY stock-sale: {_e}")
                    conn.commit()
                    return {"statusCode": 201, "headers": cors,
                            "body": json.dumps({"id": stub_order_id, "ok": True, "from_stock": True})}

                # Определяем, не была ли это ГОТОВАЯ сборка из каталога, которую
                # уже продали (есть wip с этим build_id). Тогда создаём копию, но
                # предупреждаем менеджера: эту сборку надо собрать заново.
                _was_sold_copy = False
                if stock_build_ids:
                    cur.execute(
                        "SELECT 1 FROM wip_builds WHERE build_id = ANY(%s) LIMIT 1",
                        (stock_build_ids,)
                    )
                    if cur.fetchone():
                        _was_sold_copy = True

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

                # Уведомление в Telegram о новом заказе-сборке (всегда).
                try:
                    from tg_notify import notify_managers as _notify
                    _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
                    _link = f"\n🔗 <a href=\"{_base}/admin/wip_builds\">Открыть в сборках</a>" if _base else ""
                    _amt = f"{parts_total:,.0f}".replace(",", " ")
                    if _was_sold_copy:
                        _notify(
                            f"⚠️ <b>Дубликат сборки {display_number}</b>\n"
                            f"Готовая сборка уже продана/занята — создана КОПИЯ под заказ, "
                            f"её нужно собрать заново.\n"
                            f"Клиент: {customer}\n"
                            f"Телефон: {body.get('customer_phone','—')}\n"
                            f"Сумма: {_amt} ₽"
                            f"{_link}", event_key="order_new")
                    else:
                        _notify(
                            f"🖥 <b>Новый заказ-сборка {display_number}</b>\n"
                            f"Сборку нужно собрать.\n"
                            f"Клиент: {customer}\n"
                            f"Телефон: {body.get('customer_phone','—')}\n"
                            f"Сумма: {_amt} ₽"
                            f"{_link}"
                        )
                except Exception as _e:
                    print(f"TG_NOTIFY new-build: {_e}")

            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": order_id, "ok": True})}

        elif method == "GET":
            # Аналитика по заявкам (квиз): конверсия в заказы, источники, средний чек и срок.
            # Вызов: GET ?action=quiz_analytics
            if params.get("action") == "quiz_analytics":
                # Всего заявок и по источникам
                cur.execute("SELECT COALESCE(source,'quiz') AS src, COUNT(*) FROM quiz_requests GROUP BY src")
                by_source = [{"source": r[0], "count": int(r[1])} for r in cur.fetchall()]
                cur.execute("SELECT COUNT(*) FROM quiz_requests")
                total_leads = int(cur.fetchone()[0] or 0)

                # Заявки, ставшие заказами (есть связанный заказ)
                cur.execute("SELECT COUNT(DISTINCT quiz_request_id) FROM orders WHERE quiz_request_id IS NOT NULL")
                converted = int(cur.fetchone()[0] or 0)

                # Сумма и средний чек заказов из заявок
                cur.execute("SELECT COALESCE(SUM(total),0), COALESCE(AVG(total),0), COUNT(*) FROM orders WHERE quiz_request_id IS NOT NULL")
                rev_row = cur.fetchone()
                revenue = float(rev_row[0] or 0)
                avg_check = float(rev_row[1] or 0)
                orders_from_leads = int(rev_row[2] or 0)

                # Средний срок от заявки до заказа (в часах)
                cur.execute(
                    "SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (o.created_at - q.created_at))/3600.0), 0) "
                    "FROM orders o JOIN quiz_requests q ON q.id = o.quiz_request_id"
                )
                avg_hours = float(cur.fetchone()[0] or 0)

                conversion = round(converted / total_leads * 100, 1) if total_leads else 0.0
                return {"statusCode": 200, "headers": cors, "body": json.dumps({
                    "total_leads": total_leads,
                    "converted_leads": converted,
                    "conversion_percent": conversion,
                    "orders_from_leads": orders_from_leads,
                    "revenue": revenue,
                    "avg_check": round(avg_check, 2),
                    "avg_hours_to_order": round(avg_hours, 1),
                    "by_source": by_source,
                })}

            # Тестовая отправка уведомления «Покупка ПК из наличия» по заказу
            # (ничего не меняет в БД). Вызов: GET ?action=test_stock_notify&id=N
            if params.get("action") == "test_stock_notify" and params.get("id"):
                cur.execute(
                    "SELECT display_number, customer_name, customer_phone, id FROM orders WHERE id=%s",
                    (int(params["id"]),)
                )
                r = cur.fetchone()
                if not r:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
                _dn, _cn, _cp, _oid = r
                from tg_notify import notify_managers as _notify
                _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
                _link = f"\n🔗 <a href=\"{_base}/admin/order/{_oid}\">Открыть заказ</a>" if _base else ""
                ok = _notify(
                    f"🛒 <b>Покупка ПК из наличия ({_dn})</b>\n"
                    f"Тип: ПК\n"
                    f"Клиент: {_cn or '—'}\n"
                    f"Телефон: {_cp or '—'}"
                    f"{_link}", event_key="order_new")
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "sent": bool(ok)})}

            # Один заказ по id
            if params.get("id"):
                cur.execute(
                    """SELECT id, customer_name, customer_phone, customer_email, order_type,
                              items, total, comment, status, created_at, updated_at, user_id,
                              NULL, prepayment_percent, prepayment_amount,
                              prepayment_confirmed, remaining_paid, remaining_paid_amount,
                              display_number, quiz_request_id
                       FROM orders WHERE id = %s""",
                    (int(params["id"]),)
                )
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
                order = fmt_order(row, row[18], quiz_request_id=row[19])
                schema = "t_p72635010_quantum_fusion_resea"

                # Источник клиента (канал привлечения)
                cur.execute(
                    f"SELECT o.source_id, s.name, o.utm_source, o.utm_medium, o.utm_campaign "
                    f"FROM {schema}.orders o "
                    f"LEFT JOIN {schema}.marketing_sources s ON s.id = o.source_id "
                    f"WHERE o.id = %s",
                    (int(params["id"]),)
                )
                _src = cur.fetchone()
                if _src:
                    order["source_id"] = _src[0]
                    order["source_name"] = _src[1]
                    order["utm_source"] = _src[2]
                    order["utm_medium"] = _src[3]
                    order["utm_campaign"] = _src[4]

                # Признак «сборка из свободной продажи» (привязанный pc_build.status='catalog')
                cur.execute(
                    f"SELECT (pb.status = 'catalog') FROM {schema}.wip_builds wb "
                    f"JOIN {schema}.pc_builds pb ON pb.id = wb.build_id "
                    f"WHERE wb.order_id = %s LIMIT 1",
                    (int(params["id"]),)
                )
                _iss = cur.fetchone()
                order["is_stock_sale"] = bool(_iss[0]) if _iss and _iss[0] is not None else False

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

                    raw_items = order.get("items") or []
                    # «Старый» формат: все строки config/pc_build ИЛИ нет ни одной
                    # product-строки со slot. «Новый» формат: есть product-строки со slot.
                    has_product_slot = any(
                        it.get("item_type") == "product" and it.get("slot")
                        for it in raw_items
                    )
                    is_old_format = (not has_product_slot)

                    build_qty = 1
                    for oi in raw_items:
                        if oi.get("item_type") in ("config", "pc_build"):
                            build_qty = int(oi.get("quantity", 1))
                            break

                    build_id = wip[20] if wip else None

                    if is_old_format:
                        # АВТО-МИГРАЦИЯ: строим снимок и сохраняем его в orders.items
                        snapshot = build_pc_snapshot(
                            cur, schema, int(params["id"]), raw_items, build_id, wip, build_qty
                        )
                        snap_total = sum(
                            (it.get("final_price") if it.get("final_price") is not None
                             else it.get("price", 0))
                            * it.get("quantity", 1)
                            for it in snapshot
                            if it.get("item_status") != "returned"
                        )
                        cur.execute(
                            "UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(snapshot), snap_total, int(params["id"]))
                        )
                        conn.commit()
                        order["items"] = snapshot
                        order["total"] = snap_total
                    # else: новый формат — используем order["items"] как есть

                    # Статусы слотов из wip_builds (для подсветки в карточке заказа)
                    wip_status_by_slot = {}
                    if wip:
                        _slot_names = ["cpu", "motherboard", "ram", "gpu", "storage",
                                       "psu", "case_name", "cooling", "extra"]
                        for _i, _sn in enumerate(_slot_names):
                            wip_status_by_slot[_sn] = wip[11 + _i] or "pending"

                    # Обогащение складом по каждой product-строке снимка (по item["id"])
                    final_items = order.get("items") or []
                    for item in final_items:
                        if item.get("item_type") != "product":
                            item.setdefault("_supplies", [])
                            if item.get("item_type") == "assembly" and not item.get("slot_label"):
                                item["slot_label"] = "Услуга"
                            continue
                        # Статус сборки слота (case → case_name, нестандартные → extra)
                        _slot = item.get("slot")
                        _wkey = "case_name" if _slot == "case" else _slot
                        item["wip_status"] = (wip_status_by_slot.get(_wkey)
                                              or wip_status_by_slot.get("extra")
                                              or "pending")
                        product_id = item.get("id")
                        # Кол-во модулей ОЗУ (для отдельных полей серийников на планку)
                        if _slot == "ram" and product_id:
                            cur.execute(
                                f"SELECT ram_modules FROM {schema}.product_specs "
                                f"WHERE product_id = %s LIMIT 1",
                                (int(product_id),)
                            )
                            rm = cur.fetchone()
                            if rm and rm[0]:
                                item["ram_modules"] = int(rm[0])
                        supplies = []
                        if product_id:
                            cur.execute(
                                f"SELECT s.id, s.qty, s.qty_reserved, s.qty_negative, wg.warranty_months, wg.id "
                                f"FROM {schema}.warehouse_supplies s "
                                f"JOIN {schema}.warehouse_groups wg ON wg.id = s.group_id "
                                f"WHERE wg.product_id = %s ORDER BY s.id ASC",
                                (int(product_id),)
                            )
                            supplies = [{"id": r[0], "qty": r[1], "qty_reserved": r[2],
                                         "free": r[1], "qty_negative": r[3],
                                         "warranty_months": r[4], "group_id": r[5]}
                                        for r in cur.fetchall()]
                            if supplies:
                                cur.execute(
                                    f"SELECT COALESCE(SUM(m.qty_delta), 0) FROM {schema}.warehouse_movements m "
                                    f"JOIN {schema}.warehouse_groups wg ON wg.id = m.group_id "
                                    f"WHERE wg.product_id = %s AND m.order_id = %s "
                                    f"AND m.type IN ('reserved','unreserved')",
                                    (int(product_id), int(params["id"]))
                                )
                                r_qty = cur.fetchone()
                                reserved_for_order = int(r_qty[0]) if r_qty and r_qty[0] else 0
                                for s in supplies:
                                    s["reserved_for_order"] = reserved_for_order
                        item["_supplies"] = supplies

                    # total пересчитываем из итоговых items (исключая returned)
                    order["total"] = sum(
                        (it.get("final_price") if it.get("final_price") is not None
                         else it.get("price", 0))
                        * it.get("quantity", 1)
                        for it in final_items
                        if it.get("item_status") != "returned"
                    )
                    order["_wip_stage"] = wip[1] if wip else None
                    order["_build_qty"] = build_qty
                    return {"statusCode": 200, "headers": cors, "body": json.dumps({"order": order})}

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
                              items, total, comment, status, created_at, updated_at, user_id,
                              display_number
                       FROM orders WHERE user_id = %s ORDER BY created_at DESC""",
                    (user_id,)
                )
                orders = [fmt_order(r, r[12]) for r in cur.fetchall()]
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"orders": orders})}

            # Все заказы (для админа)
            status_filter = params.get("status")
            where = "WHERE o.status = %s" if status_filter else ""
            args = [status_filter] if status_filter else []
            cur.execute(
                f"""SELECT o.id, o.customer_name, o.customer_phone, o.customer_email, o.order_type,
                           o.items, o.total, o.comment, o.status, o.created_at, o.updated_at, o.user_id,
                           wb.stage as wip_stage, o.prepayment_percent, o.prepayment_amount,
                           o.prepayment_confirmed, o.remaining_paid, o.remaining_paid_amount,
                           o.display_number, wb.for_sale,
                           (pb.status = 'catalog') AS is_stock_sale, o.quiz_request_id
                    FROM orders o
                    LEFT JOIN LATERAL (
                        SELECT stage, for_sale, build_id FROM wip_builds
                        WHERE order_id = o.id ORDER BY id LIMIT 1
                    ) wb ON TRUE
                    LEFT JOIN pc_builds pb ON pb.id = wb.build_id
                    {where} ORDER BY o.created_at DESC LIMIT 200""",
                args
            )
            orders = [fmt_order(r, r[18], r[19], r[20], r[21]) for r in cur.fetchall()]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"orders": orders})}

        elif method == "PUT":
            # Обновление позиций заказа: серийник, цена, статус, замена товара, резерв
            body = json.loads(event.get("body") or "{}")
            order_id = int(body["id"])
            action = body.get("action")
            schema = "t_p72635010_quantum_fusion_resea"

            # ─── МАССОВАЯ СБОРКА (партия): все действия с префиксом batch_ ───
            # Группы-варианты, отдельные ПК (серийники/выдача), пересчёт резервов.
            # Не трогает одиночные заказы.
            if action and str(action).startswith("batch_"):
                import batch_builds as bb
                cur.execute("SELECT display_number FROM orders WHERE id=%s", (order_id,))
                _r = cur.fetchone()
                if not _r:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
                order_number = _r[0] or f"PC{str(order_id).zfill(5)}"

                if action == "batch_list":
                    groups = bb.list_groups(cur, order_id)
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True, "groups": groups})}
                if action == "batch_add_group":
                    gid = bb.add_group(cur, order_id, order_number,
                                       body.get("label"), body.get("qty", 1),
                                       body.get("components") or [],
                                       wants_assembly=body.get("wants_assembly", False),
                                       assembly_type=body.get("assembly_type", "percent"),
                                       assembly_fee_manual=body.get("assembly_fee_manual"))
                    conn.commit()
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True, "group_id": gid,
                                                "groups": bb.list_groups(cur, order_id)})}
                if action == "batch_update_group":
                    bb.update_group(cur, order_id, order_number, int(body["group_id"]),
                                    label=body.get("label"), qty=body.get("qty"),
                                    components=body.get("components"),
                                    wants_assembly=body.get("wants_assembly"),
                                    assembly_type=body.get("assembly_type"),
                                    assembly_fee_manual=body.get("assembly_fee_manual"))
                    conn.commit()
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True,
                                                "groups": bb.list_groups(cur, order_id)})}
                if action == "batch_remove_group":
                    bb.remove_group(cur, order_id, int(body["group_id"]))
                    conn.commit()
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True,
                                                "groups": bb.list_groups(cur, order_id)})}
                if action == "batch_update_unit":
                    bb.update_unit(cur, order_id, int(body["unit_id"]),
                                   serial_number=body.get("serial_number"),
                                   status=body.get("status"),
                                   warranty_until=body.get("warranty_until"),
                                   issued_at=body.get("issued_at"),
                                   comment=body.get("comment"),
                                   comp_serials=body.get("comp_serials"),
                                   comp_slot=body.get("comp_slot"),
                                   comp_serial=body.get("comp_serial"))
                    conn.commit()
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True,
                                                "groups": bb.list_groups(cur, order_id)})}
                if action == "batch_sync":
                    import warehouse_core as wc
                    result = bb.sync_batch(cur, wc, order_id)
                    conn.commit()
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True, **result,
                                                "groups": bb.list_groups(cur, order_id)})}
                if action == "batch_writeoff":
                    # Выдача всей партии. Перед выдачей остаток должен быть оплачен.
                    cur.execute("SELECT remaining_paid, status FROM orders WHERE id=%s", (order_id,))
                    wp = cur.fetchone()
                    if wp and wp[1] != "done" and not bool(wp[0]):
                        return {"statusCode": 400, "headers": cors, "body": json.dumps(
                            {"error": "remaining_unpaid",
                             "message": "Перед выдачей нужно принять оплату остатка по заказу."})}
                    result = bb.writeoff_batch(cur, order_id)
                    conn.commit()
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True, **result,
                                                "groups": bb.list_groups(cur, order_id)})}
                if action == "batch_warranty":
                    data = bb.warranty_data(cur, order_id)
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True, "warranty": data})}
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": f"Unknown batch action: {action}"})}

            cur.execute("SELECT items, total FROM orders WHERE id = %s", (order_id,))
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
            items = row[0] if isinstance(row[0], list) else json.loads(row[0])

            item_idx = body.get("item_idx")  # индекс позиции в items

            if action == "link_quiz":
                # Ручная привязка заявки к существующему заказу
                qid = body.get("quiz_request_id")
                cur.execute("UPDATE orders SET quiz_request_id=%s, updated_at=NOW() WHERE id=%s", (qid, order_id))
                if qid:
                    cur.execute("UPDATE quiz_requests SET status='done' WHERE id=%s AND status='new'", (qid,))
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "quiz_request_id": qid})}

            if action == "unlink_quiz":
                # Отвязать заявку от заказа
                cur.execute("UPDATE orders SET quiz_request_id=NULL, updated_at=NOW() WHERE id=%s", (order_id,))
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

            if action == "set_customer":
                # Редактирование данных клиента: имя и телефон
                name = (body.get("customer_name") or "").strip()
                phone = (body.get("customer_phone") or "").strip()
                if not name or not phone:
                    return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Имя и телефон обязательны"})}
                cur.execute(
                    "UPDATE orders SET customer_name=%s, customer_phone=%s, updated_at=NOW() WHERE id=%s",
                    (name[:255], phone[:50], order_id),
                )
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "customer_name": name, "customer_phone": phone})}

            if action == "set_source":
                # Источник клиента (канал привлечения) — выбор из справочника
                src = body.get("source_id")
                src = int(src) if src not in (None, "", 0, "0") else None
                cur.execute(
                    "UPDATE orders SET source_id=%s, updated_at=NOW() WHERE id=%s",
                    (src, order_id),
                )
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "source_id": src})}

            if action == "set_prepayment":
                # Предоплата: по проценту или по сумме (второе пересчитывается)
                total = float(row[1]) if row[1] else 0
                if body.get("prepayment_amount") is not None:
                    amount = max(0, min(total, float(body.get("prepayment_amount") or 0)))
                    pct = round(amount / total * 100, 2) if total else 0
                else:
                    pct = max(0, min(100, float(body.get("prepayment_percent") or 0)))
                    amount = round(total * pct / 100, 2)
                cur.execute(
                    "UPDATE orders SET prepayment_percent=%s, prepayment_amount=%s, updated_at=NOW() WHERE id=%s",
                    (pct, amount, order_id),
                )
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({
                    "ok": True, "prepayment_percent": pct, "prepayment_amount": amount,
                    "remaining_amount": round(total - amount, 2),
                })}

            if action == "set_build_qty":
                # Изменить кол-во ПК: обновить quantity в items и пересчитать компоненты pc_builds
                new_build_qty = int(body.get("build_qty", 1))
                if new_build_qty < 1:
                    return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Кол-во должно быть >= 1"})}
                # Обновляем quantity в items (первый config-айтем)
                for it in items:
                    if it.get("item_type") in ("config", "pc_build"):
                        it["quantity"] = new_build_qty
                        break
                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))
                # Пересчитываем компоненты в pc_builds (умножаем qty каждого на новое build_qty)
                cur.execute(
                    f"SELECT pb.id, pb.components FROM {schema}.pc_builds pb "
                    f"JOIN {schema}.wip_builds wb ON wb.build_id = pb.id "
                    f"WHERE wb.order_id = %s LIMIT 1",
                    (order_id,)
                )
                pb_row = cur.fetchone()
                if pb_row:
                    pb_id = pb_row[0]
                    pb_comps = pb_row[1] if isinstance(pb_row[1], list) else json.loads(pb_row[1])
                    # Определяем базовый qty (qty / старое build_qty)
                    # Берём старый build_qty из первого item
                    old_qty = 1
                    for it in items:
                        if it.get("item_type") in ("config", "pc_build"):
                            # quantity уже обновлён, берём из компонентов
                            if pb_comps:
                                old_qty = int(pb_comps[0].get("qty", 1))
                            break
                    # Пересчитываем: новый qty = round(старый / старый_build_qty * новый)
                    # Проще: base = qty / old_build_qty (до обновления items)
                    # Но мы уже обновили items, восстановим из компонентов
                    # base = comp["qty"] / old_item_qty — не знаем старый
                    # Надёжнее: смотрим что в компоненте qty содержит уже итог
                    # Делим на первое попавшееся qty (если все равны), умножаем на новое
                    if pb_comps and len(pb_comps) > 0:
                        sample_qty = int(pb_comps[0].get("qty", 1))
                        # base qty per component = sample_qty / (sample_qty // new_build_qty if sample_qty >= new_build_qty else 1)
                        # Ищем старый build_qty через НОД
                        import math
                        all_qtys = [int(c.get("qty", 1)) for c in pb_comps]
                        old_build_qty = all_qtys[0]
                        for q in all_qtys[1:]:
                            old_build_qty = math.gcd(old_build_qty, q)
                        if old_build_qty < 1:
                            old_build_qty = 1
                        new_comps = []
                        for comp in pb_comps:
                            c = dict(comp)
                            base = int(c.get("qty", 1)) // old_build_qty
                            c["qty"] = base * new_build_qty
                            new_comps.append(c)
                        # Пересчитываем итоги pc_builds
                        parts_total_new = sum(float(c.get("price", 0)) * int(c.get("qty", 1)) for c in new_comps)
                        asm_type_row = cur.execute(f"SELECT assembly_type, assembly_fee FROM {schema}.pc_builds WHERE id = %s", (pb_id,)) or None
                        cur.execute(f"SELECT assembly_type, assembly_fee FROM {schema}.pc_builds WHERE id = %s", (pb_id,))
                        asm_row = cur.fetchone()
                        asm_fee = float(asm_row[1]) if asm_row and asm_row[1] else 0
                        if asm_row and asm_row[0] == "percent":
                            asm_fee = round(parts_total_new * 0.07)
                        cur.execute(
                            f"UPDATE {schema}.pc_builds SET components=%s, parts_total=%s, assembly_fee=%s, total_price=%s WHERE id=%s",
                            (json.dumps(new_comps), parts_total_new, asm_fee, parts_total_new + asm_fee, pb_id)
                        )
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

            elif action == "set_serial":
                # Для ПК-заказов серийники теперь пишем в нужную строку orders.items
                # (product-строку по slot) в поле serial_numbers. Для обратной
                # совместимости чтения дублируем в items[0].slot_serials[slot].
                cur.execute("SELECT order_type FROM orders WHERE id=%s", (order_id,))
                ot = cur.fetchone()
                slot = body.get("slot")
                serials = body.get("serial_numbers")
                if serials is None:
                    serials = [body.get("serial_number", "")]
                if ot and ot[0] == "pc_build" and slot:
                    if not items:
                        items = [{}]
                    # Записываем в строку снимка по slot (product или assembly)
                    matched = False
                    for it in items:
                        if it.get("slot") == slot:
                            it["serial_numbers"] = serials
                            matched = True
                    # Обратная совместимость: дублируем в slot_serials первого item
                    if "slot_serials" not in items[0]:
                        items[0]["slot_serials"] = {}
                    items[0]["slot_serials"][slot] = serials
                else:
                    if "serial_numbers" in body:
                        items[item_idx]["serial_numbers"] = body["serial_numbers"]
                    else:
                        items[item_idx]["serial_number"] = body.get("serial_number", "")
                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))

            elif action == "set_price":
                new_price = float(body["price"])
                slot = body.get("slot")
                # Узнаём тип заказа и сборку (для ПК-сборок)
                cur.execute(
                    "SELECT pb.sell_with_vat, pb.id, COALESCE(pb.lock_prices, FALSE) FROM pc_builds pb "
                    "JOIN wip_builds wb ON wb.build_id = pb.id "
                    "WHERE wb.order_id = %s LIMIT 1",
                    (order_id,),
                )
                vat_row = cur.fetchone()
                is_vat = bool(vat_row[0]) if vat_row else False
                build_id = vat_row[1] if vat_row else None
                lock_prices = bool(vat_row[2]) if vat_row else False

                if build_id and slot:
                    # ПК-сборка: orders.items — источник истины (снимок). Пишем
                    # final_price СТРОГО в позицию по item_idx (важно: в сборке
                    # может быть несколько позиций с одним slot — напр. корпус и
                    # доп. дисплей в slot='case'; поиск по slot затронул бы обе).
                    # Фолбэк на первую позицию слота — только если индекс не передан.
                    target_idx = item_idx if (item_idx is not None and 0 <= item_idx < len(items)
                                              and items[item_idx].get("slot") == slot) else None
                    if target_idx is None:
                        target_idx = next((i for i, it in enumerate(items) if it.get("slot") == slot), None)
                    if target_idx is None:
                        return {"statusCode": 400, "headers": cors, "body": json.dumps({
                            "error": "item_not_found", "message": "Позиция не найдена"})}
                    target_item = items[target_idx]
                    cp = target_item.get("final_price")
                    if cp is None:
                        cp = target_item.get("price", 0)
                    cur_price = float(cp or 0)
                    if is_vat and new_price < cur_price:
                        return {"statusCode": 400, "headers": cors, "body": json.dumps({
                            "error": "vat_no_discount",
                            "message": "Товар с НДС: цену можно только повысить, скидка недоступна.",
                        })}
                    # 1) Пишем final_price ТОЛЬКО в целевую позицию
                    target_item["final_price"] = new_price
                    total = sum(
                        (it.get("final_price") if it.get("final_price") is not None
                         else it.get("price", 0)) * it.get("quantity", 1)
                        for it in items
                        if it.get("item_status") != "returned"
                    )
                    cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                                (json.dumps(items), total, order_id))
                    # 2) Зеркалим цену в конфиг сборки ТОЛЬКО при lock_prices=TRUE.
                    #    Если цены не зафиксированы — заказ живёт своей жизнью
                    #    (одностороннее изменение цены без фидбека в конфигуратор).
                    if lock_prices:
                        if slot == "assembly":
                            cur.execute(f"UPDATE {schema}.pc_builds SET assembly_fee=%s WHERE id=%s",
                                        (new_price, build_id))
                        else:
                            cur.execute(f"SELECT components FROM {schema}.pc_builds WHERE id=%s", (build_id,))
                            pc_row = cur.fetchone()
                            comps = []
                            if pc_row and pc_row[0]:
                                comps = pc_row[0] if isinstance(pc_row[0], list) else json.loads(pc_row[0])
                            # Ищем конкретный компонент по (slot, source_id), а не только по slot,
                            # чтобы не перепутать позиции с одинаковым слотом.
                            tid = target_item.get("id")
                            target = next((c for c in comps
                                           if c.get("slot") == slot and c.get("source_id") == tid), None)
                            if target is None:
                                target = next((c for c in comps if c.get("slot") == slot), None)
                            if target is not None:
                                target["price"] = new_price
                                cur.execute(f"UPDATE {schema}.pc_builds SET components=%s WHERE id=%s",
                                            (json.dumps(comps), build_id))
                else:
                    # Обычный заказ: цена позиции в orders.items[item_idx]
                    cur_price = items[item_idx].get("final_price")
                    if cur_price is None:
                        cur_price = items[item_idx].get("price", 0)
                    if is_vat and new_price < float(cur_price):
                        return {"statusCode": 400, "headers": cors, "body": json.dumps({
                            "error": "vat_no_discount",
                            "message": "Товар с НДС: цену можно только повысить, скидка недоступна.",
                        })}
                    items[item_idx]["final_price"] = new_price
                    total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1)
                                for it in items)
                    cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                                (json.dumps(items), total, order_id))

            elif action == "set_warranty":
                # ПК-заказ: гарантию пишем по slot.
                #   slot=="assembly" или нет slot → строка услуги сборки
                #     (warranty_months + items[0].assembly_warranty для совместимости);
                #   есть slot → соответствующая product-строка warranty_months.
                # Обычный заказ — items[item_idx].warranty_months.
                cur.execute("SELECT order_type FROM orders WHERE id=%s", (order_id,))
                ot = cur.fetchone()
                wm = int(body.get("warranty_months", 12))
                slot = body.get("slot")
                if ot and ot[0] == "pc_build":
                    if slot and slot != "assembly":
                        # product-строка по slot
                        for it in items:
                            if it.get("slot") == slot:
                                it["warranty_months"] = wm
                    else:
                        # строка услуги сборки + обратная совместимость
                        for it in items:
                            if it.get("item_type") == "assembly" or it.get("slot") == "assembly":
                                it["warranty_months"] = wm
                        if items:
                            items[0]["assembly_warranty"] = wm
                else:
                    items[item_idx]["warranty_months"] = wm
                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))

            elif action == "set_status":
                # Статус позиции: reserved / issued / returned
                items[item_idx]["item_status"] = body.get("item_status", "reserved")
                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))
                # Автозавершение заказа: если ВСЕ позиции выданы/возвращены и есть
                # хотя бы одна выданная — переводим заказ в done (уходит в архив).
                _prod_items = [it for it in items if it.get("item_type") == "product"]
                if _prod_items:
                    _all_closed = all(it.get("item_status") in ("issued", "returned") for it in _prod_items)
                    _any_issued = any(it.get("item_status") == "issued" for it in _prod_items)
                    if _all_closed and _any_issued:
                        cur.execute("UPDATE orders SET status='done', updated_at=NOW() WHERE id=%s", (order_id,))

            elif action == "unreserve":
                # Возврат товара на склад: снимаем ВСЕ резервы позиции через ядро
                # (закрываем warehouse_reserves → status RELEASED, возвращаем qty),
                # помечаем позицию returned и вычитаем из суммы заказа.
                # Идемпотентно: если позиция уже returned — не делаем ничего.
                import warehouse_core as wc
                if items[item_idx].get("item_status") == "returned":
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True, "items": items})}
                pid = items[item_idx].get("id")
                if pid:
                    wc.release_line(cur, order_id, int(pid))
                items[item_idx]["item_status"] = "returned"
                # Пересчёт суммы заказа без возвращённых позиций
                total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1)
                            for it in items if it.get("item_status") != "returned")
                cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), total, order_id))

            elif action == "restore_item":
                # Вернуть товар в заказ из статуса returned. Меняем статус позиции
                # и пересчитываем ВЕСЬ резерв заказа через единое ядро.
                # Идемпотентно: восстанавливаем ТОЛЬКО позиции в статусе returned.
                import warehouse_core as wc
                if items[item_idx].get("item_status") != "returned":
                    return {"statusCode": 200, "headers": cors,
                            "body": json.dumps({"ok": True, "items": items})}
                items[item_idx]["item_status"] = "reserved"
                total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1)
                            for it in items if it.get("item_status") != "returned")
                cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), total, order_id))
                res_list = wc.recalc_parts_order(cur, order_id)
                pid = items[item_idx].get("id")
                if pid:
                    for r in (res_list or []):
                        inp = r.get("input") or {}
                        if inp.get("product_id") and int(inp["product_id"]) == int(pid):
                            if r.get("negative", 0) > 0 and r.get("positive", 0) == 0:
                                items[item_idx]["item_status"] = "need_order"
                                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                                            (json.dumps(items), order_id))
                            break

            elif action == "replace_item":
                # Заменить товар в позиции на другой из склада
                new_product_id = int(body["new_product_id"])
                slot = body.get("slot")  # для pc_build заказов

                cur.execute(
                    f"SELECT p.name, p.price, wg.warranty_months, wg.id as wg_id "
                    f"FROM {schema}.products p "
                    f"LEFT JOIN {schema}.warehouse_groups wg ON wg.product_id = p.id "
                    f"WHERE p.id = %s LIMIT 1",
                    (new_product_id,)
                )
                pr = cur.fetchone()
                if not pr:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Товар не найден"})}

                new_name = pr[0]
                new_price = float(pr[1])

                # Для pc_build — qty из pc_builds.components по слоту
                qty = 1
                if slot:
                    cur.execute(
                        f"SELECT wb.id, wb.build_id FROM {schema}.wip_builds wb WHERE wb.order_id = %s LIMIT 1",
                        (order_id,)
                    )
                    wip_row = cur.fetchone()
                    if wip_row:
                        wip_id_r, build_id_r = wip_row
                        if build_id_r:
                            cur.execute(f"SELECT components FROM {schema}.pc_builds WHERE id = %s", (build_id_r,))
                            pb = cur.fetchone()
                            if pb and pb[0]:
                                comps = pb[0] if isinstance(pb[0], list) else json.loads(pb[0])
                                for c in comps:
                                    if c.get("slot") == slot:
                                        qty = int(c.get("qty", 1))
                                        break
                else:
                    qty = int(items[item_idx].get("quantity", 1))

                # Проверить наличие нового товара (qty = свободных по новой логике)
                cur.execute(
                    f"SELECT COALESCE(SUM(s.qty), 0) FROM {schema}.warehouse_supplies s "
                    f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id WHERE g.product_id = %s",
                    (new_product_id,)
                )
                available = int((cur.fetchone() or [0])[0])
                if available < qty:
                    return {"statusCode": 400, "headers": cors, "body": json.dumps({
                        "error": f"Недостаточно товара на складе. Свободно: {available} шт."
                    })}

                # Снять резерв со старого товара и вернуть qty
                old_pid = items[item_idx].get("id") if item_idx is not None else None
                if slot and wip_row:
                    # Для pc_build — ищем old_pid из pc_builds.components
                    if build_id_r:
                        cur.execute(f"SELECT components FROM {schema}.pc_builds WHERE id = %s", (build_id_r,))
                        pb2 = cur.fetchone()
                        if pb2 and pb2[0]:
                            comps2 = pb2[0] if isinstance(pb2[0], list) else json.loads(pb2[0])
                            for c in comps2:
                                if c.get("slot") == slot and c.get("source_id"):
                                    old_pid = int(c["source_id"])
                                    break

                # Резерв со старого и на новый товар пересчитывается через единое
                # ядро (recalc) ПОСЛЕ обновления состава — никаких ручных
                # qty_reserved, чтобы не рассинхронить склад.
                import warehouse_core as wc

                # Для pc_build: обновляем wip_builds и pc_builds
                if slot and wip_row:
                    wip_id_r, build_id_r = wip_row
                    # PC-слот конфигуратора → wip-слот (колонка wip_builds).
                    # Критично: slot вроде 'fan'/'accessory' не имеет своей колонки
                    # (fan_status не существует) — их надо свести к 'extra', иначе
                    # UPDATE падал с ошибкой и замена не срабатывала.
                    _pc_to_wip = {
                        "cpu": "cpu", "motherboard": "motherboard", "ram": "ram",
                        "gpu": "gpu", "storage": "storage", "psu": "psu",
                        "case": "case", "cooling": "cooling",
                        "extra": "extra", "fan": "extra", "accessory": "extra",
                    }
                    wip_slot_r = _pc_to_wip.get(slot, "extra")
                    name_field = "case_name" if wip_slot_r == "case" else wip_slot_r
                    status_field = f"{wip_slot_r}_status"
                    cur.execute(
                        f"UPDATE {schema}.wip_builds SET {name_field}=%s, {status_field}='ready', updated_at=NOW() WHERE id=%s",
                        (new_name, wip_id_r)
                    )
                    if build_id_r:
                        cur.execute(f"SELECT components FROM {schema}.pc_builds WHERE id=%s", (build_id_r,))
                        pb3 = cur.fetchone()
                        if pb3 and pb3[0]:
                            comps3 = pb3[0] if isinstance(pb3[0], list) else json.loads(pb3[0])
                            for c in comps3:
                                if c.get("slot") == slot:
                                    c["name"] = new_name
                                    c["price"] = new_price
                                    c["source"] = "catalog"
                                    c["source_id"] = new_product_id
                                    break
                            cur.execute(f"UPDATE {schema}.pc_builds SET components=%s WHERE id=%s",
                                        (json.dumps(comps3), build_id_r))
                    # Пересчёт резерва сборки через ядро (старый компонент снят,
                    # новый зарезервирован, корзина/минус-резерв согласованы).
                    wc.recalc_build_order(cur, order_id)
                else:
                    # Обычный заказ: обновляем items JSON
                    items[item_idx]["id"] = new_product_id
                    items[item_idx]["name"] = new_name
                    items[item_idx]["price"] = new_price
                    items[item_idx].pop("final_price", None)
                    items[item_idx].pop("serial_number", None)
                    items[item_idx].pop("serial_numbers", None)
                    items[item_idx]["item_status"] = "reserved"
                    total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1)
                                for it in items if it.get("item_status") != "returned")
                    cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                                (json.dumps(items), total, order_id))
                    # Пересчёт резерва по актуальному составу (единое ядро).
                    res_list = wc.recalc_parts_order(cur, order_id)
                    for r in (res_list or []):
                        inp = r.get("input") or {}
                        if inp.get("product_id") and int(inp["product_id"]) == new_product_id:
                            if r.get("negative", 0) > 0 and r.get("positive", 0) == 0:
                                items[item_idx]["item_status"] = "need_order"
                                cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                                            (json.dumps(items), order_id))
                            break

            elif action == "sync_order":
                # Синхронизировать заказ ПК: резервировать наличие, отрицательный резерв для отсутствующих
                # Проверяем что заказ не отменён
                cur.execute(f"SELECT status FROM {schema}.orders WHERE id = %s", (order_id,))
                order_status_row = cur.fetchone()
                if order_status_row and order_status_row[0] == "cancelled":
                    return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Заказ отменён"})}

                # ЗАЩИТА ОТ ГОНКИ: сериализуем весь пересчёт заказа (read+release+
                # reserve) под транзакционной блокировкой. Два одновременных
                # sync_order (двойной клик / авто-sync) раньше пересекались и
                # теряли часть резервов. Снимается на commit/rollback.
                import warehouse_core as wc
                wc.lock_order(cur, order_id)

                # Получаем wip_build и pc_build для этого заказа
                cur.execute(
                    f"SELECT wb.id, wb.cpu, wb.motherboard, wb.ram, wb.gpu, wb.storage, wb.psu, wb.case_name, wb.cooling, wb.extra, "
                    f"wb.cpu_status, wb.motherboard_status, wb.ram_status, wb.gpu_status, wb.storage_status, "
                    f"wb.psu_status, wb.case_status, wb.cooling_status, wb.extra_status, wb.build_id "
                    f"FROM wip_builds wb WHERE wb.order_id = %s LIMIT 1",
                    (order_id,)
                )
                wip = cur.fetchone()
                if not wip:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Сборка в процессе не найдена"})}

                wip_id = wip[0]
                build_id = wip[19]
                slot_names = ["cpu", "motherboard", "ram", "gpu", "storage", "psu", "case", "cooling", "extra"]
                slot_values = list(wip[1:10])    # названия компонентов
                slot_statuses = list(wip[10:19]) # текущие статусы

                # Кол-во сборок из заказа (quantity на config-айтеме)
                cur.execute(f"SELECT items FROM {schema}.orders WHERE id = %s LIMIT 1", (order_id,))
                order_row = cur.fetchone()
                order_items_raw = order_row[0] if order_row else []
                build_qty = 1
                for oi in (order_items_raw or []):
                    if oi.get("item_type") in ("config", "pc_build"):
                        build_qty = int(oi.get("quantity", 1))
                        break

                # Получаем компоненты из pc_builds для сопоставления product_id
                pc_components = []
                if build_id:
                    cur.execute(f"SELECT components FROM {schema}.pc_builds WHERE id = %s LIMIT 1", (build_id,))
                    pc_row = cur.fetchone()
                    if pc_row and pc_row[0]:
                        raw = pc_row[0] if isinstance(pc_row[0], list) else json.loads(pc_row[0])
                        pc_components = raw

                # Маппинг слота компонента из pc_builds → слот WIP.
                # В WIP несколько типов складываются в один столбец «Доп.»:
                # все вентиляторы (fan) и прочие аксессуары идут в extra.
                # Корпус в WIP хранится в поле case_name / case_status, слот 'case'.
                PC_TO_WIP_SLOT = {
                    "cpu": "cpu", "motherboard": "motherboard", "ram": "ram",
                    "gpu": "gpu", "storage": "storage", "psu": "psu",
                    "case": "case", "cooling": "cooling",
                    "extra": "extra", "fan": "extra", "accessory": "extra",
                }

                reserved_items = []
                negative_items = []
                # Агрегируем результат резерва по WIP-слоту: если хоть один
                # компонент слота ушёл в дефицит → need_order, иначе ready.
                slot_had_negative = {}
                slot_had_positive = {}

                # Резервирование через ядро склада (warehouse_core): корректно
                # создаёт записи в warehouse_reserves — и POSITIVE (наличие), и
                # NEGATIVE (дефицит) — с привязкой к order_id.
                import warehouse_core as wc

                # ИДЕМПОТЕНТНОСТЬ: при создании заказа резервы уже могли быть
                # созданы (ensure_order_reserves), но статусы слотов WIP остались
                # pending. Чтобы повторный sync_order не задваивал резервы —
                # снимаем существующие активные резервы заказа (кроме уже
                # заказанных у поставщика) и резервируем заново с чистого листа.
                wc.release_order_reserves(cur, order_id, only_new_negative=True)

                # Слоты, уже заказанные у поставщика — их резерв не трогаем.
                ordered_wip_slots = {
                    slot_names[i] for i in range(len(slot_names))
                    if slot_statuses[i] in ("ordered_transit", "ordered_delay")
                }

                # Резервируем КАЖДЫЙ компонент сборки отдельно (по source_id и qty).
                # Это чинит допы/вентиляторы и любые повторяющиеся слоты (напр.
                # несколько накопителей), которые раньше склеивались в одну строку
                # и терялись при маппинге slot→product.
                reserved_any_component = False
                # Слоты «заказан у поставщика / в пути», по которым СЕЙЧАС создан
                # минус-резерв (товара на складе нет). Их статус НЕ переводим в
                # need_order — оставляем ordered_*, т.к. железо реально едет.
                kept_ordered_slots = set()
                for comp in pc_components:
                    if comp.get("source") != "catalog" or not comp.get("source_id"):
                        continue  # пользовательское железо — не резервируем
                    pc_slot = comp.get("slot") or ""
                    wip_slot = PC_TO_WIP_SLOT.get(pc_slot, "extra")
                    comp_qty = int(comp.get("qty", 1) or 1) * build_qty
                    if comp_qty <= 0:
                        continue
                    product_id = int(comp["source_id"])
                    slot_ordered = wip_slot in ordered_wip_slots
                    if slot_ordered:
                        # Слот «заказан у поставщика / в пути». Правило (по решению
                        # пользователя):
                        #  • товар УЖЕ на складе (free>0) — резервируем из наличия,
                        #    слот станет ready («то, что ехало, приехало»);
                        #  • товара нет (free<=0) — ВСЁ РАВНО создаём минус-резерв
                        #    (долг склада → потребность видна, попадает в закупку),
                        #    но статус слота оставляем ordered_* (железо едет).
                        #    При приёмке этот минус-резерв авто-конвертируется в
                        #    POSITIVE под заказ (см. warehouse supply_create).
                        gid = wc.resolve_group_id(cur, product_id)
                        free = wc.free_stock(cur, gid)
                        if free <= 0:
                            kept_ordered_slots.add(wip_slot)
                    reserved_any_component = True
                    # Для заказанных у поставщика слотов минус-резерв нужен, но
                    # закупку в корзину не задваиваем (уже заказано) — no_purchase.
                    res = wc.reserve_line(cur, order_id, product_id=product_id,
                                          qty=comp_qty, slot=wip_slot,
                                          no_purchase=slot_ordered)
                    pos = int(res.get("positive", 0) or 0)
                    neg = int(res.get("negative", 0) or 0)
                    cname = comp.get("name") or ""
                    if pos > 0:
                        slot_had_positive[wip_slot] = True
                        reserved_items.append({"slot": wip_slot, "name": cname,
                                               "product_id": product_id, "reserved": pos})
                    if neg > 0:
                        slot_had_negative[wip_slot] = True
                        negative_items.append({"slot": wip_slot, "name": cname,
                                               "product_id": product_id, "shortage": neg})

                new_statuses = {}
                for wip_slot in set(list(slot_had_negative) + list(slot_had_positive)):
                    if wip_slot in kept_ordered_slots:
                        # Слот заказан у поставщика, минус-резерв создан, но статус
                        # оставляем ordered_* (железо едет) — не трогаем.
                        continue
                    if slot_had_negative.get(wip_slot):
                        new_statuses[wip_slot] = "need_order"
                    elif slot_had_positive.get(wip_slot):
                        new_statuses[wip_slot] = "ready"

                # FALLBACK для сборок без сохранённого состава pc_builds (старые
                # заказы): резервируем по названиям из WIP, как раньше — по одному
                # товару на слот. Только если компонентов каталога не было вовсе.
                if not reserved_any_component:
                    for slot, name, status in zip(slot_names, slot_values, slot_statuses):
                        if not name or not name.strip():
                            continue
                        if status in ("ordered_transit", "ordered_delay"):
                            continue
                        cur.execute(
                            f"SELECT p.id FROM {schema}.products p WHERE p.name = %s LIMIT 1",
                            (name,)
                        )
                        pr = cur.fetchone()
                        if not pr:
                            new_statuses[slot] = "need_order"
                            negative_items.append({"slot": slot, "name": name, "reason": "product_not_found"})
                            continue
                        product_id = pr[0]
                        res = wc.reserve_line(cur, order_id, product_id=product_id,
                                              qty=build_qty, slot=slot)
                        pos = int(res.get("positive", 0) or 0)
                        neg = int(res.get("negative", 0) or 0)
                        if pos > 0:
                            reserved_items.append({"slot": slot, "name": name,
                                                   "product_id": product_id, "reserved": pos})
                        if neg > 0:
                            new_statuses[slot] = "need_order"
                            negative_items.append({"slot": slot, "name": name, "product_id": product_id})
                        elif pos > 0:
                            new_statuses[slot] = "ready"

                # Обновляем статусы слотов в wip_build
                set_parts = []
                for slot, st in new_statuses.items():
                    set_parts.append(f"{slot}_status = '{st}'")
                if set_parts:
                    cur.execute(
                        f"UPDATE wip_builds SET {', '.join(set_parts)}, updated_at=NOW() WHERE id = %s",
                        (wip_id,)
                    )

                # ПЕРЕСБОРКА ПОЗИЦИЙ ЗАКАЗА из актуального состава сборки.
                # Если в pc_builds.components добавили/убрали железо или изменили
                # цену — orders.items и total пересобираются из снимка сборки.
                # Финальные цены/серийники/статусы по слотам при этом сохраняются
                # (build_pc_snapshot берёт их из существующих items по slot).
                if build_id:
                    snapshot = build_pc_snapshot(
                        cur, schema, order_id, order_items_raw, build_id, wip, build_qty
                    )
                    snap_total = sum(
                        (it.get("final_price") if it.get("final_price") is not None
                         else it.get("price", 0))
                        * it.get("quantity", 1)
                        for it in snapshot
                        if it.get("item_status") != "returned"
                    )
                    cur.execute(
                        f"UPDATE {schema}.orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                        (json.dumps(snapshot), snap_total, order_id)
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

                # Мгновенное напоминание в рабочий чат: в корзине появилось железо
                # для заказа. Дедуп — одно сообщение в сутки (ON CONFLICT по дате).
                if negative_items:
                    try:
                        cur.execute(
                            f"SELECT COUNT(*), COALESCE(SUM(required_qty), 0) "
                            f"FROM {schema}.warehouse_purchase_basket "
                            f"WHERE status = 'NEW' AND required_qty > 0"
                        )
                        _b = cur.fetchone()
                        _positions = int(_b[0]) if _b else 0
                        _qty = int(_b[1]) if _b else 0
                        if _positions > 0:
                            cur.execute(
                                f"INSERT INTO {schema}.basket_purchase_notified (notify_date, positions) "
                                f"VALUES (CURRENT_DATE, %s) ON CONFLICT (notify_date) DO NOTHING",
                                (_positions,)
                            )
                            _fresh = cur.rowcount > 0
                            conn.commit()
                            if _fresh:
                                from tg_notify import notify_managers
                                _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
                                _wip_link = f"\n🔗 <a href=\"{_base}/admin/wip_builds\">Открыть корзину закупки</a>" if _base else ""
                                notify_managers(
                                    f"🛒 <b>В корзине закупки есть железо для заказа</b>\n"
                                    f"Позиций: {_positions} (всего {_qty} шт)" + _wip_link, event_key="purchase_basket")
                    except Exception as _be:
                        print(f"TG_NOTIFY basket: {_be}")

                return {"statusCode": 200, "headers": cors, "body": json.dumps({
                    "ok": True,
                    "reserved": reserved_items,
                    "need_order": negative_items,
                    "auto_status": "waiting_assembly" if (all_slots_filled and not negative_items) else None
                })}

            elif action == "add_item":
                # Добавить новый товар со склада в заказ.
                # Резерв НЕ считаем вручную — сохраняем позицию в items и через
                # единое ядро recalc_parts_order пересчитываем ВЕСЬ резерв заказа
                # (учёт qty>1, POSITIVE/NEGATIVE, корзина закупки, логи).
                import warehouse_core as wc
                new_product_id = int(body["new_product_id"])
                qty = int(body.get("quantity", 1) or 1)
                cur.execute(
                    f"SELECT p.name, p.price FROM {schema}.products p WHERE p.id = %s LIMIT 1",
                    (new_product_id,)
                )
                pr = cur.fetchone()
                if not pr:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Товар не найден"})}
                items.append({
                    "id": new_product_id,
                    "name": pr[0],
                    "price": float(pr[1]),
                    "quantity": qty,
                    "item_type": "product",
                    "item_status": "reserved",
                })
                total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1)
                            for it in items if it.get("item_status") != "returned")
                cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), total, order_id))
                # Пересчёт резерва по актуальному составу (единое ядро).
                res_list = wc.recalc_parts_order(cur, order_id)
                # Проставляем статус добавленной позиции по результату резерва.
                by_pid = {}
                for r in (res_list or []):
                    inp = r.get("input") or {}
                    if inp.get("product_id"):
                        by_pid[int(inp["product_id"])] = r
                rr = by_pid.get(new_product_id)
                if rr and rr.get("negative", 0) > 0 and rr.get("positive", 0) == 0:
                    items[-1]["item_status"] = "need_order"
                    cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                                (json.dumps(items), order_id))

            elif action == "change_qty":
                # Изменить количество позиции: снять старый резерв, поставить новый
                new_qty = int(body.get("quantity", 1))
                if new_qty < 1:
                    return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Количество должно быть >= 1"})}

                # Для ПК-сборок кол-во компонента хранится в pc_builds.components[].qty,
                # а не в orders.items (там 1 строка-конфиг). Меняем по slot/product_id.
                slot = body.get("slot")
                req_pid = body.get("product_id")
                cur.execute(
                    "SELECT pb.id FROM pc_builds pb JOIN wip_builds wb ON wb.build_id = pb.id "
                    "WHERE wb.order_id = %s LIMIT 1",
                    (order_id,),
                )
                pcb = cur.fetchone()
                build_id = pcb[0] if pcb else None

                if build_id and (slot or req_pid):
                    pid = int(req_pid) if req_pid else None
                    cur.execute(f"SELECT components FROM {schema}.pc_builds WHERE id=%s", (build_id,))
                    pc_row = cur.fetchone()
                    comps = []
                    if pc_row and pc_row[0]:
                        comps = pc_row[0] if isinstance(pc_row[0], list) else json.loads(pc_row[0])
                    target = None
                    if slot:
                        target = next((c for c in comps if c.get("slot") == slot), None)
                    if target is None and pid:
                        target = next((c for c in comps if int(c.get("source_id", 0)) == pid), None)
                    if target is None:
                        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Компонент сборки не найден"})}
                    if pid is None:
                        pid = int(target.get("source_id", 0))
                    # Обновляем кол-во компонента в составе сборки (источник истины)
                    target["qty"] = new_qty
                    cur.execute(f"UPDATE {schema}.pc_builds SET components=%s WHERE id=%s",
                                (json.dumps(comps), build_id))
                    # Пересчёт резерва сборки через единое ядро (без ручного qty_reserved).
                    import warehouse_core as wc
                    wc.recalc_build_order(cur, order_id)
                    # orders.items — источник истины: меняем quantity в строке по
                    # slot (или product_id), пересчитываем total, затем сохраняем.
                    t_slot = target.get("slot")
                    for it in items:
                        if it.get("item_type") != "product":
                            continue
                        if (t_slot and it.get("slot") == t_slot) or (pid and it.get("id") == pid and not t_slot):
                            it["quantity"] = new_qty
                    total = sum(
                        (it.get("final_price") if it.get("final_price") is not None
                         else it.get("price", 0)) * it.get("quantity", 1)
                        for it in items
                        if it.get("item_status") != "returned"
                    )
                    cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                                (json.dumps(items), total, order_id))
                    conn.commit()
                    return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

                # parts-заказ: меняем количество в items (источник истины) и
                # ПОЛНОСТЬЮ пересчитываем резерв через единое ядро. Никаких ручных
                # правок qty_reserved — они и приводили к рассинхрону склада.
                import warehouse_core as wc
                pid = items[item_idx].get("id")
                items[item_idx]["quantity"] = new_qty
                if items[item_idx].get("item_status") == "returned":
                    items[item_idx]["item_status"] = "reserved"
                total = sum((it.get("final_price") or it.get("price", 0)) * it.get("quantity", 1)
                            for it in items if it.get("item_status") != "returned")
                cur.execute("UPDATE orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), total, order_id))
                # Пересчёт резерва по актуальному составу (POSITIVE/NEGATIVE, корзина, логи).
                res_list = wc.recalc_parts_order(cur, order_id)
                if pid:
                    for r in (res_list or []):
                        inp = r.get("input") or {}
                        if inp.get("product_id") and int(inp["product_id"]) == int(pid):
                            items[item_idx]["item_status"] = (
                                "need_order" if r.get("negative", 0) > 0 and r.get("positive", 0) == 0
                                else "reserved"
                            )
                            cur.execute("UPDATE orders SET items=%s, updated_at=NOW() WHERE id=%s",
                                        (json.dumps(items), order_id))
                            break

            elif action == "writeoff_order":
                # Выдаём только за деньги: у комплектующих это полная сумма
                # (предоплаты нет), у сборок — остаток после аванса.
                cur.execute(f"SELECT remaining_paid, status, order_type "
                            f"FROM {schema}.orders WHERE id=%s", (order_id,))
                wo_pay = cur.fetchone()
                if wo_pay and wo_pay[1] != "done" and not bool(wo_pay[0]):
                    is_build = wo_pay[2] == "pc_build"
                    return {"statusCode": 400, "headers": cors, "body": json.dumps(
                        {"error": "remaining_unpaid",
                         "message": ("Перед выдачей нужно принять оплату остатка по заказу."
                                     if is_build else
                                     "Перед выдачей нужно принять оплату заказа.")})}
                # Списать все зарезервированные товары заказа и перевести статус в done
                wrote_off = []
                for it in items:
                    pid = it.get("id")
                    qty = int(it.get("quantity", 1))
                    item_status = it.get("item_status", "reserved")
                    if not pid or item_status == "returned":
                        continue
                    sale_price = float(it.get("final_price") or it.get("price", 0))
                    # Товар уже в резерве (qty вычтен при резерве), списываем из qty_reserved
                    cur.execute(
                        f"SELECT s.id, s.qty_reserved, s.cost_price, g.id as gid "
                        f"FROM {schema}.warehouse_supplies s "
                        f"JOIN {schema}.warehouse_groups g ON g.id = s.group_id "
                        f"WHERE g.product_id = %s AND s.qty_reserved > 0 ORDER BY s.id ASC",
                        (int(pid),)
                    )
                    supplies = cur.fetchall()
                    left = qty
                    for sid, s_reserved, s_cost, gid in supplies:
                        if left <= 0:
                            break
                        write = min(left, s_reserved)
                        margin = round((sale_price - float(s_cost)) * write, 2)
                        cur.execute(
                            f"UPDATE {schema}.warehouse_supplies "
                            f"SET qty_reserved = GREATEST(0, qty_reserved - %s), updated_at = NOW() "
                            f"WHERE id = %s",
                            (write, sid)
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

                # Закрываем ACTIVE-резервы заказа (товар выдан) → FULFILLED, чтобы
                # синхронизация (recalc_reserves) не считала qty_reserved «лишним»
                # и не пыталась вернуть его в наличие. qty_reserved уже уменьшен выше.
                cur.execute(
                    f"UPDATE {schema}.warehouse_reserves "
                    f"SET status = 'FULFILLED', updated_at = NOW() "
                    f"WHERE order_id = %s AND status = 'ACTIVE'",
                    (order_id,)
                )
                cur.execute("UPDATE orders SET items=%s, status='done', updated_at=NOW() WHERE id=%s",
                            (json.dumps(items), order_id))
                # Синхронизируем WIP-сборку: при выдаче переводим стадию в «Забрали»
                # (иначе в /orders статус берётся из WIP и остаётся «Готов/В продаже»).
                cur.execute(
                    f"UPDATE {schema}.wip_builds SET stage='Забрали', issued_at=CURRENT_DATE, "
                    f"updated_at=NOW() WHERE order_id=%s",
                    (order_id,)
                )
                # Снимаем каталожную сборку с витрины: комп выдан, продавать нечего.
                # (writeoff_order идёт в обход PATCH wip-builds, где архивация уже есть.)
                cur.execute(
                    f"UPDATE {schema}.pc_builds SET status='archive', in_stock=FALSE "
                    f"WHERE id IN (SELECT build_id FROM {schema}.wip_builds "
                    f"WHERE order_id=%s AND build_id IS NOT NULL)",
                    (order_id,)
                )
                conn.commit()
                return {"statusCode": 200, "headers": cors,
                        "body": json.dumps({"ok": True, "wrote_off": wrote_off, "items": items})}

            elif action == "clear_reservation":
                # «Снять резерв» (клиент передумал): возвращаем заказ-затычку в
                # ПУСТОЕ состояние — стираем данные клиента. Сборка остаётся в
                # наличии и в свободной продаже (for_sale/in_stock не трогаем),
                # заказ-затычку сохраняем для следующего клиента. На витрине
                # баннер вернётся «В резерве» → «В наличии».
                import warehouse_core as wc
                try:
                    wc.release_order_reserves(cur, order_id, only_new_negative=True)
                except Exception as _re:
                    print(f"clear_reservation release: {_re}")
                cur.execute("SELECT display_number FROM orders WHERE id=%s", (order_id,))
                _dn = cur.fetchone()
                _stub_name = f"Сборка {(_dn[0] if _dn and _dn[0] else order_id)}"
                # Возвращаем затычку в пустое состояние
                cur.execute(
                    "UPDATE orders SET customer_name=%s, customer_phone='-', customer_email=NULL, "
                    "status='waiting_assembly', updated_at=NOW() WHERE id=%s",
                    (_stub_name, order_id)
                )
                # Чистим контакт в WIP (for_sale остаётся TRUE — сборка снова на витрине)
                cur.execute(
                    f"UPDATE {schema}.wip_builds SET contact='', updated_at=NOW() WHERE order_id=%s",
                    (order_id,)
                )
                conn.commit()
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "cleared": True})}

            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "items": items})}

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            new_status = body["status"]
            order_id = body["id"]
            schema = "t_p72635010_quantum_fusion_resea"

            # При отмене — снимаем ВСЕ резервы заказа через единое ядро.
            # Источник истины — warehouse_reserves (release_order_reserves сам
            # вернёт POSITIVE в наличие и снимет NEGATIVE + корзину). Старый путь
            # считал резерв по warehouse_movements и делал qty=qty+..., из-за чего
            # при наличии core-резервов остаток возвращался ДВАЖДЫ (баг-репорт п.5).
            if new_status == "cancelled":
                import warehouse_core as wc
                wc.release_order_reserves(cur, order_id, only_new_negative=True)

            # При завершении (done) — товар выдан клиенту.
            if new_status == "done":
                # Перед выдачей остаток по заказу должен быть оплачен.
                cur.execute("SELECT remaining_paid, status FROM orders WHERE id=%s", (order_id,))
                pay_row = cur.fetchone()
                if pay_row and pay_row[1] != "done" and not bool(pay_row[0]):
                    return {"statusCode": 400, "headers": cors, "body": json.dumps(
                        {"error": "remaining_unpaid",
                         "message": "Перед выдачей нужно принять оплату остатка по заказу."})}
                # Начисление сборщику ПК: % сотрудника × полная цена заказа.
                # Для pc_build-заказов сборщик ОБЯЗАТЕЛЕН (иначе блокируем выдачу).
                cur.execute("SELECT order_type, total, status, assembler_paid FROM orders WHERE id=%s", (order_id,))
                ord_row = cur.fetchone()
                o_type = ord_row[0] if ord_row else None
                o_total = float(ord_row[1] or 0) if ord_row else 0
                o_status = ord_row[2] if ord_row else None
                already_paid = bool(ord_row[3]) if ord_row else False
                if o_type == "pc_build":
                    cur.execute(
                        f"SELECT wb.assembled_by, e.assembler_percent, e.name "
                        f"FROM {schema}.wip_builds wb "
                        f"LEFT JOIN {schema}.employees e ON e.id = wb.assembled_by "
                        f"WHERE wb.order_id = %s LIMIT 1", (order_id,)
                    )
                    asm = cur.fetchone()
                    assembled_by = asm[0] if asm else None
                    asm_pct = float(asm[1] or 0) if asm else 0
                    asm_name = asm[2] if asm else None
                    if not assembled_by:
                        return {"statusCode": 400, "headers": cors, "body": json.dumps(
                            {"error": "Не выбран сборщик ПК. Укажите сборщика в карточке сборки (кнопка «Ред.»)."})}
                    # Начисляем только один раз и только при первом переходе в done
                    if not already_paid and o_status != "done" and asm_pct > 0 and o_total > 0:
                        bonus = round(o_total * asm_pct / 100, 2)
                        if bonus > 0:
                            cur.execute(
                                f"INSERT INTO {schema}.employee_accounts (employee_id, balance) "
                                f"VALUES (%s, %s) ON CONFLICT (employee_id) DO UPDATE "
                                f"SET balance = {schema}.employee_accounts.balance + %s, updated_at = NOW()",
                                (assembled_by, bonus, bonus)
                            )
                            cur.execute(
                                f"INSERT INTO {schema}.employee_account_tx (employee_id, amount, note, order_id) "
                                f"VALUES (%s, %s, %s, %s)",
                                (assembled_by, bonus, f"Сборка ПК заказ #{order_id} ({asm_pct}% от {int(o_total)} ₽)", order_id)
                            )
                            cur.execute("UPDATE orders SET assembler_paid = TRUE WHERE id=%s", (order_id,))

                # Выдача клиенту: закрываем ВСЕ активные резервы заказа единым
                # ядром (и POSITIVE, и NEGATIVE). Раньше тут был прямой SQL,
                # который закрывал только POSITIVE и оставлял NEGATIVE-резервы
                # висеть ACTIVE → рассинхрон qty_negative. Идемпотентно.
                import warehouse_core as _wc_fulfill
                _wc_fulfill.fulfill_order_reserves(cur, order_id)

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

        elif method == "DELETE":
            # ── ПОЛНОЕ УДАЛЕНИЕ ЗАКАЗА ──────────────────────────────────────────
            # Безопасно: сначала снимаем резервы через ядро (склад не поедет),
            # потом чистим связанные записи и удаляем сам заказ.
            # order_id из query (?id=) или из тела.
            schema = "t_p72635010_quantum_fusion_resea"
            body = {}
            try:
                body = json.loads(event.get("body") or "{}")
            except Exception:
                body = {}
            order_id = params.get("id") or body.get("id")
            if not order_id:
                return {"statusCode": 400, "headers": cors,
                        "body": json.dumps({"error": "Не указан id заказа"})}
            order_id = int(order_id)

            cur.execute(f"SELECT id FROM {schema}.orders WHERE id=%s", (order_id,))
            if not cur.fetchone():
                return {"statusCode": 404, "headers": cors,
                        "body": json.dumps({"error": "Заказ не найден"})}

            # Нельзя удалять заказ с гарантийными обращениями (RMA) — это история.
            cur.execute(f"SELECT COUNT(*) FROM {schema}.warehouse_rma "
                        f"WHERE order_id=%s OR replacement_order_id=%s", (order_id, order_id))
            if int(cur.fetchone()[0] or 0) > 0:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({
                    "error": "У заказа есть гарантийные обращения (RMA). Удаление запрещено — сначала закройте RMA."})}

            # 0) ПРЕДОПЛАТА/ОПЛАТА: если по заказу были приходы денег
            #    (предоплата или оплата заказа), значит их вернули клиенту при
            #    удалении заказа. Создаём возвратную проводку (расход) на всю
            #    сумму приходов заказа, чтобы касса сошлась (приход − возврат = 0),
            #    и обнуляем флаги предоплаты. affects_pnl=FALSE — это не убыток
            #    бизнеса, а сторнирование прихода (деньги отданы обратно).
            cur.execute(
                f"SELECT COALESCE(SUM(amount), 0) FROM {schema}.finance_transactions "
                f"WHERE order_id=%s AND kind='income'", (order_id,))
            paid_in = float(cur.fetchone()[0] or 0)
            if paid_in > 0:
                # Номер заказа для пометки в проводке
                cur.execute(f"SELECT display_number FROM {schema}.orders WHERE id=%s", (order_id,))
                _dn = cur.fetchone()
                disp = (_dn[0] if _dn and _dn[0] else f"#{order_id}")
                cur.execute(
                    f"INSERT INTO {schema}.finance_transactions "
                    f"(kind, type_id, amount, note, affects_pnl, order_id, occurred_at) "
                    f"VALUES ('expense', 1, %s, %s, FALSE, %s, NOW())",
                    (paid_in, f"Возврат клиенту по удалённому заказу {disp} (предоплата возвращена)", order_id))
                cur.execute(
                    f"UPDATE {schema}.orders SET prepayment_confirmed=FALSE, prepayment_amount=0, "
                    f"remaining_paid=FALSE, remaining_paid_amount=0, updated_at=NOW() WHERE id=%s",
                    (order_id,))

            # 1) Снимаем ВСЕ активные резервы через ядро (POSITIVE→наличие,
            #    NEGATIVE→qty_negative+корзина). Заказанное у поставщика тоже
            #    снимаем — при полном удалении заказа держать нечего.
            import warehouse_core as wc
            wc.release_order_reserves(cur, order_id, only_new_negative=False)

            # 2) Чистим FK-потомков (NO ACTION → удаляем/отвязываем вручную).
            #    Историю (движения, лог, финансы, серийники) СОХРАНЯЕМ, отвязывая
            #    order_id → NULL, чтобы не терять аудит склада и денег.
            cur.execute(f"DELETE FROM {schema}.warehouse_reserves WHERE order_id=%s", (order_id,))
            cur.execute(f"DELETE FROM {schema}.warehouse_backorders WHERE order_id=%s", (order_id,))
            cur.execute(f"UPDATE {schema}.warehouse_movements SET order_id=NULL WHERE order_id=%s", (order_id,))
            cur.execute(f"UPDATE {schema}.warehouse_stock_log SET order_id=NULL WHERE order_id=%s", (order_id,))
            cur.execute(f"UPDATE {schema}.finance_transactions SET order_id=NULL WHERE order_id=%s", (order_id,))
            cur.execute(f"UPDATE {schema}.sn_archive SET order_id=NULL WHERE order_id=%s", (order_id,))
            cur.execute(f"UPDATE {schema}.employee_account_tx SET order_id=NULL WHERE order_id=%s", (order_id,))

            # 2b) Массовая сборка: группы-варианты и отдельные ПК (units).
            cur.execute(f"DELETE FROM {schema}.order_build_units WHERE order_id=%s", (order_id,))
            cur.execute(f"DELETE FROM {schema}.order_build_groups WHERE order_id=%s", (order_id,))

            # 3) WIP-сборка заказа и связанное (ETA компонентов) — удаляем.
            cur.execute(f"SELECT id FROM {schema}.wip_builds WHERE order_id=%s", (order_id,))
            wip_ids = [r[0] for r in cur.fetchall()]
            for _wid in wip_ids:
                cur.execute(f"DELETE FROM {schema}.wip_component_eta WHERE wip_id=%s", (_wid,))
            cur.execute(f"DELETE FROM {schema}.wip_builds WHERE order_id=%s", (order_id,))

            # 4) Сам заказ.
            cur.execute(f"DELETE FROM {schema}.orders WHERE id=%s", (order_id,))
            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "deleted": order_id})}

    finally:
        cur.close()
        conn.close()

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}