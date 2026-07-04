"""Мониторинг цен: приём данных от парсера + админ-обзор предложений.

Одна функция, два контура доступа:

1) ПАРСЕР (POST, заголовок X-Parser-Token == секрет PARSER_INGEST_TOKEN):
   action=ingest (по умолчанию для парсера) — принимает список изменений цен,
   кладёт в price_observations, матчит по названию с products,
   формирует price_suggestions (price_change / new_product).
   Рекомендованная цена = цена_конкурента * 0.93, округл. до 250 ₽.

2) АДМИН (заголовок X-Session-Id с ролью admin или X-Admin-Token=ADMIN_KEY):
   GET  ?action=list&kind=price_change|new_product — список новых предложений
   GET  ?action=match&id=NN (или &q=название) — кандидаты каталога с % похожести
   POST action=link_product {id, product_id} — привязать new_product к товару
   POST action=accept   {id, final_price?, with_vat?, product_id?} — принять:
        проставить цену в товар + склад (price_retail, история) + пересчёт сборок
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
import html
import psycopg2

try:
    from tg_notify import notify_price
except Exception:  # на всякий случай не роняем основной поток
    def notify_price(text: str) -> bool:  # type: ignore
        return False

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

    if action == "match":
        out = _match_candidates(cur, params.get("q") or params.get("name"),
                                params.get("id"))
        cur.close(); conn.close()
        return resp(out)

    if action == "link_product":
        out = _link_product(cur, int(body.get("id")), int(body.get("product_id")))
        conn.commit(); cur.close(); conn.close()
        return resp(out)

    if action == "accept":
        # Расширенный accept: ручная цена (final_price), НДС (with_vat),
        # привязка к товару (product_id) для new_product. Всё опционально —
        # без параметров работает как раньше (берёт suggested_price).
        out = _apply_price(
            cur, int(body.get("id")),
            final_price=body.get("final_price"),
            with_vat=body.get("with_vat"),
            product_id=body.get("product_id"),
        )
        conn.commit(); cur.close(); conn.close()
        return resp(out if isinstance(out, dict) else {"ok": out})

    if action == "reject":
        cur.execute(
            f"UPDATE {SCHEMA}.price_suggestions SET status='rejected', decided_at=now() "
            f"WHERE id = {int(body.get('id'))} AND status='new'"
        )
        conn.commit(); cur.close(); conn.close()
        return resp({"ok": True})

    if action == "reject_all":
        # отклонить все 'new' предложения; опц. фильтр по kind (price_change|new_product)
        kind = body.get("kind") or params.get("kind")
        where = "status='new'"
        if kind in ("price_change", "new_product"):
            where += f" AND kind='{kind}'"
        cur.execute(
            f"UPDATE {SCHEMA}.price_suggestions SET status='rejected', decided_at=now() "
            f"WHERE {where}"
        )
        n = cur.rowcount
        conn.commit(); cur.close(); conn.close()
        return resp({"ok": True, "rejected": n})

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
    # накапливаем детали для Telegram-сводки
    tg_drops = []   # (name, current, market) — рынок ниже нашей цены (можно снижать)
    tg_ups = []     # (name, current, market) — рынок выше нашей цены
    tg_new = []     # (name, market)

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
            # Если рекомендованная цена совпадает с нашей текущей — предлагать нечего.
            # Пропускаем и подчищаем ранее созданное 'new'-предложение по этому товару.
            if current_price is not None and round(float(sugg_price)) == round(float(current_price)):
                cur.execute(
                    f"UPDATE {SCHEMA}.price_suggestions SET status='rejected', decided_at=now() "
                    f"WHERE product_id = {int(matched_id)} AND status = 'new' AND kind = 'price_change'"
                )
                continue
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
                disp_name = _pname_by_id(catalog, matched_id) or name
                if current_price is not None and price < current_price:
                    tg_drops.append((disp_name, current_price, price))
                elif current_price is not None and price > current_price:
                    tg_ups.append((disp_name, current_price, price))
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
            tg_new.append((name, price))

    # Telegram-сводка только если реально есть изменения (иначе тихий прогон)
    if tg_drops or tg_ups or tg_new:
        _send_summary(source_name, tg_drops, tg_ups, tg_new)

    return {
        "ok": True,
        "processed": processed,
        "price_changes": created_suggestions,
        "new_products": new_products,
    }


def _pname_by_id(catalog, pid):
    for cid, cname, _cprice, _ctok in catalog:
        if cid == pid:
            return cname
    return None


def _send_summary(source_name, drops, ups, news):
    """Короткая сводка в Telegram по итогам ingest."""
    def money(v):
        return f"{int(round(v)):,}".replace(",", " ") + " ₽"

    src = html.escape(source_name or "парсер")
    lines = [f"<b>📊 Мониторинг цен · {src}</b>"]
    total = len(drops) + len(ups) + len(news)
    lines.append(f"Новых сигналов: <b>{total}</b>")

    if drops:
        lines.append(f"\n🔻 <b>Рынок ниже нас ({len(drops)})</b>")
        for name, cur_p, mkt in drops[:10]:
            lines.append(f"• {html.escape(name)}: {money(cur_p)} → {money(mkt)}")
        if len(drops) > 10:
            lines.append(f"…и ещё {len(drops) - 10}")

    if ups:
        lines.append(f"\n🔺 <b>Рынок выше нас ({len(ups)})</b>")
        for name, cur_p, mkt in ups[:5]:
            lines.append(f"• {html.escape(name)}: {money(cur_p)} → {money(mkt)}")
        if len(ups) > 5:
            lines.append(f"…и ещё {len(ups) - 5}")

    if news:
        lines.append(f"\n✨ <b>Новые товары ({len(news)})</b>")
        for name, mkt in news[:10]:
            lines.append(f"• {html.escape(name)}: {money(mkt)}")
        if len(news) > 10:
            lines.append(f"…и ещё {len(news) - 10}")

    lines.append("\nОткрой админку → «Цены от парсера», чтобы обработать.")
    notify_price("\n".join(lines))


def _list(cur, kind=None) -> dict:
    where = "s.status = 'new'"
    if kind in ("price_change", "new_product"):
        where += f" AND s.kind = '{kind}'"
    cur.execute(
        f"""
        SELECT s.id, s.kind, s.product_id, s.source_name, s.ext_name, s.ext_url,
               s.market_price, s.current_price, s.suggested_price, p.name, s.created_at,
               o.ext_sku, o.match_score
        FROM {SCHEMA}.price_suggestions s
        LEFT JOIN {SCHEMA}.products p ON p.id = s.product_id
        LEFT JOIN {SCHEMA}.price_observations o ON o.id = s.observation_id
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
            "ext_sku": r[11],
            "match_score": float(r[12]) if r[12] is not None else None,
        })
    cur.execute(
        f"SELECT kind, COUNT(*) FROM {SCHEMA}.price_suggestions "
        f"WHERE status='new' GROUP BY kind"
    )
    counts = {r[0]: r[1] for r in cur.fetchall()}
    return {"items": items, "counts": counts}


