"""
Маркетинг и аналитика: источники клиентов, группы источников, помесячные
рекламные бюджеты и сводная аналитика по каналам привлечения (CPL/CAC, выручка).
Используется админ-панелью (вкладка «Аналитика»).
"""
import json
import os
from datetime import date, datetime

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


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _month_start(s):
    """Принимает 'YYYY-MM' или 'YYYY-MM-DD' → date первого дня месяца."""
    if not s:
        d = date.today()
        return date(d.year, d.month, 1)
    parts = str(s).split("-")
    y, m = int(parts[0]), int(parts[1])
    return date(y, m, 1)


def handler(event: dict, context) -> dict:
    """Роутер CRUD источников/групп/бюджетов и аналитики по каналам."""
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

    conn = _conn()
    try:
        cur = conn.cursor()

        # ─────────────── ГРУППЫ ИСТОЧНИКОВ ───────────────
        if action == "groups" and method == "GET":
            cur.execute(
                f"SELECT id, name, color, sort_order, is_archived "
                f"FROM {SCHEMA}.marketing_source_groups "
                f"WHERE is_archived = FALSE ORDER BY sort_order, name"
            )
            rows = [{"id": r[0], "name": r[1], "color": r[2], "sort_order": r[3], "is_archived": r[4]}
                    for r in cur.fetchall()]
            return _resp(200, {"groups": rows})

        if action == "group_save" and method in ("POST", "PUT"):
            gid = body.get("id")
            if gid:
                cur.execute(
                    f"UPDATE {SCHEMA}.marketing_source_groups "
                    f"SET name=%s, color=%s, sort_order=%s WHERE id=%s",
                    (body.get("name"), body.get("color", "#64748b"),
                     int(body.get("sort_order", 0)), int(gid))
                )
            else:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.marketing_source_groups (name, color, sort_order) "
                    f"VALUES (%s, %s, %s) RETURNING id",
                    (body.get("name"), body.get("color", "#64748b"), int(body.get("sort_order", 0)))
                )
                gid = cur.fetchone()[0]
            conn.commit()
            return _resp(200, {"ok": True, "id": gid})

        if action == "group_archive" and method in ("POST", "PUT", "DELETE"):
            gid = int(body.get("id") or params.get("id"))
            cur.execute(
                f"UPDATE {SCHEMA}.marketing_source_groups SET is_archived=TRUE WHERE id=%s", (gid,)
            )
            conn.commit()
            return _resp(200, {"ok": True})

        # ─────────────── ИСТОЧНИКИ ───────────────
        if action == "sources" and method == "GET":
            only_active = params.get("active") == "true"
            where = "WHERE s.is_active = TRUE" if only_active else ""
            cur.execute(
                f"SELECT s.id, s.group_id, s.name, s.utm_source, s.utm_medium, "
                f"s.is_paid, s.is_active, s.sort_order, g.name, g.color "
                f"FROM {SCHEMA}.marketing_sources s "
                f"LEFT JOIN {SCHEMA}.marketing_source_groups g ON g.id = s.group_id "
                f"{where} ORDER BY s.sort_order, s.name"
            )
            rows = [{"id": r[0], "group_id": r[1], "name": r[2], "utm_source": r[3],
                     "utm_medium": r[4], "is_paid": r[5], "is_active": r[6],
                     "sort_order": r[7], "group_name": r[8], "group_color": r[9]}
                    for r in cur.fetchall()]
            return _resp(200, {"sources": rows})

        if action == "source_save" and method in ("POST", "PUT"):
            sid = body.get("id")
            if sid:
                cur.execute(
                    f"UPDATE {SCHEMA}.marketing_sources SET group_id=%s, name=%s, "
                    f"utm_source=%s, utm_medium=%s, is_paid=%s, is_active=%s, sort_order=%s "
                    f"WHERE id=%s",
                    (body.get("group_id"), body.get("name"),
                     body.get("utm_source") or None, body.get("utm_medium") or None,
                     bool(body.get("is_paid")), bool(body.get("is_active", True)),
                     int(body.get("sort_order", 0)), int(sid))
                )
            else:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.marketing_sources "
                    f"(group_id, name, utm_source, utm_medium, is_paid, is_active, sort_order) "
                    f"VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (body.get("group_id"), body.get("name"),
                     body.get("utm_source") or None, body.get("utm_medium") or None,
                     bool(body.get("is_paid")), bool(body.get("is_active", True)),
                     int(body.get("sort_order", 0)))
                )
                sid = cur.fetchone()[0]
            conn.commit()
            return _resp(200, {"ok": True, "id": sid})

        # ─────────────── БЮДЖЕТЫ ───────────────
        if action == "budgets" and method == "GET":
            gid = params.get("group_id")
            where = f"WHERE b.group_id = {int(gid)}" if gid else ""
            cur.execute(
                f"SELECT b.id, b.group_id, b.period_month, b.amount, b.leads_manual, "
                f"b.note, g.name, g.color "
                f"FROM {SCHEMA}.marketing_budgets b "
                f"JOIN {SCHEMA}.marketing_source_groups g ON g.id = b.group_id "
                f"{where} ORDER BY b.period_month DESC, g.sort_order"
            )
            rows = [{"id": r[0], "group_id": r[1], "period_month": str(r[2]),
                     "amount": float(r[3]), "leads_manual": r[4], "note": r[5],
                     "group_name": r[6], "group_color": r[7]}
                    for r in cur.fetchall()]
            return _resp(200, {"budgets": rows})

        if action == "budget_save" and method in ("POST", "PUT"):
            gid = int(body["group_id"])
            period = _month_start(body.get("period_month"))
            amount = float(body.get("amount", 0))
            leads_manual = body.get("leads_manual")
            leads_manual = int(leads_manual) if leads_manual not in (None, "") else None
            note = body.get("note")
            # upsert по (group_id, period_month)
            cur.execute(
                f"INSERT INTO {SCHEMA}.marketing_budgets (group_id, period_month, amount, leads_manual, note) "
                f"VALUES (%s, %s, %s, %s, %s) "
                f"ON CONFLICT (group_id, period_month) DO UPDATE "
                f"SET amount=EXCLUDED.amount, leads_manual=EXCLUDED.leads_manual, "
                f"note=EXCLUDED.note, updated_at=NOW() RETURNING id",
                (gid, period, amount, leads_manual, note)
            )
            bid = cur.fetchone()[0]
            conn.commit()
            return _resp(200, {"ok": True, "id": bid})

        # ─────────────── АНАЛИТИКА ───────────────
        if action == "analytics" and method == "GET":
            # период: from/to (YYYY-MM-DD). По умолчанию — текущий месяц.
            d_from = params.get("from")
            d_to = params.get("to")
            if not d_from or not d_to:
                today = date.today()
                d_from = str(date(today.year, today.month, 1))
                if today.month == 12:
                    d_to = str(date(today.year + 1, 1, 1))
                else:
                    d_to = str(date(today.year, today.month + 1, 1))

            # Заказы за период считаем только «результативные» (не отменённые).
            # revenue — сумма total по не отменённым заказам.
            cur.execute(
                f"SELECT "
                f"  COALESCE(s.id, 0) AS source_id, "
                f"  COALESCE(s.name, 'Без источника') AS source_name, "
                f"  COALESCE(g.id, 0) AS group_id, "
                f"  COALESCE(g.name, 'Без группы') AS group_name, "
                f"  COALESCE(g.color, '#64748b') AS color, "
                f"  COUNT(o.id) AS orders_cnt, "
                f"  COUNT(o.id) FILTER (WHERE o.status = 'done') AS done_cnt, "
                f"  COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'), 0) AS revenue "
                f"FROM {SCHEMA}.orders o "
                f"LEFT JOIN {SCHEMA}.marketing_sources s ON s.id = o.source_id "
                f"LEFT JOIN {SCHEMA}.marketing_source_groups g ON g.id = s.group_id "
                f"WHERE o.created_at >= %s AND o.created_at < %s "
                f"GROUP BY s.id, s.name, g.id, g.name, g.color "
                f"ORDER BY revenue DESC",
                (d_from, d_to)
            )
            by_source = [{"source_id": r[0], "source_name": r[1], "group_id": r[2],
                          "group_name": r[3], "color": r[4], "orders": r[5],
                          "done": r[6], "revenue": float(r[7])}
                         for r in cur.fetchall()]

            # Лиды из квиза по источнику за период (обращения).
            cur.execute(
                f"SELECT COALESCE(source_id, 0), COUNT(*) "
                f"FROM {SCHEMA}.quiz_requests "
                f"WHERE created_at >= %s AND created_at < %s "
                f"GROUP BY source_id",
                (d_from, d_to)
            )
            quiz_by_source = {r[0]: r[1] for r in cur.fetchall()}

            # Бюджеты и ручные лиды по группам за месяцы периода.
            cur.execute(
                f"SELECT group_id, COALESCE(SUM(amount),0), "
                f"COALESCE(SUM(COALESCE(leads_manual,0)),0) "
                f"FROM {SCHEMA}.marketing_budgets "
                f"WHERE period_month >= %s AND period_month < %s "
                f"GROUP BY group_id",
                (_month_start(d_from), _month_start(d_to) if d_to else _month_start(d_from))
            )
            budget_by_group = {}
            leads_manual_by_group = {}
            for r in cur.fetchall():
                budget_by_group[r[0]] = float(r[1])
                leads_manual_by_group[r[0]] = int(r[2])

            # Свод по группам с расчётом CPL/CAC.
            groups_map = {}
            for row in by_source:
                gid = row["group_id"]
                g = groups_map.setdefault(gid, {
                    "group_id": gid, "group_name": row["group_name"],
                    "color": row["color"], "orders": 0, "done": 0,
                    "revenue": 0.0, "quiz_leads": 0,
                })
                g["orders"] += row["orders"]
                g["done"] += row["done"]
                g["revenue"] += row["revenue"]
                g["quiz_leads"] += quiz_by_source.get(row["source_id"], 0)

            group_rows = []
            total_budget = 0.0
            total_revenue = 0.0
            total_orders = 0
            for gid, g in groups_map.items():
                budget = budget_by_group.get(gid, 0.0)
                manual_leads = leads_manual_by_group.get(gid, 0)
                # Лиды = max(ручные лиды, авто-лиды из квиза, кол-во заказов).
                auto_leads = max(g["quiz_leads"], g["orders"])
                leads = max(manual_leads, auto_leads) if manual_leads else auto_leads
                cpl = round(budget / leads, 2) if leads > 0 else None
                cac = round(budget / g["done"], 2) if g["done"] > 0 else None
                romi = round((g["revenue"] - budget) / budget * 100, 1) if budget > 0 else None
                group_rows.append({
                    **g, "budget": budget, "leads": leads,
                    "cpl": cpl, "cac": cac, "romi": romi,
                })
                total_budget += budget
                total_revenue += g["revenue"]
                total_orders += g["orders"]

            group_rows.sort(key=lambda x: x["revenue"], reverse=True)

            # Динамика по дням (заказы и выручка) для графика.
            cur.execute(
                f"SELECT DATE(o.created_at) AS d, COUNT(*), "
                f"COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'),0) "
                f"FROM {SCHEMA}.orders o "
                f"WHERE o.created_at >= %s AND o.created_at < %s "
                f"GROUP BY DATE(o.created_at) ORDER BY d",
                (d_from, d_to)
            )
            timeline = [{"date": str(r[0]), "orders": r[1], "revenue": float(r[2])}
                        for r in cur.fetchall()]

            totals = {
                "budget": round(total_budget, 2),
                "revenue": round(total_revenue, 2),
                "orders": total_orders,
                "romi": round((total_revenue - total_budget) / total_budget * 100, 1) if total_budget > 0 else None,
            }

            return _resp(200, {
                "period": {"from": str(d_from), "to": str(d_to)},
                "by_source": by_source,
                "by_group": group_rows,
                "timeline": timeline,
                "totals": totals,
            })

        if action == "sales_report" and method == "GET":
            # Отчёт по продажам для анализа закупок (скрипт-аналитика + выгрузка).
            # Продажа = позиции ВЫДАННЫХ заказов (status='done'). По каждой позиции:
            # продано шт, выручка, средняя цена, себестоимость (avg по всем партиям),
            # маржа ₽/%, текущий остаток, дневной спрос, на сколько дней хватит,
            # дефицит под спрос, и текстовые метки (хит/мёртвый/дефицит/низкая маржа).
            d_from = params.get("from")
            d_to = params.get("to")
            if not d_from or not d_to:
                today = date.today()
                d_from = str(date(today.year, today.month, 1))
                if today.month == 12:
                    d_to = str(date(today.year + 1, 1, 1))
                else:
                    d_to = str(date(today.year, today.month + 1, 1))

            # число дней периода (для дневного спроса), минимум 1
            try:
                _df = datetime.strptime(str(d_from)[:10], "%Y-%m-%d").date()
                _dt = datetime.strptime(str(d_to)[:10], "%Y-%m-%d").date()
                period_days = max((_dt - _df).days, 1)
            except Exception:
                period_days = 30

            cur.execute(
                f"SELECT "
                f"  s.product_id, "
                f"  MAX(COALESCE(p.name, s.raw_name)) AS name, "
                f"  MAX(c.name) AS category, "
                f"  SUM(s.qty) AS units_sold, "
                f"  COUNT(*) AS lines, "
                f"  COUNT(DISTINCT s.order_id) AS orders_cnt, "
                f"  COUNT(DISTINCT s.sale_day) AS distinct_days, "
                f"  MIN(s.sale_day) AS first_day, "
                f"  MAX(s.sale_day) AS last_day, "
                f"  SUM(s.qty * s.sale_price) AS revenue, "
                f"  ROUND(AVG(s.sale_price), 2) AS avg_price, "
                f"  COALESCE(("
                f"    SELECT ROUND(SUM(w.cost_price * w.qty) / NULLIF(SUM(w.qty), 0), 2) "
                f"    FROM {SCHEMA}.warehouse_supplies w "
                f"    JOIN {SCHEMA}.warehouse_groups g ON g.id = w.group_id "
                f"    WHERE g.product_id = s.product_id AND w.qty > 0), "
                f"    COALESCE(("
                f"      SELECT ROUND(AVG(w.cost_price), 2) "
                f"      FROM {SCHEMA}.warehouse_supplies w "
                f"      JOIN {SCHEMA}.warehouse_groups g ON g.id = w.group_id "
                f"      WHERE g.product_id = s.product_id AND w.cost_price > 0), 0)) AS avg_cost, "
                f"  COALESCE(("
                f"    SELECT SUM(w.qty) FROM {SCHEMA}.warehouse_supplies w "
                f"    JOIN {SCHEMA}.warehouse_groups g ON g.id = w.group_id "
                f"    WHERE g.product_id = s.product_id), 0) AS stock_now "
                f"FROM ("
                f"  SELECT "
                f"    (it->>'id')::int AS product_id, "
                f"    it->>'name' AS raw_name, "
                f"    o.id AS order_id, "
                f"    o.created_at::date AS sale_day, "
                f"    COALESCE((it->>'final_price')::numeric, (it->>'price')::numeric, 0) AS sale_price, "
                f"    COALESCE((it->>'quantity')::int, 1) AS qty "
                f"  FROM {SCHEMA}.orders o, LATERAL jsonb_array_elements(o.items) AS it "
                f"  WHERE o.status = 'done' "
                f"    AND o.created_at >= '{d_from}' AND o.created_at < '{d_to}' "
                f"    AND COALESCE(it->>'item_type', 'product') = 'product' "
                f"    AND (it->>'id') ~ '^[0-9]+$'"
                f") s "
                f"LEFT JOIN {SCHEMA}.products p ON p.id = s.product_id "
                f"LEFT JOIN {SCHEMA}.categories c ON c.id = p.category_id "
                f"GROUP BY s.product_id "
                f"ORDER BY revenue DESC"
            )

            items = []
            for r in cur.fetchall():
                units = int(r[3] or 0)
                orders_cnt = int(r[5] or 0)     # в скольких РАЗНЫХ заказах
                distinct_days = int(r[6] or 0)  # в скольких РАЗНЫХ днях продавался
                first_day = r[7]
                last_day = r[8]
                revenue = float(r[9] or 0)
                avg_price = float(r[10] or 0)
                avg_cost = float(r[11] or 0)
                stock_now = int(r[12] or 0)

                margin_rub = round(revenue - avg_cost * units, 2) if avg_cost > 0 else None
                margin_pct = round(margin_rub / revenue * 100, 1) if (margin_rub is not None and revenue > 0) else None

                # ── ТИП СПРОСА: отличаем реальный спрос от разовой/случайной продажи ──
                # Ключевой сигнал — ЧАСТОТА (в скольких разных заказах/днях покупали),
                # а не просто число штук. 4 шт в одном заказе = разовая закупка, а
                # 4 шт в 4 заказах в разные дни = регулярный спрос.
                if orders_cnt == 0:
                    demand_type = "нет данных"
                elif orders_cnt >= 3 or distinct_days >= 3:
                    demand_type = "регулярный"
                elif orders_cnt >= 2 and distinct_days >= 2:
                    demand_type = "регулярный"
                else:
                    demand_type = "разовый"   # 1 заказ / 1 день — вероятно случайность
                is_regular = demand_type == "регулярный"

                # ── Дневной спрос ──
                # Для регулярного спроса считаем по фактическому промежутку между
                # первой и последней продажей (реальный ритм), но не короче части
                # периода, чтобы не завышать. Для разового — спрос не оцениваем.
                daily_demand = 0
                if is_regular and units > 0:
                    span = period_days
                    if first_day and last_day:
                        span_days = (last_day - first_day).days + 1
                        # берём наибольший из фактического окна продаж и его удвоения,
                        # но не больше периода — сглаживаем всплески
                        span = min(period_days, max(span_days * 2, span_days))
                        span = max(span, 1)
                    daily_demand = round(units / span, 4)

                days_cover = round(stock_now / daily_demand, 1) if daily_demand > 0 else None
                # прогноз спроса на 30 дней и дефицит — ТОЛЬКО для регулярного спроса
                demand_30d = daily_demand * 30
                deficit = max(0, round(demand_30d - stock_now)) if (is_regular and daily_demand > 0) else 0

                # ── Метки-подсказки (скрипт-аналитика) ──
                labels = []
                # «хит» — только при регулярном спросе (частота), а не при разовой закупке
                if is_regular and units >= 3:
                    labels.append("хит")
                if demand_type == "разовый" and units > 0:
                    labels.append("разовая продажа")
                if margin_pct is not None and margin_pct < 10:
                    labels.append("низкая маржа")
                if margin_pct is not None and margin_pct >= 25 and is_regular:
                    labels.append("хорошая маржа")
                # предупреждения об остатке — только по регулярному спросу
                if is_regular:
                    if stock_now == 0:
                        labels.append("нет в наличии")
                    elif days_cover is not None and days_cover <= 14:
                        labels.append("скоро закончится")
                    if deficit > 0:
                        labels.append("дозаказать")

                items.append({
                    "product_id": r[0],
                    "name": r[1] or "—",
                    "category": r[2] or "—",
                    "units_sold": units,
                    "lines": int(r[4] or 0),
                    "orders_cnt": orders_cnt,
                    "distinct_days": distinct_days,
                    "demand_type": demand_type,
                    "revenue": round(revenue, 2),
                    "avg_price": avg_price,
                    "avg_cost": avg_cost,
                    "margin_rub": margin_rub,
                    "margin_pct": margin_pct,
                    "stock_now": stock_now,
                    "daily_demand": daily_demand,
                    "days_cover": days_cover,
                    "deficit": deficit,
                    "labels": labels,
                })

            totals = {
                "positions": len(items),
                "units": sum(i["units_sold"] for i in items),
                "revenue": round(sum(i["revenue"] for i in items), 2),
                "margin": round(sum(i["margin_rub"] for i in items if i["margin_rub"] is not None), 2),
                "period_days": period_days,
                "regular": sum(1 for i in items if i["demand_type"] == "регулярный"),
                "one_off": sum(1 for i in items if i["demand_type"] == "разовый"),
            }
            return _resp(200, {
                "period": {"from": str(d_from), "to": str(d_to)},
                "items": items,
                "totals": totals,
            })

        return _resp(400, {"error": "unknown_action", "action": action})

    except Exception as e:
        conn.rollback()
        return _resp(500, {"error": str(e)})
    finally:
        conn.close()