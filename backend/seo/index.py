"""SEO-центр: сводка, автозаполнение по шаблону, выгрузка и загрузка CSV.

Один источник правды для мета-тегов всех публичных страниц: товары,
сборки ПК и статьи. Логика намеренно вся здесь, чтобы правило «как
формируется заголовок» не расползалось по фронтенду.
"""
import csv
import io
import json
import os
import re

import psycopg2

SCHEMA = "t_p72635010_quantum_fusion_resea"
SITE_URL = "https://begraphics.ru"

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
    "Access-Control-Max-Age": "86400",
}

# Границы, на которые ориентируются поисковики: длиннее — обрежут в выдаче.
TITLE_MAX = 60
DESC_MIN = 70
DESC_MAX = 160


def resp(code, data):
    return {"statusCode": code, "headers": {**cors, "Content-Type": "application/json"},
            "body": json.dumps(data, ensure_ascii=False, default=str)}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def esc(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slugify(text):
    """Человекочитаемый адрес: «Maxsun Z890 Vertex» → «maxsun-z890-vertex»."""
    s = str(text or "").lower()
    s = "".join(_TRANSLIT.get(ch, ch) for ch in s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = re.sub(r"-{2,}", "-", s)
    return s[:80] or ""


def strip_html(text):
    s = re.sub(r"<[^>]+>", " ", str(text or ""))
    s = s.replace("&nbsp;", " ").replace("&mdash;", "—").replace("&amp;", "&")
    return re.sub(r"\s+", " ", s).strip()


def clip(text, limit):
    """Обрезка по границе слова — обрубленное слово в выдаче выглядит плохо."""
    s = strip_html(text)
    if len(s) <= limit:
        return s
    cut = s[:limit]
    if " " in cut:
        cut = cut[:cut.rindex(" ")]
    return cut.rstrip(" ,.;:—-")


def money(v):
    try:
        return f"{int(round(float(v))):,}".replace(",", " ")
    except (TypeError, ValueError):
        return ""


# ── Шаблоны текстов ──────────────────────────────────────────────────────
# Товары идут массой и однотипны — шаблон закрывает их лучше нейросети:
# предсказуемо, мгновенно и бесплатно.

def product_title(name, category):
    base = f"{name} — купить в Москве"
    if len(base) <= TITLE_MAX:
        return base
    return clip(f"{name} купить", TITLE_MAX)


def product_desc(name, category, price, warranty, in_stock, description):
    parts = [f"{name}"]
    if category:
        parts[0] = f"{name} — {category.lower()}"
    if price:
        parts.append(f"цена {money(price)} ₽")
    parts.append("в наличии" if in_stock else "под заказ")
    if warranty:
        parts.append(f"гарантия {int(warranty)} мес")
    text = ", ".join(parts) + ". Доставка по России, самовывоз в Москве."
    # Если своё описание есть и оно осмысленное — оно ценнее шаблона.
    own = clip(description, DESC_MAX)
    if len(own) >= DESC_MIN:
        return own
    return clip(text, DESC_MAX)


def build_title(name):
    base = f"{name} — готовая сборка ПК"
    return base if len(base) <= TITLE_MAX else clip(name, TITLE_MAX)


def build_desc(name, price, description):
    own = clip(description, DESC_MAX)
    if len(own) >= DESC_MIN:
        return own
    text = f"Готовая сборка ПК «{name}»"
    if price:
        text += f" за {money(price)} ₽"
    text += ". Сборка, настройка и тестирование включены, гарантия на комплектующие."
    return clip(text, DESC_MAX)


def article_title(title):
    return clip(title, TITLE_MAX)


def article_desc(title, excerpt, content):
    for src in (excerpt, content):
        own = clip(src, DESC_MAX)
        if len(own) >= DESC_MIN:
            return own
    return clip(f"{strip_html(title)} — разбор от мастерской BeGraphics: опыт, тесты и практические выводы.", DESC_MAX)


def score_row(title, desc, slug):
    """Светофор: что не так с конкретной страницей, человеческим языком."""
    problems = []
    if not title:
        problems.append("нет заголовка")
    elif len(title) > TITLE_MAX:
        problems.append(f"заголовок длиннее {TITLE_MAX} символов")
    if not desc:
        problems.append("нет описания")
    elif len(desc) < DESC_MIN:
        problems.append("описание слишком короткое")
    elif len(desc) > DESC_MAX:
        problems.append(f"описание длиннее {DESC_MAX} символов")
    if not slug:
        problems.append("нет читаемого адреса")
    return problems


# ── Загрузка сущностей ───────────────────────────────────────────────────

def load_items(cur, kind):
    """Единый формат строки для всех типов — так фронт и CSV не ветвятся."""
    rows = []
    if kind in ("product", "all"):
        cur.execute(
            f"SELECT p.id, p.name, p.slug, p.meta_title, p.meta_description, "
            f"p.price, p.in_stock, p.warranty_months, p.description, c.name "
            f"FROM {SCHEMA}.products p "
            f"LEFT JOIN {SCHEMA}.categories c ON c.id = p.category_id "
            f"WHERE COALESCE(p.is_archived, FALSE) = FALSE ORDER BY p.id DESC"
        )
        for r in cur.fetchall():
            rows.append({
                "kind": "product", "id": r[0], "name": r[1] or "",
                "slug": r[2] or "", "meta_title": r[3] or "", "meta_description": r[4] or "",
                "url": f"/product/{r[2] or r[0]}",
                "suggest_title": product_title(r[1] or "", r[9]),
                "suggest_description": product_desc(r[1] or "", r[9], r[5], r[7], r[6], r[8]),
                "suggest_slug": slugify(r[1] or ""),
                "context": f"категория: {r[9] or '—'}; цена: {money(r[5])} ₽; гарантия: {r[7] or '—'} мес",
            })
    if kind in ("build", "all"):
        cur.execute(
            f"SELECT id, name, slug, meta_title, meta_description, total_price, description "
            f"FROM {SCHEMA}.pc_builds "
            f"WHERE status = 'catalog' AND parent_id IS NULL ORDER BY id DESC"
        )
        for r in cur.fetchall():
            rows.append({
                "kind": "build", "id": r[0], "name": r[1] or "",
                "slug": r[2] or "", "meta_title": r[3] or "", "meta_description": r[4] or "",
                "url": f"/build-preview/{r[2] or r[0]}",
                "suggest_title": build_title(r[1] or ""),
                "suggest_description": build_desc(r[1] or "", r[5], r[6]),
                "suggest_slug": slugify(r[1] or ""),
                "context": f"цена сборки: {money(r[5])} ₽; описание: {clip(r[6], 200) or '—'}",
            })
    if kind in ("article", "all"):
        cur.execute(
            f"SELECT id, title, slug, meta_title, meta_description, excerpt, content, is_published "
            f"FROM {SCHEMA}.articles ORDER BY id DESC"
        )
        for r in cur.fetchall():
            rows.append({
                "kind": "article", "id": r[0], "name": r[1] or "",
                "slug": r[2] or "", "meta_title": r[3] or "", "meta_description": r[4] or "",
                "url": f"/articles/{r[2] or r[0]}",
                "published": bool(r[7]),
                "suggest_title": article_title(r[1] or ""),
                "suggest_description": article_desc(r[1] or "", r[5], r[6]),
                "suggest_slug": slugify(r[1] or ""),
                "context": clip(r[5] or r[6], 400) or "—",
            })
    for row in rows:
        row["problems"] = score_row(row["meta_title"], row["meta_description"], row["slug"])
        row["ok"] = not row["problems"]
    return rows


TABLE_BY_KIND = {"product": "products", "build": "pc_builds", "article": "articles"}


def unique_slug(cur, table, slug, row_id):
    """Адрес должен быть уникальным: при совпадении дописываем номер."""
    if not slug:
        return ""
    base, n = slug, 2
    while True:
        cur.execute(
            f"SELECT 1 FROM {SCHEMA}.{table} WHERE slug = {esc(slug)} AND id <> {int(row_id)} LIMIT 1")
        if not cur.fetchone():
            return slug
        slug = f"{base}-{n}"
        n += 1
        if n > 50:
            return f"{base}-{row_id}"


def save_row(cur, kind, row_id, title, desc, slug):
    table = TABLE_BY_KIND.get(kind)
    if not table:
        return False
    sets = [f"meta_title = {esc(title)}", f"meta_description = {esc(desc)}"]
    if slug is not None:
        sets.append(f"slug = {esc(unique_slug(cur, table, slug, row_id))}")
    cur.execute(f"UPDATE {SCHEMA}.{table} SET {', '.join(sets)} WHERE id = {int(row_id)}")
    return True


# ── CSV ──────────────────────────────────────────────────────────────────
CSV_HEADER = ["kind", "id", "name", "url", "meta_title", "meta_description", "slug", "context"]


def to_csv(rows):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_ALL)
    w.writerow(CSV_HEADER)
    for r in rows:
        w.writerow([
            r["kind"], r["id"], r["name"], SITE_URL + r["url"],
            r["meta_title"] or r["suggest_title"],
            r["meta_description"] or r["suggest_description"],
            r["slug"] or r["suggest_slug"],
            r["context"],
        ])
    # BOM — иначе Excel открывает кириллицу кракозябрами.
    return "\ufeff" + buf.getvalue()


def parse_csv(text):
    """Разбор загруженного файла. Разделитель определяем сами: Excel в разных
    локалях сохраняет то «;», то «,» — заставлять пользователя следить за этим
    нельзя."""
    text = text.lstrip("\ufeff")
    sample = text[:2000]
    delim = ";" if sample.count(";") >= sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    out = []
    for raw in reader:
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items() if k}
        kind = row.get("kind") or row.get("тип")
        rid = row.get("id")
        if kind not in TABLE_BY_KIND or not str(rid).isdigit():
            continue
        out.append({
            "kind": kind, "id": int(rid),
            "meta_title": row.get("meta_title") or row.get("заголовок") or "",
            "meta_description": row.get("meta_description") or row.get("описание") or "",
            "slug": row.get("slug") or row.get("адрес") or "",
        })
    return out


