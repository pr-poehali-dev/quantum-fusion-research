import json
import os
import secrets
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
}

def resp(status, data):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(data, ensure_ascii=False, default=str)}

SCHEMA = "t_p72635010_quantum_fusion_resea"


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

def fmt_build(row, tags=None, reserved=False):
    return {
        "id": row[0], "name": row[1], "description": row[2],
        "image_urls": row[3] or [],
        "components": row[4] or [],
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
        "reserved": bool(reserved),
        "tags": tags or [],
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
                             sell_with_vat, short_code
                      FROM pc_builds"""

            if build_id:
                cur.execute(base + " WHERE id = %s", (build_id,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                tags_map = get_tags_for_builds(cur, [row[0]])
                reserved_ids = get_reserved_build_ids(cur, [row[0]])
                return resp(200, fmt_build(row, tags_map.get(row[0], []), row[0] in reserved_ids))

            if client_token:
                cur.execute(base + " WHERE client_token = %s", (client_token,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                tags_map = get_tags_for_builds(cur, [row[0]])
                reserved_ids = get_reserved_build_ids(cur, [row[0]])
                return resp(200, fmt_build(row, tags_map.get(row[0], []), row[0] in reserved_ids))

            if short_code:
                cur.execute(base + " WHERE short_code = %s", (short_code,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                tags_map = get_tags_for_builds(cur, [row[0]])
                reserved_ids = get_reserved_build_ids(cur, [row[0]])
                return resp(200, fmt_build(row, tags_map.get(row[0], []), row[0] in reserved_ids))

            if parent_id:
                cur.execute(base + " WHERE parent_id = %s ORDER BY id", (parent_id,))
                rows = cur.fetchall()
                tags_map = get_tags_for_builds(cur, [r[0] for r in rows])
                return resp(200, [fmt_build(r, tags_map.get(r[0], [])) for r in rows])

            if user_id:
                cur.execute(base + " WHERE client_user_id = %s ORDER BY id DESC", (user_id,))
                rows = cur.fetchall()
                tags_map = get_tags_for_builds(cur, [r[0] for r in rows])
                return resp(200, {"builds": [fmt_build(r, tags_map.get(r[0], [])) for r in rows]})

            where = "WHERE status = %s" if status else ""
            args = [status] if status else []
            cur.execute(base + f" {where} ORDER BY sort_order ASC NULLS LAST, id DESC", args)
            rows = cur.fetchall()
            ids = [r[0] for r in rows]
            tags_map = get_tags_for_builds(cur, ids)
            reserved_ids = get_reserved_build_ids(cur, ids)
            return resp(200, {"builds": [fmt_build(r, tags_map.get(r[0], []), r[0] in reserved_ids) for r in rows]})

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
                   assembly_type, assembly_fee, total_price, status, is_featured, in_stock, sort_order, created_at, parent_id, sell_with_vat)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s) RETURNING id""",
                (body.get("name", "Новая сборка"), body.get("description"),
                 json.dumps(body.get("image_urls", [])), json.dumps(body.get("components", [])),
                 body.get("parts_total", 0), body.get("assembly_type", "manual"),
                 body.get("assembly_fee", 0), body.get("total_price", 0),
                 body.get("status", "draft"), body.get("is_featured", False),
                 body.get("in_stock", False),
                 body.get("sort_order"), body.get("parent_id"),
                 body.get("sell_with_vat", False))
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
                   parent_id=COALESCE(%s, parent_id), sell_with_vat=%s
                   WHERE id=%s""",
                (body.get("name"), body.get("description"),
                 json.dumps(body.get("image_urls", [])), json.dumps(body.get("components", [])),
                 body.get("parts_total", 0), body.get("assembly_type", "manual"),
                 body.get("assembly_fee", 0), body.get("total_price", 0),
                 status, body.get("is_featured", False),
                 body.get("in_stock", False),
                 body.get("sort_order"), parent_id,
                 body.get("sell_with_vat", False), body["id"])
            )
            _sync_wip_from_build(cur, body["id"], body.get("components", []))
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