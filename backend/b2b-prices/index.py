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

def check_b2b_password(pwd: str) -> bool:
    real = os.environ.get("B2B_PASSWORD", "").strip()
    return bool(real) and pwd.strip() == real

def handler(event: dict, context) -> dict:
    """
    B2B прайс-лист (публичный доступ, без авторизации аккаунта).
    GET / — список товаров с наличием и партномером. Цены показываются
            ТОЛЬКО при верном пароле (заголовок X-B2B-Password).
    GET /?category=... — фильтр по категории.
    GET /?search=... — поиск по названию, партномеру или SKU.
    GET /?action=check_password — проверка пароля (X-B2B-Password), возвращает {ok}.
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id, X-B2B-Password",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    headers = event.get("headers") or {}
    params = event.get("queryStringParameters") or {}
    # Регистронезависимое чтение заголовка пароля (прокси может менять регистр)
    lower_headers = {str(k).lower(): v for k, v in headers.items()}
    b2b_password = (lower_headers.get("x-b2b-password") or params.get("pwd") or "").strip()
    has_prices = check_b2b_password(b2b_password)

    # Эндпоинт проверки пароля (для логина на фронте)
    if params.get("action") == "check_password":
        return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": has_prices})}

    conn = get_conn()
    cur = conn.cursor()

    try:
        category = params.get("category", "").strip()
        search = params.get("search", "").strip()

        where_parts = ["g.is_archived = false"]
        if category:
            where_parts.append(f"g.category = {esc(category)}")
        if search:
            like = esc('%' + search + '%')
            where_parts.append(
                f"(LOWER(g.name) LIKE LOWER({like}) "
                f"OR LOWER(COALESCE(g.part_number, '')) LIKE LOWER({like}) "
                f"OR LOWER(COALESCE(g.sku, '')) LIKE LOWER({like}))"
            )

        where_sql = " AND ".join(where_parts)

        cur.execute(f"""
            SELECT
                g.id,
                g.name,
                g.sku,
                g.part_number,
                g.category,
                g.price_retail,
                g.price_opt1,
                g.price_opt2,
                g.warranty_months,
                COALESCE(SUM(s.qty), 0) AS qty_total
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE {where_sql}
            GROUP BY g.id, g.name, g.sku, g.part_number, g.category, g.price_retail, g.price_opt1, g.price_opt2, g.warranty_months
            ORDER BY g.category, g.name
        """)

        rows = cur.fetchall()

        cur.execute(f"""
            SELECT DISTINCT g.category FROM {SCHEMA}.warehouse_groups g
            WHERE g.is_archived = false AND g.category IS NOT NULL
            ORDER BY g.category
        """)
        categories = [r[0] for r in cur.fetchall()]

        items = []
        for r in rows:
            qty_available = max(0, int(r[9]) if r[9] else 0)
            item = {
                "id": r[0],
                "name": r[1],
                "sku": r[2],
                "part_number": r[3] or "",
                "category": r[4] or "",
                "warranty_months": r[8] or 12,
                "qty_available": qty_available,
            }
            if has_prices:
                item["price_retail"] = float(r[5]) if r[5] else 0
                item["price_opt1"] = float(r[6]) if r[6] else 0
                item["price_opt2"] = float(r[7]) if r[7] else 0
            items.append(item)

        return {"statusCode": 200, "headers": cors, "body": json.dumps({
            "items": items,
            "categories": categories,
            "total": len(items),
            "has_prices": has_prices,
        })}

    finally:
        cur.close()
        conn.close()