def handler(event: dict, context) -> dict:
    """SEO-центр: сводка по страницам, автозаполнение, выгрузка и загрузка CSV."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except ValueError:
            body = {}

    admin_key = (headers.get("X-Admin-Key") or headers.get("x-admin-key")
                 or body.get("ak") or params.get("ak") or "")
    if admin_key != os.environ.get("ADMIN_KEY"):
        return resp(403, {"error": "Нет доступа"})

    action = body.get("action") or params.get("action") or "list"
    conn = get_conn()
    cur = conn.cursor()
    try:
        if action == "list":
            kind = params.get("kind") or "all"
            rows = load_items(cur, kind)
            stats = {}
            for k in ("product", "build", "article"):
                sub = [r for r in rows if r["kind"] == k]
                stats[k] = {"total": len(sub), "ok": sum(1 for r in sub if r["ok"])}
            return resp(200, {"items": rows, "stats": stats})

        if action == "export_csv":
            kind = body.get("kind") or params.get("kind") or "all"
            return resp(200, {"csv": to_csv(load_items(cur, kind)),
                              "filename": f"seo-{kind}.csv"})

        if action == "import_csv":
            rows = parse_csv(body.get("csv") or "")
            saved = 0
            for r in rows:
                if not r["meta_title"] and not r["meta_description"] and not r["slug"]:
                    continue
                save_row(cur, r["kind"], r["id"], r["meta_title"],
                         r["meta_description"], r["slug"] or None)
                saved += 1
            conn.commit()
            return resp(200, {"ok": True, "saved": saved, "found": len(rows)})

        if action == "autofill":
            # Заполняем только пустое: уже написанные вручную тексты ценнее
            # шаблонных и перетирать их нельзя.
            kind = body.get("kind") or "all"
            only_empty = body.get("only_empty", True)
            rows = load_items(cur, kind)
            saved = 0
            for r in rows:
                title = r["meta_title"] if (only_empty and r["meta_title"]) else r["suggest_title"]
                desc = r["meta_description"] if (only_empty and r["meta_description"]) else r["suggest_description"]
                slug = r["slug"] if (only_empty and r["slug"]) else r["suggest_slug"]
                if title == r["meta_title"] and desc == r["meta_description"] and slug == r["slug"]:
                    continue
                save_row(cur, r["kind"], r["id"], title, desc, slug)
                saved += 1
            conn.commit()
            return resp(200, {"ok": True, "saved": saved})

        if action == "save":
            save_row(cur, body.get("kind"), int(body.get("id") or 0),
                     body.get("meta_title") or "", body.get("meta_description") or "",
                     body.get("slug") if body.get("slug") is not None else None)
            conn.commit()
            return resp(200, {"ok": True})

        if action == "save_faq":
            # Блок «вопрос-ответ» статьи: его цитируют ИИ-поисковики и из него
            # собирается разметка FAQPage.
            faq = body.get("faq") or []
            clean = [{"q": str(i.get("q", "")).strip(), "a": str(i.get("a", "")).strip()}
                     for i in faq if str(i.get("q", "")).strip() and str(i.get("a", "")).strip()]
            cur.execute(
                f"UPDATE {SCHEMA}.articles SET faq = {esc(json.dumps(clean, ensure_ascii=False))}::jsonb "
                f"WHERE id = {int(body.get('id') or 0)}")
            conn.commit()
            return resp(200, {"ok": True, "count": len(clean)})

        return resp(400, {"error": "unknown action"})
    finally:
        cur.close()
        conn.close()
