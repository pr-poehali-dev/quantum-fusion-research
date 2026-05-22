import json
import os
import psycopg2

SCHEMA = "t_p72635010_quantum_fusion_resea"

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def esc(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

def handler(event: dict, context) -> dict:
    """
    B2B прайс-лист для партнёров.
    GET / — список всех товаров с ценами розница/опт1/опт2 и остатком не в резерве.
    GET /?category=... — фильтр по категории.
    GET /?search=... — поиск по названию.
    Требует авторизацию (X-Session-Id) и роль admin или partner.
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")
    params = event.get("queryStringParameters") or {}

    conn = get_conn()
    cur = conn.cursor()

    try:
        # Проверка авторизации
        if not session_id:
            return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Требуется авторизация"})}

        cur.execute(
            f"SELECT u.id, u.role FROM {SCHEMA}.user_sessions s "
            f"JOIN {SCHEMA}.users u ON s.user_id = u.id "
            f"WHERE s.id = {esc(session_id)} AND s.expires_at > NOW()"
        )
        user = cur.fetchone()
        if not user:
            return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Сессия недействительна"})}

        role = user[1] or "user"
        if role not in ("admin", "partner"):
            return {"statusCode": 403, "headers": cors, "body": json.dumps({"error": "Доступ только для партнёров"})}

        # Фильтры
        category = params.get("category", "").strip()
        search = params.get("search", "").strip()

        where_parts = ["g.is_archived = false"]
        if category:
            where_parts.append(f"g.category = {esc(category)}")
        if search:
            where_parts.append(f"LOWER(g.name) LIKE LOWER({esc('%' + search + '%')})")

        where_sql = " AND ".join(where_parts)

        cur.execute(f"""
            SELECT
                g.id,
                g.name,
                g.sku,
                g.category,
                g.price_retail,
                g.price_opt1,
                g.price_opt2,
                g.warranty_months,
                COALESCE(SUM(m.qty_delta), 0) AS qty_total,
                COALESCE(
                    (SELECT SUM(m2.qty_delta) FROM {SCHEMA}.warehouse_movements m2
                     WHERE m2.group_id = g.id AND m2.type = 'reserve'), 0
                ) AS qty_reserved
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_movements m ON m.group_id = g.id
            WHERE {where_sql}
            GROUP BY g.id, g.name, g.sku, g.category, g.price_retail, g.price_opt1, g.price_opt2, g.warranty_months
            ORDER BY g.category, g.name
        """)

        rows = cur.fetchall()

        # Список уникальных категорий
        cur.execute(f"""
            SELECT DISTINCT g.category FROM {SCHEMA}.warehouse_groups g
            WHERE g.is_archived = false AND g.category IS NOT NULL
            ORDER BY g.category
        """)
        categories = [r[0] for r in cur.fetchall()]

        items = []
        for r in rows:
            qty_total = int(r[8]) if r[8] else 0
            qty_reserved = int(r[9]) if r[9] else 0
            qty_available = max(0, qty_total - qty_reserved)
            items.append({
                "id": r[0],
                "name": r[1],
                "sku": r[2],
                "category": r[3] or "",
                "price_retail": float(r[4]) if r[4] else 0,
                "price_opt1": float(r[5]) if r[5] else 0,
                "price_opt2": float(r[6]) if r[6] else 0,
                "warranty_months": r[7] or 12,
                "qty_available": qty_available,
            })

        return {"statusCode": 200, "headers": cors, "body": json.dumps({
            "items": items,
            "categories": categories,
            "total": len(items),
        })}

    finally:
        cur.close()
        conn.close()
