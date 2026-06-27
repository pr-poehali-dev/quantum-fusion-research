import json
import os
import psycopg2

SCHEMA = "t_p72635010_quantum_fusion_resea"

FIELDS = [
    "supplier_name", "supplier_person", "sign_name",
    "rs", "bank", "ks", "bik", "inn", "ogrnip",
    "city", "delivery_days",
]


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def handler(event: dict, context) -> dict:
    """Реквизиты поставщика для договора поставки: GET — чтение, POST — сохранение (admin)."""
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

    try:
        if method == "GET":
            cur.execute(
                f"SELECT {', '.join(FIELDS)} FROM {SCHEMA}.company_settings WHERE id = 1"
            )
            row = cur.fetchone()
            data = dict(zip(FIELDS, row)) if row else {f: "" for f in FIELDS}
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"settings": data}, default=str)}

        if method == "POST":
            headers = event.get("headers") or {}
            body = json.loads(event.get("body") or "{}")
            admin_key = headers.get("X-Admin-Key") or headers.get("x-admin-key") or body.get("ak")
            if not admin_key or admin_key != os.environ.get("ADMIN_KEY"):
                return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Нет доступа"})}

            sets, vals = [], []
            for f in FIELDS:
                if f in body:
                    sets.append(f"{f} = %s")
                    vals.append(body[f])
            if not sets:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нет полей"})}
            vals_q = ", ".join(sets)
            cur.execute(
                f"UPDATE {SCHEMA}.company_settings SET {vals_q}, updated_at = NOW() WHERE id = 1",
                vals,
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}
    finally:
        cur.close()
        conn.close()
