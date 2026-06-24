"""Мониторинг цен: приём данных от парсера + админ-обзор предложений.

Одна функция, два контура доступа:

1) ПАРСЕР (POST, заголовок X-Parser-Token == секрет PARSER_INGEST_TOKEN):
   action=ingest (по умолчанию для парсера) — принимает список изменений цен,
   кладёт в price_observations, матчит по названию с products,
   формирует price_suggestions (price_change / new_product).
   Рекомендованная цена = цена_конкурента * 0.93, округл. до 250 ₽.

2) АДМИН (заголовок X-Session-Id с ролью admin или X-Admin-Token=ADMIN_KEY):
   GET  ?action=list&kind=price_change|new_product — список новых предложений
   POST action=accept     {id}    — принять (проставить цену в товар)
   POST action=reject     {id}    — отклонить
   POST action=accept_all         — принять все price_change

Формат тела ingest:
{ "source":"DNS", "items":[
    {"name":"RTX 4070 Gigabyte","price":54990,"sku":"123","url":"https://...","in_stock":true}
]}
"""
import json
import os
import re
import psycopg2

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p72635010_quantum_fusion_resea")
ADMIN_PASSWORD = os.environ.get("ADMIN_KEY", "begraphics2024")

ROUND_STEP = 250          # шаг округления цены (₽)
MARKUP = 0.93             # цена конкурента минус 7%
MATCH_THRESHOLD = 0.45    # порог совпадения названия (0..1) для привязки к товару


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def esc(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def tokenize(s: str) -> set:
    """Нормализация названия в набор значимых токенов."""
    s = (s or "").lower()
    s = re.sub(r"[^a-zа-я0-9]+", " ", s)
    return {t for t in s.split() if len(t) >= 2}


def round_to_step(value: float) -> float:
    """Округление до ближайшего кратного 250 (…000/…250/…500/…750)."""
    return round(value / ROUND_STEP) * ROUND_STEP


def suggest_price(market_price: float) -> float:
    return float(round_to_step(market_price * MARKUP))


def require_admin(cur, session_id, admin_key=None):
    if admin_key and admin_key == ADMIN_PASSWORD:
        return -1
    if not session_id:
        return None
    cur.execute(
        f"SELECT u.id, u.role FROM {SCHEMA}.user_sessions s "
        f"JOIN {SCHEMA}.users u ON s.user_id = u.id "
        f"WHERE s.id = {esc(session_id)} AND s.expires_at > NOW()"
    )
    row = cur.fetchone()
    if row and row[1] == "admin":
        return row[0]
    return None


def handler(event: dict, context) -> dict:
    """Мониторинг цен: приём от парсера (X-Parser-Token) и админ-обзор (admin)."""
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id, X-Admin-Token, X-Parser-Token",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    def resp(data, status=200):
        return {"statusCode": status, "headers": cors, "body": json.dumps(data, default=str)}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    body = json.loads(event.get("body") or "{}")
    action = body.get("action") or params.get("action")

    parser_token = headers.get("X-Parser-Token") or headers.get("x-parser-token")
    expected_token = os.environ.get("PARSER_INGEST_TOKEN")

    conn = get_conn()
    cur = conn.cursor()

    # ===== Контур ПАРСЕРА (приём данных) =====
    if parser_token or action == "ingest":
        if not expected_token or parser_token != expected_token:
            cur.close(); conn.close()
            return resp({"error": "unauthorized"}, 401)
        if method != "POST":
            cur.close(); conn.close()
            return resp({"error": "method_not_allowed"}, 405)
        result = _ingest(cur, body)
        conn.commit(); cur.close(); conn.close()
        return resp(result)

    # ===== Контур АДМИНА =====
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")
    admin_key = (headers.get("X-Admin-Token") or headers.get("x-admin-token")
                 or body.get("admin_key") or params.get("admin_key"))
    if require_admin(cur, session_id, admin_key) is None:
        cur.close(); conn.close()
        return resp({"error": "forbidden"}, 403)

    if method == "GET":
        out = _list(cur, params.get("kind"))
        cur.close(); conn.close()
        return resp(out)

    if action == "accept":
        ok = _apply_price(cur, int(body.get("id")))
        conn.commit(); cur.close(); conn.close()
        return resp({"ok": ok})

    if action == "reject":
        cur.execute(
            f"UPDATE {SCHEMA}.price_suggestions SET status='rejected', decided_at=now() "
            f"WHERE id = {int(body.get('id'))} AND status='new'"
        )
        conn.commit(); cur.close(); conn.close()
        return resp({"ok": True})

    if action == "accept_all":
        cur.execute(
            f"SELECT id FROM {SCHEMA}.price_suggestions "
            f"WHERE status='new' AND kind='price_change'"
        )
        ids = [r[0] for r in cur.fetchall()]
        for sid in ids:
            _apply_price(cur, sid)
        conn.commit(); cur.close(); conn.close()
        return resp({"ok": True, "accepted": len(ids)})

    cur.close(); conn.close()
    return resp({"error": "unknown_action"}, 400)


def _ingest(cur, body: dict) -> dict:
    source_name = (body.get("source") or "").strip() or None
    items = body.get("items") or []
    if not isinstance(items, list) or not items:
        return {"error": "no_items"}

    source_id = None
    if source_name:
        cur.execute(f"SELECT id FROM {SCHEMA}.price_sources WHERE name = {esc(source_name)}")
        row = cur.fetchone()
        if row:
            source_id = row[0]
        else:
            cur.execute(
                f"INSERT INTO {SCHEMA}.price_sources (name) VALUES ({esc(source_name)}) RETURNING id"
            )
            source_id = cur.fetchone()[0]

    cur.execute(f"SELECT id, name, price FROM {SCHEMA}.products WHERE is_archived = FALSE")
    catalog = [(r[0], r[1], float(r[2]), tokenize(r[1])) for r in cur.fetchall()]

    created_suggestions = 0
    new_products = 0
    processed = 0

    for it in items:
        name = (it.get("name") or "").strip()
        price = it.get("price")
        if not name or price is None:
            continue
        try:
            price = float(price)
        except (TypeError, ValueError):
            continue
        sku = (it.get("sku") or "").strip() or None
        url = (it.get("url") or "").strip() or None
        in_stock = it.get("in_stock")

        ext_tokens = tokenize(name)
        best = None  # (score, id, price)
        for pid, _pname, pprice, ptokens in catalog:
            if not ext_tokens or not ptokens:
                continue
            inter = len(ext_tokens & ptokens)
            if inter == 0:
                continue
            score = inter / len(ext_tokens | ptokens)
            if best is None or score > best[0]:
                best = (score, pid, pprice)

        matched_id = None
        match_score = None
        current_price = None
        if best and best[0] >= MATCH_THRESHOLD:
            matched_id = best[1]
            current_price = best[2]
            match_score = round(best[0] * 100, 2)

        cur.execute(
            f"""
            INSERT INTO {SCHEMA}.price_observations
                (source_id, source_name, ext_name, ext_sku, price, in_stock, url,
                 matched_product_id, match_score)
            VALUES ({esc(source_id)},{esc(source_name)},{esc(name)},{esc(sku)},
                    {float(price)},{esc(in_stock)},{esc(url)},
                    {esc(matched_id)},{esc(match_score)})
            RETURNING id
            """
        )
        obs_id = cur.fetchone()[0]
        processed += 1

        sugg_price = suggest_price(price)
        if matched_id:
            cur.execute(
                f"SELECT id FROM {SCHEMA}.price_suggestions "
                f"WHERE product_id = {int(matched_id)} AND status = 'new'"
            )
            existing = cur.fetchone()
            if existing:
                cur.execute(
                    f"""
                    UPDATE {SCHEMA}.price_suggestions
                    SET observation_id={int(obs_id)}, source_name={esc(source_name)},
                        ext_name={esc(name)}, ext_url={esc(url)}, market_price={float(price)},
                        current_price={esc(current_price)}, suggested_price={float(sugg_price)},
                        created_at=now()
                    WHERE id={int(existing[0])}
                    """
                )
            else:
                cur.execute(
                    f"""
                    INSERT INTO {SCHEMA}.price_suggestions
                        (kind, observation_id, product_id, source_name, ext_name, ext_url,
                         market_price, current_price, suggested_price)
                    VALUES ('price_change',{int(obs_id)},{int(matched_id)},{esc(source_name)},
                            {esc(name)},{esc(url)},{float(price)},{esc(current_price)},{float(sugg_price)})
                    """
                )
                created_suggestions += 1
        else:
            cur.execute(
                f"""
                INSERT INTO {SCHEMA}.price_suggestions
                    (kind, observation_id, source_name, ext_name, ext_url,
                     market_price, suggested_price)
                VALUES ('new_product',{int(obs_id)},{esc(source_name)},{esc(name)},
                        {esc(url)},{float(price)},{float(sugg_price)})
                """
            )
            new_products += 1

    return {
        "ok": True,
        "processed": processed,
        "price_changes": created_suggestions,
        "new_products": new_products,
    }


def _list(cur, kind=None) -> dict:
    where = "s.status = 'new'"
    if kind in ("price_change", "new_product"):
        where += f" AND s.kind = '{kind}'"
    cur.execute(
        f"""
        SELECT s.id, s.kind, s.product_id, s.source_name, s.ext_name, s.ext_url,
               s.market_price, s.current_price, s.suggested_price, p.name, s.created_at
        FROM {SCHEMA}.price_suggestions s
        LEFT JOIN {SCHEMA}.products p ON p.id = s.product_id
        WHERE {where}
        ORDER BY s.created_at DESC
        """
    )
    items = []
    for r in cur.fetchall():
        items.append({
            "id": r[0], "kind": r[1], "product_id": r[2],
            "source_name": r[3], "ext_name": r[4], "ext_url": r[5],
            "market_price": float(r[6]) if r[6] is not None else None,
            "current_price": float(r[7]) if r[7] is not None else None,
            "suggested_price": float(r[8]) if r[8] is not None else None,
            "product_name": r[9],
            "created_at": r[10].isoformat() if r[10] else None,
        })
    cur.execute(
        f"SELECT kind, COUNT(*) FROM {SCHEMA}.price_suggestions "
        f"WHERE status='new' GROUP BY kind"
    )
    counts = {r[0]: r[1] for r in cur.fetchall()}
    return {"items": items, "counts": counts}


def _apply_price(cur, sugg_id: int) -> bool:
    """Проставляет рекомендованную цену в товар и закрывает предложение."""
    cur.execute(
        f"SELECT product_id, suggested_price, kind FROM {SCHEMA}.price_suggestions "
        f"WHERE id = {int(sugg_id)} AND status = 'new'"
    )
    row = cur.fetchone()
    if not row:
        return False
    product_id, suggested_price, kind = row
    if kind == "price_change" and product_id and suggested_price is not None:
        cur.execute(
            f"UPDATE {SCHEMA}.products SET price = {float(suggested_price)} "
            f"WHERE id = {int(product_id)}"
        )
    cur.execute(
        f"UPDATE {SCHEMA}.price_suggestions SET status='accepted', decided_at=now() "
        f"WHERE id = {int(sugg_id)}"
    )
    return True