def _apply_vat_price(base: float) -> float:
    """Розничная цена с НДС: +22% и округление ВВЕРХ до 250 ₽ (как на складе)."""
    import math
    return float(math.ceil(base * 1.22 / 250.0) * 250)


def _apply_price(cur, sugg_id: int, final_price=None, with_vat=None,
                 product_id=None) -> dict:
    """Принимает предложение и проставляет цену в товар.

    final_price  — ручная цена; если None, берём suggested_price из предложения.
    with_vat     — если True, к цене применяется НДС (+22%, округл. вверх до 250).
    product_id   — для new_product: к какому товару каталога привязать (если ещё нет).

    Обновляет: products.price, связанную warehouse_groups.price_retail,
    пишет запись в warehouse_price_history и пересчитывает незафиксированные сборки.
    """
    cur.execute(
        f"SELECT product_id, suggested_price, kind FROM {SCHEMA}.price_suggestions "
        f"WHERE id = {int(sugg_id)} AND status = 'new'"
    )
    row = cur.fetchone()
    if not row:
        return {"ok": False, "error": "not_found"}
    sugg_pid, suggested_price, kind = row

    # к какому товару применяем цену
    target_pid = product_id or sugg_pid
    if product_id and not sugg_pid:
        # привязка нового товара к каталогу прямо при accept
        cur.execute(
            f"UPDATE {SCHEMA}.price_suggestions SET product_id = {int(product_id)} "
            f"WHERE id = {int(sugg_id)}"
        )

    # итоговая цена
    price = final_price if final_price is not None else suggested_price
    if price is None:
        # закрываем предложение без изменения цены (например new_product без привязки)
        cur.execute(
            f"UPDATE {SCHEMA}.price_suggestions SET status='accepted', decided_at=now() "
            f"WHERE id = {int(sugg_id)}"
        )
        return {"ok": True, "price": None}
    price = float(price)
    if with_vat is True:
        price = _apply_vat_price(price)

    builds_updated = 0
    if target_pid:
        cur.execute(
            f"UPDATE {SCHEMA}.products SET price = {price} WHERE id = {int(target_pid)}"
        )
        # связанная складская группа → цена + история
        cur.execute(
            f"SELECT id, avg_cost FROM {SCHEMA}.warehouse_groups "
            f"WHERE product_id = {int(target_pid)}"
        )
        grp = cur.fetchone()
        if grp:
            gid, avg_cost = grp[0], grp[1]
            cur.execute(
                f"UPDATE {SCHEMA}.warehouse_groups SET price_retail = {price}, "
                f"updated_at = NOW() WHERE id = {int(gid)}"
            )
            cur.execute(
                f"INSERT INTO {SCHEMA}.warehouse_price_history "
                f"(group_id, price_retail, avg_cost) "
                f"VALUES ({int(gid)}, {price}, {float(avg_cost) if avg_cost is not None else 'NULL'})"
            )
        builds_updated = _recalc_builds(cur, int(target_pid), price)

    cur.execute(
        f"UPDATE {SCHEMA}.price_suggestions SET status='accepted', decided_at=now() "
        f"WHERE id = {int(sugg_id)}"
    )
    return {"ok": True, "price": price, "builds_updated": builds_updated}


