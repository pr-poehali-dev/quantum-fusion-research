import os
import psycopg2

SITE = "https://begraphics.ru"
SCHEMA = os.environ.get("DB_SCHEMA", "t_p72635010_quantum_fusion_resea")

# Статические страницы сайта с приоритетами
STATIC = [
    ("/", "1.0", "daily"),
    ("/shop", "0.9", "daily"),
    ("/builds", "0.9", "daily"),
    ("/articles", "0.8", "weekly"),
    ("/configurator", "0.7", "weekly"),
    ("/tier-lists", "0.6", "weekly"),
    ("/cables", "0.5", "monthly"),
    ("/service", "0.6", "monthly"),
    ("/b2b", "0.5", "monthly"),
    ("/contacts", "0.4", "monthly"),
    ("/privacy", "0.2", "yearly"),
]


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _url(loc, lastmod=None, priority="0.5", changefreq="weekly"):
    parts = [f"<loc>{SITE}{loc}</loc>"]
    if lastmod:
        parts.append(f"<lastmod>{lastmod}</lastmod>")
    parts.append(f"<changefreq>{changefreq}</changefreq>")
    parts.append(f"<priority>{priority}</priority>")
    return "<url>" + "".join(parts) + "</url>"


def handler(event: dict, context) -> dict:
    """
    Карта сайта sitemap.xml для поисковых систем (Яндекс, Google).
    Собирает статические страницы + опубликованные статьи, каталожные
    сборки и товары из базы. Отдаёт XML.
    """
    if event.get("httpMethod") == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            "body": "",
        }

    urls = [_url(loc, None, prio, freq) for loc, prio, freq in STATIC]

    conn = get_conn()
    cur = conn.cursor()

    # Статьи (только опубликованные)
    cur.execute(
        f"SELECT id, created_at FROM {SCHEMA}.articles WHERE is_published ORDER BY id"
    )
    for row in cur.fetchall():
        lastmod = row[1].date().isoformat() if row[1] else None
        urls.append(_url(f"/articles/{row[0]}", lastmod, "0.7", "monthly"))

    # Каталожные сборки (корневые, не клиентские)
    cur.execute(
        f"SELECT id, created_at FROM {SCHEMA}.pc_builds "
        f"WHERE status = 'catalog' AND parent_id IS NULL ORDER BY id"
    )
    for row in cur.fetchall():
        lastmod = row[1].date().isoformat() if row[1] else None
        urls.append(_url(f"/build-preview/{row[0]}", lastmod, "0.8", "weekly"))

    # Товары
    cur.execute(
        f"SELECT id, created_at FROM {SCHEMA}.products ORDER BY id"
    )
    for row in cur.fetchall():
        lastmod = row[1].date().isoformat() if row[1] else None
        urls.append(_url(f"/product/{row[0]}", lastmod, "0.6", "weekly"))

    cur.close()
    conn.close()

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(urls)
        + "</urlset>"
    )

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/xml; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=3600",
        },
        "isBase64Encoded": False,
        "body": xml,
    }
