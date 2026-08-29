import json
import os
import secrets
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Id, X-Admin-Token",
}

def resp(status, data):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data, ensure_ascii=False, default=str)}

SCHEMA = "t_p72635010_quantum_fusion_resea"

SLOT_LABELS = {
    "cpu": "Процессор", "motherboard": "Материнская плата", "ram": "ОЗУ",
    "gpu": "Видеокарта", "storage": "Накопитель", "psu": "Блок питания",
    "case": "Корпус", "case_name": "Корпус", "cooling": "Охлаждение",
    "fan": "Вентилятор", "extra": "Доп.", "other": "Прочее",
}


def _rebuild_orders_from_build(cur, build_id, components, assembly_fee):
    """Пересобрать позиции (orders.items) и сумму привязанных к сборке заказов.

    Когда в сборке меняется состав/цена железа — заказы на этапе согласования
    должны отражать актуальный список и итог. Финальные цены/серийники/статусы
    по слотам сохраняются из существующих items (по slot), чтобы ручные правки
    цены и выданные серийники не потерялись.
    Пересобираем ТОЛЬКО активные заказы (не done/cancelled)."""
    if not build_id:
        return
    if isinstance(components, str):
        try:
            components = json.loads(components or "[]")
        except Exception:
            components = []
    try:
        assembly_fee = float(assembly_fee or 0)
    except (TypeError, ValueError):
        assembly_fee = 0.0

    cur.execute(
        f"SELECT wb.order_id FROM {SCHEMA}.wip_builds wb "
        f"WHERE wb.build_id = %s AND wb.order_id IS NOT NULL",
        (build_id,)
    )
    order_ids = [r[0] for r in cur.fetchall()]
    if not order_ids:
        return

    for order_id in order_ids:
        cur.execute(
            f"SELECT items, status FROM {SCHEMA}.orders WHERE id = %s LIMIT 1",
            (order_id,)
        )
        row = cur.fetchone()
        if not row:
            continue
        raw_items = row[0] or []
        if isinstance(raw_items, str):
            try:
                raw_items = json.loads(raw_items)
            except Exception:
                raw_items = []
        if row[1] in ("done", "cancelled"):
            continue

        build_qty = 1
        for oi in raw_items:
            if oi.get("item_type") in ("config", "pc_build"):
                build_qty = int(oi.get("quantity", 1) or 1)
                break

        # Сохраняем финальные цены/серийники/статусы/гарантии по слотам
        slot_serials, slot_final_price, slot_item_status, slot_warranty = {}, {}, {}, {}
        assembly_warranty, assembly_serial, assembly_final_price = 12, [], None
        for it in raw_items:
            s = it.get("slot")
            if s and s != "assembly":
                sn = it.get("serial_numbers") or []
                if sn:
                    slot_serials[s] = [x for x in sn if x and str(x).strip()]
                if it.get("final_price") is not None:
                    slot_final_price[s] = float(it["final_price"])
                if it.get("item_status"):
                    slot_item_status[s] = it["item_status"]
                if it.get("warranty_months") is not None:
                    slot_warranty[s] = it["warranty_months"]
            if it.get("item_type") in ("config", "assembly") or it.get("assembly"):
                if it.get("assembly_warranty"):
                    assembly_warranty = int(it["assembly_warranty"])
                if it.get("warranty_months") is not None and it.get("item_type") == "assembly":
                    assembly_warranty = int(it["warranty_months"])
                sn = it.get("serial_numbers") or []
                assembly_serial = [x for x in sn if x and str(x).strip()]
                if it.get("item_type") == "assembly" and it.get("final_price") is not None:
                    assembly_final_price = float(it["final_price"])

        snapshot = []
        for comp in (components or []):
            slot = comp.get("slot")
            name = comp.get("name")
            if not name or not str(name).strip():
                continue
            product_id = None
            if comp.get("source") == "catalog" and comp.get("source_id"):
                product_id = int(comp["source_id"])
            if not product_id:
                cur.execute(f"SELECT id FROM {SCHEMA}.products WHERE name = %s LIMIT 1", (name,))
                pr = cur.fetchone()
                if pr:
                    product_id = pr[0]
            slot_qty = int(comp.get("qty", 1) or 1) * build_qty
            snapshot.append({
                "id": product_id,
                "name": name,
                "slot": slot,
                "slot_label": SLOT_LABELS.get(slot, slot),
                "price": float(comp.get("price", 0) or 0),
                "final_price": slot_final_price.get(slot),
                "quantity": slot_qty,
                "item_type": "product",
                "warranty_months": slot_warranty.get(slot),
                "serial_numbers": slot_serials.get(slot, []),
                "item_status": slot_item_status.get(slot),
            })

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

        snap_total = sum(
            (it.get("final_price") if it.get("final_price") is not None
             else it.get("price", 0)) * it.get("quantity", 1)
            for it in snapshot
            if it.get("item_status") != "returned"
        )
        cur.execute(
            f"UPDATE {SCHEMA}.orders SET items=%s, total=%s, updated_at=NOW() WHERE id=%s",
            (json.dumps(snapshot), snap_total, order_id)
        )


