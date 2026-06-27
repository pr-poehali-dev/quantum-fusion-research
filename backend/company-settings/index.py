import json
import os
import psycopg2

SCHEMA = "t_p72635010_quantum_fusion_resea"

# Редактируемые поля юрлица
FIELDS = [
    "title", "supplier_name", "supplier_person", "sign_name",
    "rs", "bank", "ks", "bik", "inn", "ogrnip",
    "city", "delivery_days", "sort_order",
]
# Поля, возвращаемые в списке (+id, is_default)
OUT = ["id"] + FIELDS + ["is_default"]


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def row_to_dict(row):
    return dict(zip(OUT, row))


def handler(event: dict, context) -> dict:
    """Юрлица (реквизиты) для договора поставки: GET список, POST create/update/set_default/delete (admin)."""
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    conn = get_conn()
    cur = conn.cursor()
    cols = ", ".join(OUT)

    def ok(data):
        return {"statusCode": 200, "headers": cors, "body": json.dumps(data, default=str)}

    def err(msg, code=400):
        return {"statusCode": code, "headers": cors, "body": json.dumps({"error": msg})}

    try:
        if method == "GET":
            cur.execute(f"SELECT {cols} FROM {SCHEMA}.company_entities ORDER BY sort_order, id")
            items = [row_to_dict(r) for r in cur.fetchall()]
            return ok({"entities": items})

        if method == "POST":
            headers = event.get("headers") or {}
            body = json.loads(event.get("body") or "{}")
            admin_key = headers.get("X-Admin-Key") or headers.get("x-admin-key") or body.get("ak")
            if not admin_key or admin_key != os.environ.get("ADMIN_KEY"):
                return err("Нет доступа", 403)

            action = body.get("action", "")

            if action == "create":
                cur.execute(
                    f"INSERT INTO {SCHEMA}.company_entities (title) VALUES (%s) RETURNING {cols}",
                    (body.get("title") or "Новое юрлицо",),
                )
                entity = row_to_dict(cur.fetchone())
                conn.commit()
                return ok({"entity": entity, "ok": True})

            if action == "update":
                eid = int(body.get("id") or 0)
                sets, vals = [], []
                for f in FIELDS:
                    if f in body:
                        sets.append(f"{f} = %s")
                        vals.append(body[f])
                if not sets:
                    return err("Нет полей")
                vals.append(eid)
                cur.execute(
                    f"UPDATE {SCHEMA}.company_entities SET {', '.join(sets)}, updated_at = NOW() WHERE id = %s",
                    vals,
                )
                conn.commit()
                return ok({"ok": True})

            if action == "set_default":
                eid = int(body.get("id") or 0)
                cur.execute(f"UPDATE {SCHEMA}.company_entities SET is_default = FALSE")
                cur.execute(f"UPDATE {SCHEMA}.company_entities SET is_default = TRUE WHERE id = %s", (eid,))
                conn.commit()
                return ok({"ok": True})

            if action == "delete":
                eid = int(body.get("id") or 0)
                cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.company_entities")
                if (cur.fetchone()[0] or 0) <= 1:
                    return err("Нельзя удалить последнее юрлицо")
                cur.execute(f"DELETE FROM {SCHEMA}.company_entities WHERE id = %s", (eid,))
                conn.commit()
                return ok({"ok": True})

            return err("Неизвестное действие")

        return err("Method not allowed", 405)
    finally:
        cur.close()
        conn.close()
