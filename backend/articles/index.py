import json
import os
import re
import psycopg2

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r'[а-яё]', lambda m: {
        'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z',
        'и':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
        'с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch',
        'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
    }.get(m.group(), ''), text)
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

def handler(event: dict, context) -> dict:
    """
    Статьи и тесты.
    GET  /            — список (params: category, limit, offset, published)
    GET  /?id=N       — одна статья
    POST /            — создать
    PUT  /            — обновить (body.id обязателен)
    DELETE /?id=N     — удалить
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    conn = get_conn()
    cur = conn.cursor()

    # Колонки: id, title, slug, excerpt, content, cover_url, category, is_published, sort_order, created_at, html_attachment, image_urls, views
    def row_to_article(row, full=False):
        image_urls = list(row[11]) if len(row) > 11 and row[11] else []
        # cover_url берём из image_urls[0] если есть, иначе из cover_url
        cover = image_urls[0] if image_urls else row[5]
        # categories — массив кодов; для совместимости category = первый элемент
        cats_raw = row[15] if len(row) > 15 else None
        cats = cats_raw if isinstance(cats_raw, list) else (json.loads(cats_raw) if cats_raw else [])
        if not cats and row[6]:
            cats = [row[6]]
        a = {
            "id": row[0], "title": row[1], "slug": row[2],
            "excerpt": row[3], "image_url": cover,
            "image_urls": image_urls,
            "category": cats[0] if cats else row[6],
            "categories": cats,
            "tags": [],
            "is_published": row[7],
            "views": row[12] if len(row) > 12 and row[12] is not None else 0,
            "created_at": row[9].isoformat() if row[9] else None,
            "updated_at": None,
        }
        if full:
            a["content"] = row[4]
            a["html_attachment"] = row[10] if len(row) > 10 else None
            toc = row[13] if len(row) > 13 else None
            a["toc"] = toc if isinstance(toc, list) else (json.loads(toc) if toc else [])
            tc = row[14] if len(row) > 14 else None
            a["tier_cards"] = tc if isinstance(tc, list) else (json.loads(tc) if tc else [])
        return a

    COLS = ("id, title, slug, excerpt, content, cover_url, category, "
            "is_published, sort_order, created_at, html_attachment, image_urls, views, toc, tier_cards, categories")

    if method == "GET":
        article_id = params.get("id")
        if article_id:
            # Считаем просмотр при открытии статьи (если не передан noview=1 —
            # например для предпросмотра в админке).
            if params.get("noview") != "1":
                cur.execute("UPDATE articles SET views = COALESCE(views, 0) + 1 WHERE id = %s", (article_id,))
                conn.commit()
            cur.execute(
                f"SELECT {COLS} FROM articles WHERE id = %s",
                (article_id,)
            )
            row = cur.fetchone()
            if not row:
                return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}
            return {"statusCode": 200, "headers": cors, "body": json.dumps(row_to_article(row, full=True))}
        else:
            where = []
            args = []
            published = params.get("published")
            if published == "true":
                where.append("is_published = true")
            category = params.get("category")
            if category:
                # Совпадение по массиву categories (JSONB contains) ИЛИ по старому
                # одиночному полю category — для статей без заполненного массива.
                where.append("(categories @> %s::jsonb OR category = %s)")
                args.append(json.dumps([category]))
                args.append(category)
            where_sql = ("WHERE " + " AND ".join(where)) if where else ""
            limit = int(params.get("limit", 20))
            offset = int(params.get("offset", 0))
            cur.execute(
                f"SELECT {COLS} FROM articles {where_sql} ORDER BY created_at DESC LIMIT %s OFFSET %s",
                args + [limit, offset]
            )
            rows = cur.fetchall()
            cur.execute(f"SELECT COUNT(*) FROM articles {where_sql}", args)
            total = cur.fetchone()[0]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"articles": [row_to_article(r) for r in rows], "total": total})}

    elif method == "POST":
        body = json.loads(event.get("body") or "{}")
        slug = body.get("slug") or slugify(body["title"]) or f"article-{os.urandom(4).hex()}"
        image_urls = body.get("image_urls") or []
        cover_url = image_urls[0] if image_urls else body.get("image_url")
        # categories — массив; если пуст, берём одиночную category
        cats = body.get("categories") or ([body["category"]] if body.get("category") else ["article"])
        main_cat = cats[0] if cats else "article"
        cur.execute(
            """INSERT INTO articles (title, slug, excerpt, content, cover_url, category, is_published, html_attachment, image_urls, toc, tier_cards, categories)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (body["title"], slug, body.get("excerpt"), body.get("content", ""),
             cover_url, main_cat,
             body.get("is_published", False),
             body.get("html_attachment") or None,
             image_urls, json.dumps(body.get("toc") or []),
             json.dumps(body.get("tier_cards") or []),
             json.dumps(cats))
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "slug": slug, "ok": True})}

    elif method == "PUT":
        body = json.loads(event.get("body") or "{}")
        slug = body.get("slug") or slugify(body["title"])
        image_urls = body.get("image_urls") or []
        cover_url = image_urls[0] if image_urls else body.get("image_url")
        cats = body.get("categories") or ([body["category"]] if body.get("category") else ["article"])
        main_cat = cats[0] if cats else "article"
        cur.execute(
            """UPDATE articles SET title=%s, slug=%s, excerpt=%s, content=%s, cover_url=%s,
               category=%s, is_published=%s, html_attachment=%s, image_urls=%s, toc=%s, tier_cards=%s, categories=%s WHERE id=%s""",
            (body["title"], slug, body.get("excerpt"), body.get("content", ""),
             cover_url, main_cat,
             body.get("is_published", False),
             body.get("html_attachment") or None,
             image_urls, json.dumps(body.get("toc") or []),
             json.dumps(body.get("tier_cards") or []),
             json.dumps(cats), body["id"])
        )
        conn.commit()
        return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    elif method == "DELETE":
        article_id = params.get("id")
        cur.execute("DELETE FROM articles WHERE id = %s", (article_id,))
        conn.commit()
        return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}