import json
import os
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def handler(event: dict, context) -> dict:
    """Управление товарами: GET список/детали, POST создать, PUT обновить, PATCH наличие"""
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
    }

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    path = event.get("path", "")
    path_parts = [p for p in path.split("/") if p]
    product_id = path_parts[-1] if len(path_parts) > 1 and path_parts[-1].isdigit() else None

    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "GET":
            if product_id:
                cur.execute(
                    """SELECT p.id, p.name, p.description, p.price, p.old_price,
                              p.image_url, p.specs, p.in_stock, p.is_featured,
                              p.sort_order, p.created_at,
                              c.id as cat_id, c.name as cat_name, c.slug as cat_slug
                       FROM products p LEFT JOIN categories c ON p.category_id = c.id
                       WHERE p.id = %s""",
                    (product_id,)
                )
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
                product = {
                    "id": row[0], "name": row[1], "description": row[2],
                    "price": float(row[3]), "old_price": float(row[4]) if row[4] else None,
                    "image_url": row[5], "specs": row[6] or {}, "in_stock": row[7],
                    "is_featured": row[8], "sort_order": row[9],
                    "created_at": row[10].isoformat() if row[10] else None,
                    "category": {"id": row[11], "name": row[12], "slug": row[13]} if row[11] else None
                }
                return {"statusCode": 200, "headers": cors, "body": json.dumps(product)}
            else:
                category_slug = params.get("category")
                featured = params.get("featured")
                search = params.get("search")
                where_clauses = []
                args = []
                if category_slug:
                    where_clauses.append("c.slug = %s")
                    args.append(category_slug)
                if featured == "true":
                    where_clauses.append("p.is_featured = TRUE")
                if search:
                    where_clauses.append("LOWER(p.name) LIKE %s")
                    args.append(f"%{search.lower()}%")
                where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
                cur.execute(
                    f"""SELECT p.id, p.name, p.description, p.price, p.old_price,
                               p.image_url, p.specs, p.in_stock, p.is_featured,
                               p.sort_order, p.created_at,
                               c.id as cat_id, c.name as cat_name, c.slug as cat_slug
                        FROM products p LEFT JOIN categories c ON p.category_id = c.id
                        {where_sql}
                        ORDER BY p.sort_order ASC, p.id ASC""",
                    args
                )
                rows = cur.fetchall()
                products = []
                for row in rows:
                    products.append({
                        "id": row[0], "name": row[1], "description": row[2],
                        "price": float(row[3]), "old_price": float(row[4]) if row[4] else None,
                        "image_url": row[5], "specs": row[6] or {}, "in_stock": row[7],
                        "is_featured": row[8], "sort_order": row[9],
                        "created_at": row[10].isoformat() if row[10] else None,
                        "category": {"id": row[11], "name": row[12], "slug": row[13]} if row[11] else None
                    })
                cur.execute("SELECT id, name, slug, description, sort_order FROM categories ORDER BY sort_order ASC")
                cats = [{"id": r[0], "name": r[1], "slug": r[2], "description": r[3], "sort_order": r[4]} for r in cur.fetchall()]
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"products": products, "categories": cats})}

        elif method == "POST":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                """INSERT INTO products (category_id, name, description, price, old_price, image_url, specs, in_stock, is_featured, sort_order, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()) RETURNING id""",
                (
                    body.get("category_id"), body["name"], body.get("description"),
                    body["price"], body.get("old_price"), body.get("image_url"),
                    json.dumps(body.get("specs", {})),
                    body.get("in_stock", True), body.get("is_featured", False),
                    body.get("sort_order", 0)
                )
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "ok": True})}

        elif method == "PUT":
            body = json.loads(event.get("body") or "{}")
            cur.execute(
                """UPDATE products SET category_id=%s, name=%s, description=%s, price=%s,
                   old_price=%s, image_url=%s, specs=%s, in_stock=%s, is_featured=%s, sort_order=%s
                   WHERE id=%s""",
                (
                    body.get("category_id"), body["name"], body.get("description"),
                    body["price"], body.get("old_price"), body.get("image_url"),
                    json.dumps(body.get("specs", {})),
                    body.get("in_stock", True), body.get("is_featured", False),
                    body.get("sort_order", 0), body["id"]
                )
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif method == "PATCH":
            body = json.loads(event.get("body") or "{}")
            cur.execute("UPDATE products SET in_stock=%s WHERE id=%s", (body["in_stock"], body["id"]))
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    finally:
        cur.close()
        conn.close()

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}