# Этапы WIP, на которых комп реально готов к выдаче (дубль списка из
# wip-builds: функции разные, а правило публикации одно).
READY_TO_SELL_STAGES = {
    "Проверка перед выдачей", "Ожидание упаковки",
    "Готов, можно забрать", "Отнести в сдэк",
}


def _publish_if_card_ready(cur, build_id):
    """Дооформили карточку (добавили фото и название) — публикуем на сайте.

    Сборка «в свободную продажу» ждёт в черновиках, пока карточка не готова.
    Менеджер обычно доводит её уже после того, как комп собран, поэтому
    проверку делаем здесь: иначе карточка так и осталась бы в черновике до
    следующей смены этапа.
    """
    if not build_id:
        return
    cur.execute(
        f"SELECT w.id, w.for_sale, w.stage, w.order_number, pb.name, pb.image_urls, pb.status "
        f"FROM {SCHEMA}.pc_builds pb "
        f"JOIN {SCHEMA}.wip_builds w ON w.build_id = pb.id "
        f"WHERE pb.id = %s", (build_id,)
    )
    row = cur.fetchone()
    if not row:
        return
    _, for_sale, stage, onum, name, images, status = row
    if not for_sale or stage not in READY_TO_SELL_STAGES:
        return
    # Клиентские карточки не трогаем — они не для витрины
    if status not in ("draft", "catalog"):
        return

    имя_ок = bool((name or "").strip()) and not (name or "").strip().lower().startswith(("сборка", "заказ"))
    if имя_ок and (onum or "").strip().lower() == (name or "").strip().lower():
        имя_ок = False
    фото = images
    if isinstance(фото, str):
        try:
            фото = json.loads(фото)
        except (ValueError, TypeError):
            фото = [фото] if фото.strip() else []
    фото_ок = isinstance(фото, list) and any(str(u).strip() for u in фото)

    if имя_ок and фото_ок:
        cur.execute(
            f"UPDATE {SCHEMA}.pc_builds SET status='catalog', in_stock=TRUE WHERE id=%s",
            (build_id,)
        )


