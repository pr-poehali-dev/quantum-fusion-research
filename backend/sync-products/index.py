"""
Синхронизация товаров из внешнего API и экспорт/импорт через Excel (base64).
POST { action: "sync", api_url, api_key } — тянет товары из внешнего API, добавляет новые
POST { action: "preview", api_url, api_key } — показывает первые 5 записей как есть (для отладки)
POST { action: "import", file_b64 } — импортирует товары из Excel (base64)
GET  — экспортирует все товары в Excel (base64)
"""
import json
import os
import base64
import urllib.request
import psycopg2

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def ok(body, status=200):
    return {"statusCode": status, "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False, default=str)}

def err(msg, status=400):
    return {"statusCode": status, "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"error": msg})}


def get_categories(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, name, slug FROM categories")
    rows = cur.fetchall()
    cur.close()
    by_name = {r[1].lower(): r[0] for r in rows}
    by_slug = {r[2].lower(): r[0] for r in rows}
    return by_name, by_slug


def clean_name(raw: str) -> str:
    """Берём только первую часть названия до '/', '\', '|' или скобок с подкатегорией."""
    for sep in [" / ", " | ", " \\ ", " - (", "  ("]:
        if sep in raw:
            raw = raw.split(sep)[0]
    return raw.strip()


def upsert_product(conn, p: dict, category_id):
    cur = conn.cursor()
    cur.execute("SELECT id FROM products WHERE name = %s", (p["name"],))
    row = cur.fetchone()
    image_urls = p.get("image_urls") or ([] if not p.get("image_url") else [p["image_url"]])
    image_url = p.get("image_url") or (image_urls[0] if image_urls else None)
    specs = p.get("specs") or {}
    if row:
        cur.execute("""
            UPDATE products SET price=%s, old_price=%s, in_stock=%s,
            image_url=COALESCE(%s, image_url),
            image_urls=CASE WHEN %s::jsonb != '[]'::jsonb THEN %s::jsonb ELSE image_urls END,
            specs=COALESCE(NULLIF(%s,'{}')::jsonb, specs),
            category_id=COALESCE(%s, category_id)
            WHERE id=%s
        """, (
            p["price"], p.get("old_price"), p.get("in_stock", True),
            image_url,
            json.dumps(image_urls), json.dumps(image_urls),
            json.dumps(specs),
            category_id, row[0]
        ))
        cur.close()
        return "updated", row[0]
    else:
        cur.execute("""
            INSERT INTO products (name, description, price, old_price, image_url, image_urls,
            specs, in_stock, is_featured, sort_order, category_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
        """, (
            p["name"], p.get("description", ""),
            p["price"], p.get("old_price"),
            image_url, json.dumps(image_urls), json.dumps(specs),
            p.get("in_stock", True), False, 0, category_id
        ))
        new_id = cur.fetchone()[0]
        cur.close()
        return "created", new_id


def fetch_api_items(api_url: str, api_key: str):
    if api_key:
        url = f"{api_url}?api_key={api_key}" if "?" not in api_url else f"{api_url}&api_key={api_key}"
    else:
        url = api_url
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    if isinstance(data, list):
        return data
    for key in ("items", "products", "data", "result", "goods"):
        if key in data and isinstance(data[key], list):
            return data[key]
    return []


def extract_product(item: dict) -> dict:
    """Извлекаем поля товара из произвольной структуры внешнего API."""
    # Название — берём только корневую часть
    raw_name = (
        item.get("name") or item.get("title") or
        item.get("product_name") or item.get("nomenclature") or ""
    )
    name = clean_name(str(raw_name))

    # Цена
    raw_price = item.get("price") or item.get("cost") or item.get("retail_price") or 0
    try:
        price = float(str(raw_price).replace(" ", "").replace(",", "."))
    except Exception:
        price = 0.0

    # Категория
    cat_raw = str(
        item.get("category") or item.get("type") or item.get("type_name") or
        item.get("category_name") or item.get("group") or ""
    ).lower().strip()

    # Фото
    image_url = item.get("image") or item.get("image_url") or item.get("photo") or item.get("img")
    image_urls = item.get("images") or item.get("image_urls") or item.get("photos") or []
    if not image_urls and image_url:
        image_urls = [image_url]

    # Наличие
    in_stock_raw = item.get("in_stock") if "in_stock" in item else item.get("available", item.get("qty", 1))
    if isinstance(in_stock_raw, bool):
        in_stock = in_stock_raw
    elif isinstance(in_stock_raw, (int, float)):
        in_stock = in_stock_raw > 0
    else:
        in_stock = str(in_stock_raw).lower() not in ("false", "0", "нет", "no", "out")

    # Характеристики
    specs = item.get("specs") or item.get("characteristics") or item.get("attributes") or {}
    if not isinstance(specs, dict):
        specs = {}

    return {
        "name": name,
        "price": price,
        "old_price": item.get("old_price") or item.get("price_old"),
        "description": item.get("description") or "",
        "image_url": image_url,
        "image_urls": image_urls,
        "in_stock": in_stock,
        "specs": specs,
        "_cat_raw": cat_raw,
    }


def sync_from_api(api_url: str, api_key: str, conn):
    items = fetch_api_items(api_url, api_key)
    cat_by_name, cat_by_slug = get_categories(conn)

    created, updated, skipped = 0, 0, 0
    details = []

    for item in items:
        p = extract_product(item)
        if not p["name"]:
            skipped += 1
            continue

        cat_raw = p.pop("_cat_raw", "")
        category_id = cat_by_name.get(cat_raw) or cat_by_slug.get(cat_raw)

        action, pid = upsert_product(conn, p, category_id)
        details.append({"id": pid, "name": p["name"], "action": action})
        if action == "created":
            created += 1
        else:
            updated += 1

    conn.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "total": len(items), "details": details}


def export_excel(conn) -> str:
    import io
    import openpyxl
    cur = conn.cursor()
    cur.execute("""
        SELECT p.name, p.price, p.old_price, p.description, p.in_stock, p.is_featured,
               p.sort_order, p.image_url, p.specs::text, c.name as cat_name
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        ORDER BY p.sort_order, p.id
    """)
    rows = cur.fetchall()
    cur.close()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Товары"
    ws.append(["Название", "Цена", "Старая цена", "Описание", "В наличии",
               "Рекомендуем", "Сортировка", "Фото URL", "Характеристики (JSON)", "Категория"])
    for r in rows:
        ws.append([
            r[0], float(r[1]) if r[1] else 0, float(r[2]) if r[2] else None,
            r[3] or "", "Да" if r[4] else "Нет", "Да" if r[5] else "Нет",
            r[6] or 0, r[7] or "", r[8] or "{}", r[9] or ""
        ])
    buf = io.BytesIO()
    wb.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


def import_excel(file_b64: str, conn) -> dict:
    import io
    import openpyxl
    data = base64.b64decode(file_b64)
    wb = openpyxl.load_workbook(io.BytesIO(data))
    ws = wb.active
    cat_by_name, cat_by_slug = get_categories(conn)
    created, updated, skipped = 0, 0, 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        name = str(row[0]).strip()
        if not name:
            skipped += 1
            continue
        try:
            price = float(str(row[1] or 0).replace(" ", "").replace(",", "."))
        except Exception:
            price = 0.0
        try:
            old_price = float(str(row[2]).replace(" ", "").replace(",", ".")) if row[2] else None
        except Exception:
            old_price = None
        in_stock = str(row[4] or "да").lower() not in ("нет", "no", "false", "0")
        image_url = str(row[7] or "").strip() or None
        try:
            specs = json.loads(str(row[8] or "{}"))
        except Exception:
            specs = {}
        cat_raw = str(row[9] or "").strip().lower()
        category_id = cat_by_name.get(cat_raw) or cat_by_slug.get(cat_raw)
        product = {
            "name": name, "price": price, "old_price": old_price,
            "description": str(row[3] or ""),
            "image_url": image_url,
            "image_urls": [image_url] if image_url else [],
            "in_stock": in_stock, "specs": specs,
        }
        action, _ = upsert_product(conn, product, category_id)
        if action == "created":
            created += 1
        else:
            updated += 1
    conn.commit()
    return {"created": created, "updated": updated, "skipped": skipped}


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    conn = get_conn()
    try:
        if event.get("httpMethod") == "GET":
            file_b64 = export_excel(conn)
            return ok({"file_b64": file_b64, "filename": "products.xlsx"})

        body = json.loads(event.get("body") or "{}")
        action = body.get("action")

        if action == "preview":
            api_url = body.get("api_url", "").strip()
            api_key = body.get("api_key", "").strip()
            items = fetch_api_items(api_url, api_key)
            sample = items[:3]
            parsed = [extract_product(i) for i in sample]
            return ok({"raw_sample": sample, "parsed_sample": parsed, "total_items": len(items)})

        if action == "sync":
            api_url = body.get("api_url", "").strip()
            api_key = body.get("api_key", "").strip()
            if not api_url:
                return err("api_url обязателен")
            result = sync_from_api(api_url, api_key, conn)
            return ok(result)

        if action == "import":
            file_b64 = body.get("file_b64", "")
            if not file_b64:
                return err("file_b64 обязателен")
            result = import_excel(file_b64, conn)
            return ok(result)

        return err("Неизвестное действие")
    finally:
        conn.close()
