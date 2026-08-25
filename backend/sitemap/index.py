import os
import re

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
    ("/faq", "0.5", "monthly"),
    ("/promo", "0.7", "weekly"),
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


def _llms_txt():
    """Краткое описание сайта для ИИ-ассистентов + список статей.

    Нейросети охотнее цитируют источник, когда у него есть понятная
    сводка и прямые ссылки на материалы, а не только HTML-страницы.
    """
    conn = get_conn()
    cur = conn.cursor()
    lines = [
        "# BeGraphics",
        "",
        "> Мастерская и магазин компьютерной техники в Москве: сборка ПК на заказ, "
        "продажа комплектующих, ремонт и диагностика, стресс-тестирование готовых "
        "сборок с выдачей протокола.",
        "",
        "Основные разделы:",
        f"- [Каталог комплектующих]({SITE}/shop)",
        f"- [Готовые сборки ПК]({SITE}/builds)",
        f"- [Конфигуратор ПК]({SITE}/configurator)",
        f"- [Услуги сервиса]({SITE}/service)",
        f"- [Вопросы и ответы]({SITE}/faq)",
        f"- [Контакты]({SITE}/contacts)",
        "",
        "## Статьи и обзоры",
        "",
    ]
    cur.execute(
        f"SELECT title, slug, id, meta_description, excerpt FROM {SCHEMA}.articles "
        f"WHERE is_published ORDER BY created_at DESC LIMIT 200"
    )
    for title, slug, aid, meta, excerpt in cur.fetchall():
        note = (meta or excerpt or "")
        note = re.sub(r"<[^>]+>", " ", str(note))
        note = re.sub(r"\s+", " ", note).strip()[:200]
        lines.append(f"- [{title}]({SITE}/articles/{slug or aid})" + (f": {note}" if note else ""))

    # Вопрос-ответ из статей: готовые формулировки, которые ИИ может
    # процитировать напрямую как ответ на запрос пользователя.
    cur.execute(
        f"SELECT title, slug, id, faq FROM {SCHEMA}.articles "
        f"WHERE is_published AND faq IS NOT NULL AND jsonb_array_length(faq) > 0 "
        f"ORDER BY created_at DESC LIMIT 50"
    )
    faq_rows = cur.fetchall()
    if faq_rows:
        lines += ["", "## Частые вопросы", ""]
        for title, slug, aid, faq in faq_rows:
            items = faq if isinstance(faq, list) else []
            for it in items[:10]:
                q = str(it.get("q", "")).strip()
                a = re.sub(r"<[^>]+>", " ", str(it.get("a", "")))
                a = re.sub(r"\s+", " ", a).strip()
                if q and a:
                    lines.append(f"### {q}")
                    lines.append(a)
                    lines.append(f"Источник: {SITE}/articles/{slug or aid}")
                    lines.append("")
    cur.close()
    conn.close()
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=3600",
        },
        "isBase64Encoded": False,
        "body": "\n".join(lines),
    }


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

    # llms.txt — визитка сайта для ИИ-поисковиков (ChatGPT, Perplexity,
    # Яндекс-нейро). Формат простой: кто мы, чем занимаемся и ссылки на
    # материалы, которые можно цитировать. Отдаётся той же функцией:
    # /?format=llms
    params = event.get("queryStringParameters") or {}
    if params.get("format") == "llms":
        return _llms_txt()

    urls = [_url(loc, None, prio, freq) for loc, prio, freq in STATIC]

    conn = get_conn()
    cur = conn.cursor()

    # Статьи (только опубликованные).
    # В карту отдаём читаемый адрес (slug), если он задан в SEO-центре:
    # именно он считается основным, а числовой — лишь запасной вход.
    cur.execute(
        f"SELECT id, created_at, slug FROM {SCHEMA}.articles WHERE is_published ORDER BY id"
    )
    for row in cur.fetchall():
        lastmod = row[1].date().isoformat() if row[1] else None
        urls.append(_url(f"/articles/{row[2] or row[0]}", lastmod, "0.7", "monthly"))

    # Каталожные сборки (корневые, не клиентские)
    cur.execute(
        f"SELECT id, created_at, slug FROM {SCHEMA}.pc_builds "
        f"WHERE status = 'catalog' AND parent_id IS NULL ORDER BY id"
    )
    for row in cur.fetchall():
        lastmod = row[1].date().isoformat() if row[1] else None
        urls.append(_url(f"/build-preview/{row[2] or row[0]}", lastmod, "0.8", "weekly"))

    # Товары (архивные в карту не отдаём — их страницы не нужны в поиске)
    cur.execute(
        f"SELECT id, created_at, slug FROM {SCHEMA}.products "
        f"WHERE COALESCE(is_archived, FALSE) = FALSE ORDER BY id"
    )
    for row in cur.fetchall():
        lastmod = row[1].date().isoformat() if row[1] else None
        urls.append(_url(f"/product/{row[2] or row[0]}", lastmod, "0.6", "weekly"))

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