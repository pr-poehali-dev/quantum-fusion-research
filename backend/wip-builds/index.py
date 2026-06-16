import json
import os
import psycopg2

import warehouse_core as core
# v7 - авто-этап + страховка резервов (ensure_order_reserves)

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
    return d

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
                       pb.components as build_components
                FROM wip_builds w
                LEFT JOIN orders o ON w.order_id = o.id
                LEFT JOIN pc_builds pb ON pb.id = w.build_id"""

    try:
        if method == "GET":
            wip_id = params.get("id")
            order_id = params.get("order_id")
            client_token = params.get("client_token")
            if wip_id:
                cur.execute(SELECT + " WHERE w.id = %s", (wip_id,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                return resp(200, fmt_row(row))
            if order_id:
                cur.execute(SELECT + " WHERE w.order_id = %s", (order_id,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                return resp(200, fmt_row(row))
            if client_token:
                cur.execute(SELECT + " WHERE w.client_token = %s", (client_token,))
                row = cur.fetchone()
                if not row:
                    return resp(404, {"error": "Не найдено"})
                return resp(200, fmt_row(row))
            cur.execute(SELECT + " ORDER BY w.id DESC")
            return resp(200, {"wip_builds": [fmt_row(r) for r in cur.fetchall()], "stages": STAGES})

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")

            # TODO: notify_telegram(wip_id, body.get("order_number"), body.get("contact"))
            # Отправить уведомление в Telegram при создании новой сборки

            cur.execute(
                """INSERT INTO wip_builds (order_number, stage, contact, delivery_type, delivery_address,
                   received_at, issued_at, comment,
                   cpu, motherboard, ram, gpu, storage, psu, case_name, cooling, extra,
                   order_id, updated_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
                   RETURNING id""",
                (
                    body.get("order_number", ""),
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
            return resp(201, {"id": new_id, "ok": True})

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                """UPDATE wip_builds SET order_number=%s, stage=%s, contact=%s,
                   delivery_type=%s, delivery_address=%s,
                   received_at=%s, issued_at=%s, comment=%s,
                   cpu=%s, motherboard=%s, ram=%s, gpu=%s, storage=%s,
                   psu=%s, case_name=%s, cooling=%s, extra=%s,
                   order_id=%s, updated_at=NOW()
                   WHERE id=%s""",
                (
                    body.get("order_number"), body.get("stage"), body.get("contact"),
                    body.get("delivery_type"), body.get("delivery_address"),
                    body.get("received_at") or None, body.get("issued_at") or None,
                    body.get("comment"),
                    body.get("cpu"), body.get("motherboard"), body.get("ram"), body.get("gpu"),
                    body.get("storage"), body.get("psu"), body.get("case_name"),
                    body.get("cooling"), body.get("extra"),
                    body.get("order_id"), body["id"],
                )
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
                        comps = pb[0] if isinstance(pb[0], list) else __import__('json').loads(pb[0])
                        slot_key = "case" if component == "case" else component
                        for c in comps:
                            if c.get("slot") == slot_key:
                                comp_qty = int(c.get("qty", 1))
                                break
                        # Находим supply по product_id компонента
                        product_id = None
                        for c in comps:
                            if c.get("slot") == slot_key and c.get("source_id"):
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
                        wc.handle_reserve_and_purchase(cur, wip_order_id, reserve_lines)
                        print(f"WIP {wip_id}: резерв 'Заказ', order={wip_order_id}, lines={len(reserve_lines)}")

                # ── Снятие резервов при отмене ──
                if new_stage == "Отменён" and old_stage != "Отменён" and wip_order_id:
                    import warehouse_core as wc
                    released = wc.release_order_reserves(cur, wip_order_id)
                    print(f"WIP {wip_id}: резервы сняты, order={wip_order_id}: {released}")

                # При "Забрали" или "Отменён" — переносим pc_build в архив
                if new_stage in ("Забрали", "Отменён"):
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