def _recalc_builds(cur, product_id: int, new_price: float) -> int:
    """Пересчёт цен незафиксированных продажных сборок с этим товаром (catalog/source_id).
    Не трогает сборки из наличия (in_stock) и архивные. Учитывает НДС продажи."""
    import math
    cur.execute(
        f"SELECT id, components, assembly_fee, sell_with_vat FROM {SCHEMA}.pc_builds "
        f"WHERE COALESCE(in_stock, FALSE) = FALSE AND COALESCE(status, '') <> 'archive' "
        f"AND components::text LIKE %s",
        ('%"source_id": ' + str(int(product_id)) + '%',)
    )
    rows = cur.fetchall()
    updated = 0
    for build_id, components, assembly_fee, sell_with_vat in rows:
        comps = components if isinstance(components, list) else json.loads(components or "[]")
        changed = False
        for c in comps:
            if c.get("source") == "catalog" and int(c.get("source_id") or 0) == int(product_id):
                if float(c.get("price") or 0) != float(new_price):
                    c["price"] = float(new_price)
                    changed = True
        if not changed:
            continue
        parts_total = sum(float(c.get("price") or 0) * int(c.get("qty") or 1) for c in comps)
        base = parts_total + float(assembly_fee or 0)
        total_price = float(math.ceil(base * 1.22 / 250.0) * 250) if sell_with_vat else base
        cur.execute(
            f"UPDATE {SCHEMA}.pc_builds SET components=%s, parts_total=%s, total_price=%s WHERE id=%s",
            (json.dumps(comps), parts_total, total_price, build_id)
        )
        updated += 1
    return updated


def _match_candidates(cur, q, sugg_id=None) -> dict:
    """Кандидаты каталога для ручной привязки new_product — по Jaccard-похожести названия."""
    name = (q or "").strip()
    if not name and sugg_id:
        cur.execute(
            f"SELECT ext_name FROM {SCHEMA}.price_suggestions WHERE id = {int(sugg_id)}"
        )
        r = cur.fetchone()
        if r:
            name = (r[0] or "").strip()
    if not name:
        return {"candidates": []}

    ext_tokens = tokenize(name)
    cur.execute(f"SELECT id, name, price FROM {SCHEMA}.products WHERE is_archived = FALSE")
    scored = []
    for pid, pname, pprice in cur.fetchall():
        ptok = tokenize(pname)
        if not ext_tokens or not ptok:
            continue
        inter = len(ext_tokens & ptok)
        if inter == 0:
            continue
        score = inter / len(ext_tokens | ptok)
        scored.append((score, pid, pname, float(pprice)))
    scored.sort(key=lambda x: x[0], reverse=True)
    return {
        "candidates": [
            {"product_id": pid, "name": pname, "price": pprice,
             "score": round(score * 100, 1)}
            for score, pid, pname, pprice in scored[:12]
        ]
    }


def _link_product(cur, sugg_id: int, product_id: int) -> dict:
    """Привязывает предложение new_product к товару каталога (без изменения цены)."""
    cur.execute(f"SELECT price FROM {SCHEMA}.products WHERE id = {int(product_id)}")
    prow = cur.fetchone()
    if not prow:
        return {"ok": False, "error": "product_not_found"}
    cur.execute(
        f"UPDATE {SCHEMA}.price_suggestions "
        f"SET product_id = {int(product_id)}, kind = 'price_change', "
        f"    current_price = {float(prow[0])} "
        f"WHERE id = {int(sugg_id)} AND status = 'new'"
    )
    return {"ok": True, "product_id": product_id, "current_price": float(prow[0])}