def _sync_wip_from_build(cur, build_id, components):
    """Если к pc_build привязана WIP-сборка — переносим названия комплектующих
    из components в текстовые поля WIP (cpu/gpu/ram/...), чтобы железо
    отображалось в «Сборках в процессе»."""
    if not build_id:
        return
    cur.execute(f"SELECT id FROM {SCHEMA}.wip_builds WHERE build_id = %s", (build_id,))
    rows = cur.fetchall()
    if not rows:
        return
    if isinstance(components, str):
        try:
            components = json.loads(components or "[]")
        except Exception:
            components = []
    slot_map = {"cpu": "", "motherboard": "", "ram": "", "gpu": "",
                "storage": "", "psu": "", "case_name": "", "cooling": ""}
    extras = []
    for c in (components or []):
        slot = c.get("slot")
        name = (c.get("name") or "").strip()
        if not name:
            continue
        key = "case_name" if slot == "case" else slot
        if key in slot_map:
            slot_map[key] = name
        else:
            extras.append(name)
    extra_val = ", ".join(extras)
    for r in rows:
        cur.execute(
            f"""UPDATE {SCHEMA}.wip_builds SET
                cpu=%s, motherboard=%s, ram=%s, gpu=%s, storage=%s,
                psu=%s, case_name=%s, cooling=%s, extra=%s, updated_at=NOW()
                WHERE id=%s""",
            (slot_map["cpu"], slot_map["motherboard"], slot_map["ram"], slot_map["gpu"],
             slot_map["storage"], slot_map["psu"], slot_map["case_name"], slot_map["cooling"],
             extra_val, r[0])
        )

def _get_price_map(cur, rows):
    """Собирает актуальные цены каталога (products.price) по всем source_id
    компонентов переданных сборок — одним запросом. Возвращает {product_id: price}."""
    ids = set()
    for r in rows:
        for c in (r[4] or []):
            sid = c.get("source_id") if isinstance(c, dict) else None
            if sid:
                ids.add(int(sid))
    if not ids:
        return {}
    ids_str = ",".join(str(i) for i in ids)
    cur.execute(f"SELECT id, price FROM {SCHEMA}.products WHERE id IN ({ids_str})")
    return {r[0]: (float(r[1]) if r[1] is not None else None) for r in cur.fetchall()}


def _enrich_components(components, lock_prices, price_map):
    """Подставляет current_price в компоненты. Если lock_prices=False —
    берём актуальную цену каталога (price_map), иначе оставляем зафиксированную
    price (current_price = price)."""
    out = []
    for c in (components or []):
        if not isinstance(c, dict):
            out.append(c); continue
        c = dict(c)
        sid = c.get("source_id")
        if not lock_prices and sid and price_map.get(int(sid)) is not None:
            c["current_price"] = price_map[int(sid)]
        else:
            c["current_price"] = c.get("price", 0)
        out.append(c)
    return out


def fmt_build(row, tags=None, reserved=False, price_map=None):
    lock_prices = row[19] if len(row) > 19 else False
    components = _enrich_components(row[4] or [], lock_prices, price_map or {})
    return {
        "id": row[0], "name": row[1], "description": row[2],
        "image_urls": row[3] or [],
        "components": components,
        "parts_total": float(row[5]) if row[5] else 0,
        "assembly_type": row[6],
        "assembly_fee": float(row[7]) if row[7] else 0,
        "total_price": float(row[8]) if row[8] else 0,
        "status": row[9],
        "is_featured": row[10],
        "sort_order": row[11],
        "created_at": row[12].isoformat() if row[12] else None,
        "client_token": row[13],
        "client_user_id": row[14],
        "parent_id": row[15],
        "in_stock": row[16] if len(row) > 16 else False,
        "sell_with_vat": row[17] if len(row) > 17 else False,
        "short_code": row[18] if len(row) > 18 else None,
        "lock_prices": lock_prices,
        "reserved": bool(reserved),
        "tags": tags or [],
        # SEO из вкладки «SEO» админки (пусто → фронт берёт автоматический).
        "slug": row[20] if len(row) > 20 else None,
        "meta_title": row[21] if len(row) > 21 else None,
        "meta_description": row[22] if len(row) > 22 else None,
    }


def get_reserved_build_ids(cur, build_ids):
    """Возвращает множество build_id, которые «в резерве»: сборка свободной
    продажи (for_sale=TRUE), у которой в заказе-затычке ЕСТЬ данные клиента
    (телефон заполнен и не '-', т.е. кто-то заказал через сайт)."""
    if not build_ids:
        return set()
    ids_str = ",".join(str(int(i)) for i in build_ids)
    cur.execute(
        f"SELECT DISTINCT wb.build_id FROM {SCHEMA}.wip_builds wb "
        f"JOIN {SCHEMA}.orders o ON o.id = wb.order_id "
        f"WHERE wb.build_id IN ({ids_str}) AND wb.for_sale = TRUE "
        f"AND wb.stage <> 'Забрали' "
        f"AND COALESCE(NULLIF(TRIM(o.customer_phone), ''), '-') <> '-' "
        f"AND o.status NOT IN ('cancelled','archived')"
    )
    return {r[0] for r in cur.fetchall()}


