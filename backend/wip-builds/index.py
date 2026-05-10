import json
import os
import psycopg2

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
    "Готов, можно забрать", "Отнести в сдэк", "Забрали",
]

COMPONENT_STATUSES = ["pending", "ordered_delay", "ordered_transit", "ready", "need_order"]
# pending = не обработано
# need_order = надо заказать
# ordered_delay = заказано, проблемы со сроками
# ordered_transit = заказано, едет
# ready = в наличии / отложено

COMPONENT_FIELDS = ["cpu", "motherboard", "ram", "gpu", "storage", "psu", "case_name", "case", "cooling", "extra"]

def fmt_row(row):
    keys = [
        "id", "order_number", "stage", "contact", "delivery_type", "delivery_address",
        "received_at", "issued_at", "comment",
        "cpu", "motherboard", "ram", "gpu", "storage", "psu", "case_name", "cooling", "extra",
        "cpu_status", "motherboard_status", "ram_status", "gpu_status", "storage_status",
        "psu_status", "case_status", "cooling_status", "extra_status",
        "order_id", "created_at", "updated_at",
        "customer_name", "customer_phone", "total", "order_status",
        "client_token", "build_id",
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
    """
    Сборки в процессе (WIP): GET список/одна, POST создать, PUT обновить, PATCH обновить статус компонента или этап, DELETE удалить.
    
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
                       w.client_token, w.build_id
                FROM wip_builds w
                LEFT JOIN orders o ON w.order_id = o.id"""

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
                if field.replace("_status", "") not in COMPONENT_FIELDS:
                    return resp(400, {"error": "Неизвестный компонент"})
                cur.execute(f"UPDATE wip_builds SET {field}=%s, updated_at=NOW() WHERE id=%s", (body["status"], wip_id))
                conn.commit()
                return resp(200, {"ok": True})

            # Обновить этап
            if "stage" in body:
                # TODO: sync_crm(wip_id, body["stage"], contact)
                # Синхронизировать новый статус в CRM по API при смене этапа
                cur.execute("UPDATE wip_builds SET stage=%s, updated_at=NOW() WHERE id=%s", (body["stage"], wip_id))
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
            cur.execute("UPDATE wip_builds SET stage='Забрали', updated_at=NOW() WHERE id=%s", (wip_id,))
            conn.commit()
            return resp(200, {"ok": True})

    finally:
        cur.close()
        conn.close()

    return resp(405, {"error": "Method not allowed"})