"""
Промокоды: система скидок в корзине.

Публичное:
  GET  /                       — список публичных активных акций (для сайта)
  POST validate                — проверить промокод и посчитать скидку
                                 body: {code, items[], total, customer_phone?}
                                 (user_id берётся по X-Session-Id)
Админка (X-Admin-Key или ak в body):
  GET  action=list             — все промокоды
  POST action=save             — создать/обновить промокод
  POST action=delete           — удалить промокод (id)
  GET  action=categories       — категории для выбора (id, name)
"""
import json
import os

import psycopg2

from promo_logic import validate_and_calc

SCHEMA = "t_p72635010_quantum_fusion_resea"

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Id, X-Admin-Key",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
}


def _resp(status, body):
    return {"statusCode": status, "headers": CORS,
            "body": json.dumps(body, ensure_ascii=False, default=str)}


def _get_user(cur, session_id):
    if not session_id:
        return None
    cur.execute(
        f"SELECT u.id FROM {SCHEMA}.user_sessions s JOIN {SCHEMA}.users u "
        f"ON s.user_id = u.id WHERE s.id = %s AND s.expires_at > NOW()",
        (session_id,),
    )
    r = cur.fetchone()
    return r[0] if r else None


def _promo_row(r):
    return {
        "id": r[0], "code": r[1], "title": r[2], "description": r[3], "scope": r[4],
        "build_part": r[5], "category_ids": r[6] or [], "product_ids": r[7] or [],
        "combo_slots": r[8] or [], "discount_type": r[9], "discount_value": float(r[10]),
        "max_discount": float(r[11]) if r[11] is not None else None,
        "min_order_amount": float(r[12]), "max_uses": r[13], "used_count": r[14],
        "starts_at": r[15].isoformat() if r[15] else None,
        "expires_at": r[16].isoformat() if r[16] else None,
        "is_active": r[17], "is_public": r[18], "sort_order": r[19],
    }


PROMO_COLS = ("id, code, title, description, scope, build_part, category_ids, product_ids, "
              "combo_slots, discount_type, discount_value, max_discount, min_order_amount, "
              "max_uses, used_count, starts_at, expires_at, is_active, is_public, sort_order")