def gen_short_code(cur):
    """Уникальный короткий код из 6 символов (без похожих 0/O, 1/l/I)."""
    import random
    alphabet = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(20):
        code = "".join(random.choice(alphabet) for _ in range(6))
        cur.execute("SELECT 1 FROM pc_builds WHERE short_code = %s", (code,))
        if not cur.fetchone():
            return code
    return secrets.token_urlsafe(6)

def get_tags_for_builds(cur, build_ids):
    if not build_ids:
        return {}
    ids_str = ",".join(str(i) for i in build_ids)
    cur.execute(
        f"SELECT bt.build_id, t.id, t.name, t.color FROM build_tags bt JOIN tags t ON bt.tag_id = t.id WHERE bt.build_id IN ({ids_str})"
    )
    result = {}
    for build_id, tag_id, name, color in cur.fetchall():
        result.setdefault(build_id, []).append({"id": tag_id, "name": name, "color": color})
    return result

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
    Сборки ПК: GET список/одна, POST создать, PUT обновить, PATCH действие, DELETE удалить.
    Поддерживает фильтры: status, id, client_token, parent_id, user_id.
    PATCH actions: generate_client_link, claim.
    """
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")
    admin_token = headers.get("X-Admin-Token") or headers.get("x-admin-token")
    is_admin = bool(admin_token) and admin_token == os.environ.get("ADMIN_KEY")

    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "GET":
            build_id = params.get("id")
            client_token = params.get("client_token")
            short_code = params.get("short_code") or params.get("code")
            parent_id = params.get("parent_id")
            user_id = params.get("user_id")
            status = params.get("status")

            base = """SELECT id, name, description, image_urls, components, parts_total,
                             assembly_type, assembly_fee, total_price, status, is_featured,
                             sort_order, created_at, client_token, client_user_id, parent_id, in_stock,
                             sell_with_vat, short_code, lock_prices,
                             slug, meta_title, meta_description
                      FROM pc_builds"""

            if build_id:
                # По номеру и по читаемому адресу: старые ссылки продолжают
                # работать, новые красивые — тоже.
                if str(build_id).isdigit():
                    cur.execute(base + " WHERE id = %s", (int(build_id),))
                else:
                    cur.execute(base + " WHERE slug = %s", (str(build_id),))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                # Защита от прямого доступа к внутренним сборкам по числовому id.
                # Публично (без сессии) по голому id доступны ТОЛЬКО витринные сборки
                # каталога (status='catalog') и их варианты (корень = catalog).
                # Внутренние/клиентские/черновики открываются по client_token / short_code
                # или авторизованному админу (X-Session-Id). Иначе — 404.
                row_status = row[9]
                row_parent = row[15]
                if row_status != "catalog":
                    allowed = False
                    # вариант витринной сборки — проверяем статус корня
                    if row_parent:
                        cur.execute("SELECT status FROM pc_builds WHERE id = %s", (row_parent,))
                        pr = cur.fetchone()
                        if pr and pr[0] == "catalog":
                            allowed = True
                    # админ (X-Admin-Token) или авторизованный сотрудник видит любую сборку
                    if not allowed and (is_admin or get_user_by_session(cur, session_id)):
                        allowed = True
                    if not allowed:
                        return resp(404, {"error": "Не найдено"})
                tags_map = get_tags_for_builds(cur, [row[0]])
                reserved_ids = get_reserved_build_ids(cur, [row[0]])
                price_map = _get_price_map(cur, [row])
                return resp(200, fmt_build(row, tags_map.get(row[0], []), row[0] in reserved_ids, price_map))

            if client_token:
                cur.execute(base + " WHERE client_token = %s", (client_token,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                tags_map = get_tags_for_builds(cur, [row[0]])
                reserved_ids = get_reserved_build_ids(cur, [row[0]])
                price_map = _get_price_map(cur, [row])
                return resp(200, fmt_build(row, tags_map.get(row[0], []), row[0] in reserved_ids, price_map))

            if short_code:
                cur.execute(base + " WHERE short_code = %s", (short_code,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                tags_map = get_tags_for_builds(cur, [row[0]])
                reserved_ids = get_reserved_build_ids(cur, [row[0]])
                price_map = _get_price_map(cur, [row])
                return resp(200, fmt_build(row, tags_map.get(row[0], []), row[0] in reserved_ids, price_map))

            if parent_id:
                cur.execute(base + " WHERE parent_id = %s ORDER BY id", (parent_id,))
                rows = cur.fetchall()
                tags_map = get_tags_for_builds(cur, [r[0] for r in rows])
                price_map = _get_price_map(cur, rows)
                return resp(200, [fmt_build(r, tags_map.get(r[0], []), False, price_map) for r in rows])

            if user_id:
                cur.execute(base + " WHERE client_user_id = %s ORDER BY id DESC", (user_id,))
                rows = cur.fetchall()
                tags_map = get_tags_for_builds(cur, [r[0] for r in rows])
                price_map = _get_price_map(cur, rows)
                return resp(200, {"builds": [fmt_build(r, tags_map.get(r[0], []), False, price_map) for r in rows]})

            where = "WHERE status = %s" if status else ""
            args = [status] if status else []
            cur.execute(base + f" {where} ORDER BY sort_order ASC NULLS LAST, id DESC", args)
            rows = cur.fetchall()
            ids = [r[0] for r in rows]
            tags_map = get_tags_for_builds(cur, ids)
            reserved_ids = get_reserved_build_ids(cur, ids)
            price_map = _get_price_map(cur, rows)
            return resp(200, {"builds": [fmt_build(r, tags_map.get(r[0], []), r[0] in reserved_ids, price_map) for r in rows]})

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")
            action = body.get("action")

            if action == "from_wip":
                # Создать pc_build из WIP-сборки: автопоиск товаров по названию,
                # привязка через source_id (для работы склада/резервов).
                SCHEMA = "t_p72635010_quantum_fusion_resea"
                wip_id = body.get("wip_id")
                if not wip_id:
                    return resp(400, {"error": "Нет wip_id"})
                cur.execute(
                    f"SELECT order_number, cpu, motherboard, ram, gpu, storage, psu, "
                    f"case_name, cooling, extra, build_id FROM {SCHEMA}.wip_builds WHERE id = %s",
                    (wip_id,)
                )
                w = cur.fetchone()
                if not w:
                    return resp(404, {"error": "Сборка не найдена"})
                if w[10]:
                    return resp(400, {"error": "У сборки уже есть карточка в каталоге", "build_id": w[10]})

                # слот -> (значение, категория slug для уточнения поиска)
                slot_fields = [
                    ("cpu", w[1], "cpu"), ("motherboard", w[2], "motherboard"),
                    ("ram", w[3], "ram"), ("gpu", w[4], "gpu"),
                    ("storage", w[5], "storage"), ("psu", w[6], "psu"),
                    ("case", w[7], "case"), ("cooling", w[8], "cooling"),
                    ("extra", w[9], None),
                ]
                components = []
                matched, unmatched = 0, 0
                for slot, name, cat_slug in slot_fields:
                    if not name or not str(name).strip():
                        continue
                    name = str(name).strip()
                    # автопоиск товара по имени (точное совпадение без учёта регистра, иначе по вхождению)
                    cur.execute(
                        f"SELECT id, price FROM {SCHEMA}.products "
                        f"WHERE is_archived = FALSE AND LOWER(name) = LOWER(%s) LIMIT 1",
                        (name,)
                    )
                    pr = cur.fetchone()
                    if not pr:
                        cur.execute(
                            f"SELECT id, price FROM {SCHEMA}.products "
                            f"WHERE is_archived = FALSE AND LOWER(name) LIKE LOWER(%s) ORDER BY length(name) LIMIT 1",
                            ("%" + name + "%",)
                        )
                        pr = cur.fetchone()
                    if pr:
                        components.append({
                            "slot": slot, "name": name, "price": float(pr[1] or 0),
                            "source": "catalog", "source_id": pr[0], "qty": 1,
                        })
                        matched += 1
                    else:
                        components.append({
                            "slot": slot, "name": name, "price": 0,
                            "source": "custom", "qty": 1,
                        })
                        unmatched += 1

                parts_total = sum(c["price"] for c in components)
                cur.execute(
                    """INSERT INTO pc_builds (name, description, image_urls, components, parts_total,
                       assembly_type, assembly_fee, total_price, status, is_featured, in_stock,
                       created_at, sell_with_vat)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s) RETURNING id""",
                    (f"Сборка {w[0] or ''}".strip(), None, json.dumps([]),
                     json.dumps(components), parts_total, "percent", 0, parts_total,
                     "draft", False, False, False)
                )
                build_id = cur.fetchone()[0]
                cur.execute(f"UPDATE {SCHEMA}.wip_builds SET build_id = %s WHERE id = %s", (build_id, wip_id))
                conn.commit()
                return resp(201, {"id": build_id, "ok": True, "matched": matched, "unmatched": unmatched})

            if action == "cancel_order":
                import warehouse_core as wc
                SCHEMA = "t_p72635010_quantum_fusion_resea"
                wip_id = body.get("wip_id")
                if not wip_id:
                    return resp(400, {"error": "Нет wip_id"})
                cur.execute(f"SELECT order_id, build_id FROM {SCHEMA}.wip_builds WHERE id = %s", (wip_id,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Сборка не найдена"})
                order_id, build_id = row
                released = None
                if order_id:
                    # POSITIVE → возврат в наличие; NEGATIVE → снимаем только если ещё не заказано (NEW),
                    # заказанное у поставщика (ORDERED) остаётся в закупке и придёт в наличие
                    released = wc.release_order_reserves(cur, order_id, only_new_negative=True)
                    cur.execute(f"UPDATE {SCHEMA}.orders SET status='archived', updated_at=NOW() WHERE id=%s", (order_id,))
                if build_id:
                    cur.execute("UPDATE pc_builds SET status='archive' WHERE id=%s", (build_id,))
                cur.execute(f"DELETE FROM {SCHEMA}.wip_builds WHERE id=%s", (wip_id,))
                conn.commit()
                return resp(200, {"ok": True, "order_id": order_id, "released": released})

            cur.execute(
                """INSERT INTO pc_builds (name, description, image_urls, components, parts_total,
                   assembly_type, assembly_fee, total_price, status, is_featured, in_stock, sort_order, created_at, parent_id, sell_with_vat, lock_prices)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s, %s) RETURNING id""",
                (body.get("name", "Новая сборка"), body.get("description"),
                 json.dumps(body.get("image_urls", [])), json.dumps(body.get("components", [])),
                 body.get("parts_total", 0), body.get("assembly_type", "manual"),
                 body.get("assembly_fee", 0), body.get("total_price", 0),
                 body.get("status", "draft"), body.get("is_featured", False),
                 body.get("in_stock", False),
                 body.get("sort_order"), body.get("parent_id"),
                 body.get("sell_with_vat", False), body.get("lock_prices", False))
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return resp(201, {"id": new_id, "ok": True})

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            # parent_id и status НЕ обнуляем, если фронт их не прислал —
            # иначе вариация теряет связь с родителем (становится самостоятельной).
            # COALESCE(%s, <колонка>) оставляет прежнее значение при NULL.
            parent_id = body.get("parent_id") if "parent_id" in body else None
            status = body.get("status") if body.get("status") else None
            cur.execute(
                """UPDATE pc_builds SET name=%s, description=%s, image_urls=%s, components=%s,
                   parts_total=%s, assembly_type=%s, assembly_fee=%s, total_price=%s,
                   status=COALESCE(%s, status), is_featured=%s, in_stock=%s,
                   sort_order=COALESCE(%s, sort_order),
                   parent_id=COALESCE(%s, parent_id), sell_with_vat=%s, lock_prices=%s
                   WHERE id=%s""",
                (body.get("name"), body.get("description"),
                 json.dumps(body.get("image_urls", [])), json.dumps(body.get("components", [])),
                 body.get("parts_total", 0), body.get("assembly_type", "manual"),
                 body.get("assembly_fee", 0), body.get("total_price", 0),
                 status, body.get("is_featured", False),
                 body.get("in_stock", False),
                 body.get("sort_order"), parent_id,
                 body.get("sell_with_vat", False), body.get("lock_prices", False), body["id"])
            )
            _sync_wip_from_build(cur, body["id"], body.get("components", []))
            _rebuild_orders_from_build(cur, body["id"], body.get("components", []),
                                       body.get("assembly_fee", 0))
            _publish_if_card_ready(cur, body["id"])
            conn.commit()
            return resp(200, {"ok": True})

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            action = body.get("action")

            if action == "generate_client_link":
                # переиспользуем существующие токен/код, если уже есть
                cur.execute("SELECT client_token, short_code FROM pc_builds WHERE id=%s", (body["id"],))
                ex = cur.fetchone()
                token = (ex[0] if ex else None) or secrets.token_urlsafe(32)
                code = (ex[1] if ex else None) or gen_short_code(cur)
                cur.execute(
                    "UPDATE pc_builds SET client_token=%s, short_code=%s WHERE id=%s",
                    (token, code, body["id"])
                )
                conn.commit()
                return resp(200, {"ok": True, "client_token": token, "short_code": code})

            if action == "claim":
                user_id = get_user_by_session(cur, session_id)
                if not user_id:
                    return resp(401, {"error": "Не авторизован"})
                cur.execute(
                    "UPDATE pc_builds SET client_user_id=%s WHERE client_token=%s",
                    (user_id, body["client_token"])
                )
                conn.commit()
                return resp(200, {"ok": True})

            if action == "set_tags":
                build_id = body.get("id")
                tag_ids = body.get("tag_ids", [])
                cur.execute("DELETE FROM build_tags WHERE build_id=%s", (build_id,))
                for tag_id in tag_ids:
                    cur.execute("INSERT INTO build_tags (build_id, tag_id) VALUES (%s, %s)", (build_id, tag_id))
                conn.commit()
                return resp(200, {"ok": True})

            # Обычный PATCH — обновить отдельные поля
            build_id = body.get("id")
            allowed = ["name", "description", "status", "is_featured", "sort_order",
                       "assembly_fee", "assembly_type", "total_price", "components", "image_urls"]
            updates = {k: body[k] for k in allowed if k in body}
            if not updates or not build_id:
                return resp(400, {"error": "Нет данных для обновления"})
            set_parts = []
            values = []
            for k, v in updates.items():
                set_parts.append(f"{k}=%s")
                values.append(json.dumps(v) if isinstance(v, (list, dict)) else v)
            values.append(build_id)
            cur.execute(f"UPDATE pc_builds SET {', '.join(set_parts)} WHERE id=%s", values)
            if "components" in updates:
                _sync_wip_from_build(cur, build_id, updates["components"])
            conn.commit()
            return resp(200, {"ok": True})

        elif method == "DELETE":
            build_id = params.get("id")
            if not build_id:
                return resp(400, {"error": "Нет id"})
            cur.execute("DELETE FROM pc_builds WHERE id=%s", (build_id,))
            conn.commit()
            return resp(200, {"ok": True})

    finally:
        cur.close()
        conn.close()

    return resp(405, {"error": "Method not allowed"})