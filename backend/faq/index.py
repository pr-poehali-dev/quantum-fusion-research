"""
FAQ: категории и вопросы-ответы. Публичный список для сайта (блок на главной)
и CRUD для админки. Ответ хранится как HTML (тот же формат, что у статей).
"""
import json
import os

import psycopg2

SCHEMA = "t_p72635010_quantum_fusion_resea"

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token, X-Session-Id",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
}


def _resp(status, body):
    return {"statusCode": status, "headers": CORS, "body": json.dumps(body, ensure_ascii=False, default=str)}


def handler(event: dict, context) -> dict:
    """Роутер: публичный FAQ для сайта + CRUD категорий/вопросов для админки."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    params = event.get("queryStringParameters") or {}
    action = params.get("action", "")
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            body = {}
    if not action:
        action = body.get("action", "")

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()

        # ─────────── ПУБЛИЧНЫЙ СПИСОК (сайт) ───────────
        if action in ("", "public") and method == "GET":
            # Категории с их опубликованными вопросами (без пустых категорий).
            cur.execute(
                f"SELECT c.id, c.name, c.icon, c.sort_order "
                f"FROM {SCHEMA}.faq_categories c "
                f"WHERE c.is_archived = FALSE ORDER BY c.sort_order, c.name"
            )
            cats = [{"id": r[0], "name": r[1], "icon": r[2], "sort_order": r[3], "items": []}
                    for r in cur.fetchall()]
            cat_by_id = {c["id"]: c for c in cats}

            cur.execute(
                f"SELECT id, category_id, question, answer, sort_order "
                f"FROM {SCHEMA}.faq_items "
                f"WHERE is_published = TRUE ORDER BY sort_order, id"
            )
            for r in cur.fetchall():
                c = cat_by_id.get(r[1])
                item = {"id": r[0], "category_id": r[1], "question": r[2],
                        "answer": r[3], "sort_order": r[4]}
                if c:
                    c["items"].append(item)
            # Отдаём только непустые категории
            result = [c for c in cats if c["items"]]
            return _resp(200, {"categories": result})

        # ─────────── КАТЕГОРИИ (админка) ───────────
        if action == "categories" and method == "GET":
            cur.execute(
                f"SELECT id, name, icon, sort_order, is_archived "
                f"FROM {SCHEMA}.faq_categories "
                f"WHERE is_archived = FALSE ORDER BY sort_order, name"
            )
            rows = [{"id": r[0], "name": r[1], "icon": r[2], "sort_order": r[3], "is_archived": r[4]}
                    for r in cur.fetchall()]
            return _resp(200, {"categories": rows})

        if action == "category_save" and method in ("POST", "PUT"):
            cid = body.get("id")
            if cid:
                cur.execute(
                    f"UPDATE {SCHEMA}.faq_categories SET name=%s, icon=%s, sort_order=%s WHERE id=%s",
                    (body.get("name"), body.get("icon") or "HelpCircle", int(body.get("sort_order", 0)), int(cid))
                )
            else:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.faq_categories (name, icon, sort_order) VALUES (%s, %s, %s) RETURNING id",
                    (body.get("name"), body.get("icon") or "HelpCircle", int(body.get("sort_order", 0)))
                )
                cid = cur.fetchone()[0]
            conn.commit()
            return _resp(200, {"ok": True, "id": cid})

        if action == "category_archive" and method in ("POST", "PUT", "DELETE"):
            cid = int(body.get("id") or params.get("id"))
            cur.execute(f"UPDATE {SCHEMA}.faq_categories SET is_archived=TRUE WHERE id=%s", (cid,))
            conn.commit()
            return _resp(200, {"ok": True})

        # ─────────── ВОПРОСЫ (админка) ───────────
        if action == "items" and method == "GET":
            cur.execute(
                f"SELECT i.id, i.category_id, i.question, i.answer, i.sort_order, "
                f"i.is_published, c.name "
                f"FROM {SCHEMA}.faq_items i "
                f"LEFT JOIN {SCHEMA}.faq_categories c ON c.id = i.category_id "
                f"ORDER BY i.sort_order, i.id"
            )
            rows = [{"id": r[0], "category_id": r[1], "question": r[2], "answer": r[3],
                     "sort_order": r[4], "is_published": r[5], "category_name": r[6]}
                    for r in cur.fetchall()]
            return _resp(200, {"items": rows})

        if action == "item_save" and method in ("POST", "PUT"):
            iid = body.get("id")
            cat = body.get("category_id")
            cat = int(cat) if cat not in (None, "", 0, "0") else None
            question = (body.get("question") or "").strip()
            answer = body.get("answer") or ""
            sort_order = int(body.get("sort_order", 0))
            is_published = bool(body.get("is_published", True))
            if not question:
                return _resp(400, {"error": "question_required"})
            if iid:
                cur.execute(
                    f"UPDATE {SCHEMA}.faq_items SET category_id=%s, question=%s, answer=%s, "
                    f"sort_order=%s, is_published=%s, updated_at=NOW() WHERE id=%s",
                    (cat, question, answer, sort_order, is_published, int(iid))
                )
            else:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.faq_items (category_id, question, answer, sort_order, is_published) "
                    f"VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (cat, question, answer, sort_order, is_published)
                )
                iid = cur.fetchone()[0]
            conn.commit()
            return _resp(200, {"ok": True, "id": iid})

        if action == "item_delete" and method in ("POST", "DELETE"):
            iid = int(body.get("id") or params.get("id"))
            cur.execute(f"DELETE FROM {SCHEMA}.faq_items WHERE id=%s", (iid,))
            conn.commit()
            return _resp(200, {"ok": True})

        return _resp(400, {"error": "unknown_action", "action": action})

    except Exception as e:
        conn.rollback()
        return _resp(500, {"error": str(e)})
    finally:
        conn.close()