def handler(event: dict, context) -> dict:
    """Роутер промокодов: публичные акции, валидация в корзине, CRUD для админки."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            body = {}
    action = params.get("action") or body.get("action") or ""

    admin_key = (headers.get("X-Admin-Key") or headers.get("x-admin-key")
                 or body.get("ak") or params.get("ak"))
    is_admin = bool(admin_key) and admin_key == os.environ.get("ADMIN_KEY")

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()

        # ─────────── ПУБЛИЧНЫЕ АКЦИИ (сайт) ───────────
        if action in ("", "public") and method == "GET":
            cur.execute(
                f"SELECT {PROMO_COLS} FROM {SCHEMA}.promos "
                f"WHERE is_public = TRUE AND is_active = TRUE "
                f"AND (starts_at IS NULL OR starts_at <= NOW()) "
                f"AND (expires_at IS NULL OR expires_at >= NOW()) "
                f"AND (max_uses IS NULL OR used_count < max_uses) "
                f"ORDER BY sort_order, id DESC"
            )
            rows = [_promo_row(r) for r in cur.fetchall()]
            # Для публичной выдачи не раскрываем used_count/лимиты детально
            for p in rows:
                p.pop("used_count", None)
                p.pop("max_uses", None)
            return _resp(200, {"promos": rows})

        # ─────────── ВАЛИДАЦИЯ В КОРЗИНЕ ───────────
        if action == "validate" and method == "POST":
            code = (body.get("code") or "").strip()
            items = body.get("items") or []
            total = body.get("total")
            user_id = _get_user(cur, session_id)
            phone = (body.get("customer_phone") or "").strip() or None
            result = validate_and_calc(cur, SCHEMA, code, items, total,
                                       user_id=user_id, customer_phone=phone)
            return _resp(200, result)

        # ─────────── КАТЕГОРИИ (для выбора в админке) ───────────
        if action == "categories" and method == "GET":
            cur.execute(f"SELECT id, name FROM {SCHEMA}.categories ORDER BY sort_order, name")
            cats = [{"id": r[0], "name": r[1]} for r in cur.fetchall()]
            return _resp(200, {"categories": cats})

        # ─────────── АДМИНКА (требует ключ) ───────────
        if action in ("list", "save", "delete"):
            if not is_admin:
                return _resp(403, {"error": "forbidden"})

            if action == "list" and method == "GET":
                cur.execute(f"SELECT {PROMO_COLS} FROM {SCHEMA}.promos ORDER BY sort_order, id DESC")
                return _resp(200, {"promos": [_promo_row(r) for r in cur.fetchall()]})

            if action == "save" and method in ("POST", "PUT"):
                code = (body.get("code") or "").strip()
                if not code:
                    return _resp(400, {"error": "code_required"})
                fields = dict(
                    code=code,
                    title=(body.get("title") or "").strip() or None,
                    description=(body.get("description") or "").strip() or None,
                    scope=body.get("scope") or "cart",
                    build_part=body.get("build_part") or "all",
                    category_ids=json.dumps(body.get("category_ids") or []),
                    product_ids=json.dumps(body.get("product_ids") or []),
                    combo_slots=json.dumps(body.get("combo_slots") or []),
                    discount_type=body.get("discount_type") or "percent",
                    discount_value=float(body.get("discount_value") or 0),
                    max_discount=(float(body["max_discount"])
                                  if body.get("max_discount") not in (None, "", 0, "0") else None),
                    min_order_amount=float(body.get("min_order_amount") or 0),
                    max_uses=(int(body["max_uses"])
                              if body.get("max_uses") not in (None, "", 0, "0") else None),
                    starts_at=(body.get("starts_at") or None),
                    expires_at=(body.get("expires_at") or None),
                    is_active=bool(body.get("is_active", True)),
                    is_public=bool(body.get("is_public", False)),
                    sort_order=int(body.get("sort_order") or 0),
                )
                pid = body.get("id")
                # Уникальность кода
                cur.execute(
                    f"SELECT id FROM {SCHEMA}.promos WHERE LOWER(code)=LOWER(%s) AND id <> %s",
                    (code, int(pid) if pid else 0),
                )
                if cur.fetchone():
                    return _resp(400, {"error": "code_exists"})

                if pid:
                    cur.execute(
                        f"""UPDATE {SCHEMA}.promos SET code=%s, title=%s, description=%s, scope=%s,
                            build_part=%s, category_ids=%s, product_ids=%s, combo_slots=%s,
                            discount_type=%s, discount_value=%s, max_discount=%s, min_order_amount=%s,
                            max_uses=%s, starts_at=%s, expires_at=%s, is_active=%s, is_public=%s,
                            sort_order=%s, updated_at=NOW() WHERE id=%s""",
                        (fields["code"], fields["title"], fields["description"], fields["scope"],
                         fields["build_part"], fields["category_ids"], fields["product_ids"],
                         fields["combo_slots"], fields["discount_type"], fields["discount_value"],
                         fields["max_discount"], fields["min_order_amount"], fields["max_uses"],
                         fields["starts_at"], fields["expires_at"], fields["is_active"],
                         fields["is_public"], fields["sort_order"], int(pid)),
                    )
                else:
                    cur.execute(
                        f"""INSERT INTO {SCHEMA}.promos (code, title, description, scope, build_part,
                            category_ids, product_ids, combo_slots, discount_type, discount_value,
                            max_discount, min_order_amount, max_uses, starts_at, expires_at,
                            is_active, is_public, sort_order)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                        (fields["code"], fields["title"], fields["description"], fields["scope"],
                         fields["build_part"], fields["category_ids"], fields["product_ids"],
                         fields["combo_slots"], fields["discount_type"], fields["discount_value"],
                         fields["max_discount"], fields["min_order_amount"], fields["max_uses"],
                         fields["starts_at"], fields["expires_at"], fields["is_active"],
                         fields["is_public"], fields["sort_order"]),
                    )
                    pid = cur.fetchone()[0]
                conn.commit()
                return _resp(200, {"ok": True, "id": pid})

            if action == "delete" and method in ("POST", "DELETE"):
                pid = int(body.get("id") or params.get("id"))
                cur.execute(f"DELETE FROM {SCHEMA}.promos WHERE id=%s", (pid,))
                conn.commit()
                return _resp(200, {"ok": True})

        return _resp(400, {"error": "unknown_action", "action": action})

    except Exception as e:
        conn.rollback()
        return _resp(500, {"error": str(e)})
    finally:
        conn.close()
