import json
import os
import psycopg2
from datetime import date, datetime

SCHEMA = "t_p72635010_quantum_fusion_resea"

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token, X-Session-Id",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def esc(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def num(v, default=0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def serial(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if obj is None:
        return None
    return str(obj)


def resp(code, body):
    return {
        "statusCode": code,
        "headers": {**cors, "Content-Type": "application/json"},
        "isBase64Encoded": False,
        "body": json.dumps(body, default=serial, ensure_ascii=False),
    }


# ── СВОДКА ──────────────────────────────────────────────────────────────────
def get_summary(cur):
    """Сводка: стоимость склада, маржа за месяц (ПК/заказы), нал в кассе."""
    # Стоимость железа на складе (свободный остаток + резерв)
    cur.execute(
        f"SELECT "
        f"COALESCE(SUM((s.qty + s.qty_reserved) * s.cost_price), 0) AS purchase, "
        f"COALESCE(SUM((s.qty + s.qty_reserved) * COALESCE(g.price_retail, 0)), 0) AS sale "
        f"FROM {SCHEMA}.warehouse_supplies s "
        f"JOIN {SCHEMA}.warehouse_groups g ON g.id = s.group_id "
        f"WHERE g.is_archived = FALSE"
    )
    row = cur.fetchone()
    stock_purchase = num(row[0])
    stock_sale = num(row[1])

    # Маржа за текущий месяц по выданным заказам (status='done')
    # Маржа = total - сумма себестоимости компонентов из партий (через резервы)
    def margin_block(order_type):
        cur.execute(
            f"SELECT COUNT(*) AS cnt, "
            f"COALESCE(SUM(m.margin), 0) AS total_margin, "
            f"COALESCE(SUM(o.total), 0) AS revenue "
            f"FROM ( "
            f"  SELECT o.id, o.total, "
            f"    o.total - COALESCE(("
            f"      SELECT SUM(r.qty * sup.cost_price) "
            f"      FROM {SCHEMA}.warehouse_reserves r "
            f"      JOIN {SCHEMA}.warehouse_supplies sup ON sup.id = r.supply_id "
            f"      WHERE r.order_id = o.id AND r.type='POSITIVE' "
            f"        AND r.status IN ('FULFILLED','ACTIVE')"
            f"    ), 0) AS margin "
            f"  FROM {SCHEMA}.orders o "
            f"  WHERE o.status = 'done' "
            f"    AND o.order_type = {esc(order_type)} "
            f"    AND date_trunc('month', o.updated_at) = date_trunc('month', CURRENT_DATE) "
            f") m "
            f"JOIN {SCHEMA}.orders o ON o.id = m.id"
        )
        r = cur.fetchone()
        cnt = int(r[0])
        total_margin = num(r[1])
        revenue = num(r[2])
        avg = round(total_margin / cnt, 2) if cnt else 0
        return {"count": cnt, "total_margin": round(total_margin, 2),
                "avg_margin": avg, "revenue": round(revenue, 2)}

    pc = margin_block("pc_build")
    parts = margin_block("parts")

    # Нал в кассе: приходы - расходы - инкассация
    cur.execute(
        f"SELECT "
        f"COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END), 0) AS inc, "
        f"COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END), 0) AS exp, "
        f"COALESCE(SUM(CASE WHEN kind='collection' THEN amount ELSE 0 END), 0) AS coll "
        f"FROM {SCHEMA}.finance_transactions"
    )
    r = cur.fetchone()
    fin_income = num(r[0])
    fin_expense = num(r[1])
    fin_collection = num(r[2])

    # В кассу добавляем выручку выданных заказов (нал) минус себестоимость не нужна — это деньги
    cur.execute(
        f"SELECT COALESCE(SUM(total), 0) FROM {SCHEMA}.orders WHERE status='done'"
    )
    sales_cash = num(cur.fetchone()[0])

    cash = sales_cash + fin_income - fin_expense - fin_collection

    # Авто-расходы на закупку товара (приход на склад) — выделяем отдельно
    cur.execute(
        f"SELECT COALESCE(SUM(amount), 0) FROM {SCHEMA}.finance_transactions "
        f"WHERE kind='expense' AND auto_supply = TRUE"
    )
    supply_expense = num(cur.fetchone()[0])
    # Прочие расходы (ручные, не закупка товара)
    other_expense = round(fin_expense - supply_expense, 2)

    # Баланс офиса: деньги поступают через инкассацию из кассы + приходы,
    # уходят через расходы (офис, зарплата, закупка товара).
    office_balance = round(fin_income + fin_collection - fin_expense, 2)

    return {
        "stock": {"purchase": round(stock_purchase, 2), "sale": round(stock_sale, 2)},
        "margin_pc": pc,
        "margin_parts": parts,
        "cash": round(cash, 2),
        "fin": {
            "income": round(fin_income, 2),
            "expense": round(fin_expense, 2),
            "collection": round(fin_collection, 2),
            "sales_cash": round(sales_cash, 2),
        },
        "office": {
            "balance": office_balance,
            "income": round(fin_income + fin_collection, 2),
            "expense": round(fin_expense, 2),
            "supply_expense": round(supply_expense, 2),
            "other_expense": other_expense,
            # Передано в другой офис (инкассация) — транзит, наш баланс это
            # отражает как приход, но физически деньги ушли в другой офис.
            "transferred": round(fin_collection, 2),
        },
    }


# ── ЛОГ ДВИЖЕНИЯ СРЕДСТВ ─────────────────────────────────────────────────────
def get_log(cur, limit=200, offset=0, date_from=None, date_to=None):
    """Единый лог: финансовые транзакции + продажи (выданные заказы).
    date_from/date_to (YYYY-MM-DD) — фильтр по периоду (включительно)."""
    items = []

    # Условия по периоду
    tx_cond = ""
    sale_cond = ""
    if date_from:
        tx_cond += f" AND t.occurred_at >= {esc(date_from)}::date"
        sale_cond += f" AND o.updated_at >= {esc(date_from)}::date"
    if date_to:
        # включительно по конец дня
        tx_cond += f" AND t.occurred_at < ({esc(date_to)}::date + INTERVAL '1 day')"
        sale_cond += f" AND o.updated_at < ({esc(date_to)}::date + INTERVAL '1 day')"

    # Финансовые транзакции
    cur.execute(
        f"SELECT t.id, t.kind, t.amount, t.note, t.occurred_at, t.affects_pnl, "
        f"ft.name AS type_name, u.username, t.order_id "
        f"FROM {SCHEMA}.finance_transactions t "
        f"LEFT JOIN {SCHEMA}.finance_types ft ON ft.id = t.type_id "
        f"LEFT JOIN {SCHEMA}.users u ON u.id = t.user_id "
        f"WHERE TRUE{tx_cond} "
        f"ORDER BY t.occurred_at DESC LIMIT {int(limit)} OFFSET {int(offset)}"
    )
    for r in cur.fetchall():
        items.append({
            "source": "finance",
            "id": r[0],
            "kind": r[1],
            "amount": num(r[2]),
            "note": r[3],
            "occurred_at": serial(r[4]),
            "affects_pnl": r[5],
            "type_name": r[6],
            "user": r[7],
            "order_id": r[8],
        })

    # Продажи (выданные заказы) — как приход
    cur.execute(
        f"SELECT o.id, o.order_type, o.total, o.customer_name, o.updated_at "
        f"FROM {SCHEMA}.orders o WHERE o.status='done'{sale_cond} "
        f"ORDER BY o.updated_at DESC LIMIT {int(limit)}"
    )
    for r in cur.fetchall():
        items.append({
            "source": "sale",
            "id": r[0],
            "kind": "income",
            "amount": num(r[2]),
            "note": f"Заказ #{r[0]} — {r[3]}",
            "occurred_at": serial(r[4]),
            "affects_pnl": True,
            "type_name": "Продажа ПК" if r[1] == "pc_build" else "Продажа товаров",
            "order_type": r[1],
            "order_id": r[0],
            "user": None,
        })

    items.sort(key=lambda x: x["occurred_at"] or "", reverse=True)
    return items[:limit]


# ── ТИПЫ ОПЕРАЦИЙ ────────────────────────────────────────────────────────────
def get_types(cur):
    cur.execute(
        f"SELECT id, name, direction, is_system, sort_order "
        f"FROM {SCHEMA}.finance_types ORDER BY direction, sort_order, name"
    )
    return [{"id": r[0], "name": r[1], "direction": r[2],
             "is_system": r[3], "sort_order": r[4]} for r in cur.fetchall()]


# ── СЧЕТА СОТРУДНИКОВ ─────────────────────────────────────────────────────────
def get_accounts(cur):
    """Список сотрудников с балансом счёта."""
    cur.execute(
        f"SELECT e.id, e.name, e.color, e.is_active, COALESCE(a.balance, 0) "
        f"FROM {SCHEMA}.employees e "
        f"LEFT JOIN {SCHEMA}.employee_accounts a ON a.employee_id = e.id "
        f"ORDER BY e.is_active DESC, e.name"
    )
    return [{"id": r[0], "name": r[1], "color": r[2], "is_active": r[3],
             "balance": num(r[4])} for r in cur.fetchall()]


def get_account_log(cur, employee_id, limit=50):
    cur.execute(
        f"SELECT id, amount, note, order_id, created_at "
        f"FROM {SCHEMA}.employee_account_tx WHERE employee_id = {int(employee_id)} "
        f"ORDER BY created_at DESC LIMIT {int(limit)}"
    )
    return [{"id": r[0], "amount": num(r[1]), "note": r[2],
             "order_id": r[3], "created_at": serial(r[4])} for r in cur.fetchall()]


def credit_account(cur, employee_id, amount, note, order_id=None):
    """Зачисление/списание на счёт сотрудника + запись в историю."""
    cur.execute(
        f"INSERT INTO {SCHEMA}.employee_accounts (employee_id, balance) "
        f"VALUES ({int(employee_id)}, {num(amount)}) "
        f"ON CONFLICT (employee_id) DO UPDATE "
        f"SET balance = {SCHEMA}.employee_accounts.balance + {num(amount)}, updated_at = NOW()"
    )
    cur.execute(
        f"INSERT INTO {SCHEMA}.employee_account_tx (employee_id, amount, note, order_id) "
        f"VALUES ({int(employee_id)}, {num(amount)}, {esc(note)}, "
        f"{int(order_id) if order_id else 'NULL'})"
    )


# ── ДЕНЕЖНЫЕ СЧЕТА (касса / Авито / терминал) ────────────────────────────────
def get_cash_accounts(cur):
    """Список денежных счетов (физические кошельки) с балансом."""
    cur.execute(
        f"SELECT id, code, name, color, balance, is_active "
        f"FROM {SCHEMA}.cash_accounts ORDER BY sort_order, name"
    )
    return [{"id": r[0], "code": r[1], "name": r[2], "color": r[3],
             "balance": num(r[4]), "is_active": r[5]} for r in cur.fetchall()]


def credit_cash(cur, cash_account_id, amount, note, order_id=None):
    """Зачисление/списание на денежный счёт + запись в историю."""
    cur.execute(
        f"UPDATE {SCHEMA}.cash_accounts SET balance = balance + {num(amount)}, "
        f"updated_at = NOW() WHERE id = {int(cash_account_id)}"
    )
    cur.execute(
        f"INSERT INTO {SCHEMA}.cash_account_tx (cash_account_id, amount, note, order_id) "
        f"VALUES ({int(cash_account_id)}, {num(amount)}, {esc(note)}, "
        f"{int(order_id) if order_id else 'NULL'})"
    )


def get_cash_account_log(cur, cash_account_id, limit=50):
    cur.execute(
        f"SELECT id, amount, note, order_id, created_at "
        f"FROM {SCHEMA}.cash_account_tx WHERE cash_account_id = {int(cash_account_id)} "
        f"ORDER BY created_at DESC LIMIT {int(limit)}"
    )
    return [{"id": r[0], "amount": num(r[1]), "note": r[2],
             "order_id": r[3], "created_at": serial(r[4])} for r in cur.fetchall()]


# ── АВТО-РАСХОД «ЗАКУПКА ТОВАРА» ─────────────────────────────────────────────
def sync_supply_expense(cur, store_id=None, exp_date=None):
    """Синхронизирует авто-расходы офиса «Закупка товара» с фактом поставок.

    Источник истины — warehouse_supplies. Сумма расхода за день+магазин =
    Σ cost_price × (qty + qty_reserved + qty_negative) (весь приход).
    Эту функцию вызывает ТОЛЬКО finance (у неё есть права на finance_*),
    поэтому запись авто-расхода надёжна.

    Если store_id/exp_date заданы — пересчитывается одна группа день+магазин.
    Если нет — пересчитываются ВСЕ группы дней+магазинов из поставок,
    а также обнуляются авто-записи, под которые уже нет поставок.
    Возвращает число обработанных групп.
    """
    # тип «Расходы на товары»
    cur.execute(f"SELECT id FROM {SCHEMA}.finance_types WHERE name = 'Расходы на товары' LIMIT 1")
    tr = cur.fetchone()
    type_id = tr[0] if tr else None

    # Определяем список (день, магазин) для пересчёта
    if exp_date is not None:
        pairs = [(exp_date, store_id)]
    else:
        cur.execute(
            f"SELECT DISTINCT purchase_date, store_id FROM {SCHEMA}.warehouse_supplies "
            f"WHERE purchase_date IS NOT NULL"
        )
        pairs = [(r[0], r[1]) for r in cur.fetchall()]
        # плюс дни+магазины, где есть авто-запись (вдруг поставки удалили)
        cur.execute(
            f"SELECT DISTINCT expense_date, store_id FROM {SCHEMA}.finance_transactions "
            f"WHERE auto_supply = TRUE AND expense_date IS NOT NULL"
        )
        for r in cur.fetchall():
            if (r[0], r[1]) not in pairs:
                pairs.append((r[0], r[1]))

    processed = 0
    for d, sid in pairs:
        sid_sql = str(int(sid)) if sid else "NULL"
        date_sql = esc(str(d))

        cur.execute(
            f"SELECT COALESCE(SUM(cost_price * (qty + qty_reserved + qty_negative)), 0), COUNT(*) "
            f"FROM {SCHEMA}.warehouse_supplies "
            f"WHERE purchase_date = {date_sql}::date "
            f"AND store_id IS NOT DISTINCT FROM {sid_sql}"
        )
        row = cur.fetchone()
        total = round(float(row[0] or 0), 2)
        cnt = int(row[1] or 0)

        store_name = None
        if sid:
            cur.execute(f"SELECT name FROM {SCHEMA}.warehouse_stores WHERE id = {int(sid)}")
            sr = cur.fetchone()
            store_name = sr[0] if sr else None
        note_base = f"Закупка товара ({store_name})" if store_name else "Закупка товара"
        note = f"{note_base} · поставок: {cnt}"

        cur.execute(
            f"SELECT id FROM {SCHEMA}.finance_transactions "
            f"WHERE auto_supply = TRUE AND expense_date = {date_sql}::date "
            f"AND store_id IS NOT DISTINCT FROM {sid_sql} LIMIT 1"
        )
        ex = cur.fetchone()

        if total <= 0:
            if ex:
                cur.execute(
                    f"UPDATE {SCHEMA}.finance_transactions SET amount = 0, supply_count = 0, "
                    f"note = {esc(note)} WHERE id = {ex[0]}"
                )
        elif ex:
            cur.execute(
                f"UPDATE {SCHEMA}.finance_transactions "
                f"SET amount = {total}, supply_count = {cnt}, note = {esc(note)} "
                f"WHERE id = {ex[0]}"
            )
        else:
            cur.execute(
                f"INSERT INTO {SCHEMA}.finance_transactions "
                f"(kind, type_id, amount, note, affects_pnl, store_id, expense_date, "
                f" auto_supply, supply_count, occurred_at) "
                f"VALUES ('expense', {type_id if type_id else 'NULL'}, {total}, "
                f"{esc(note)}, TRUE, {sid_sql}, {date_sql}::date, TRUE, {cnt}, NOW())"
            )
        processed += 1
    return processed


def handler(event: dict, context) -> dict:
    """Финансы: сводка по деньгам, лог движения средств, расходы/приходы, инкассация, типы операций."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "isBase64Encoded": False, "body": ""}

    params = event.get("queryStringParameters") or {}
    action = params.get("action", "")
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except (ValueError, TypeError):
            body = {}
    if not action:
        action = body.get("action", "")

    conn = get_conn()
    cur = conn.cursor()
    try:
        # ── GET ──
        if method == "GET":
            if action == "summary":
                return resp(200, {"summary": get_summary(cur)})
            if action == "log":
                limit = int(params.get("limit", 200))
                offset = int(params.get("offset", 0))
                date_from = params.get("date_from")
                date_to = params.get("date_to")
                return resp(200, {"items": get_log(cur, limit, offset, date_from, date_to)})
            if action == "types":
                return resp(200, {"types": get_types(cur)})
            if action == "accounts":
                return resp(200, {"accounts": get_accounts(cur)})
            if action == "account_log":
                eid = params.get("employee_id")
                return resp(200, {"items": get_account_log(cur, eid)})
            if action == "cash_accounts":
                return resp(200, {"accounts": get_cash_accounts(cur)})
            if action == "cash_account_log":
                cid = params.get("cash_account_id")
                return resp(200, {"items": get_cash_account_log(cur, cid)})
            return resp(400, {"error": "unknown action"})

        # ── POST ──
        if method == "POST":
            # Добавить транзакцию (расход / приход / инкассация)
            if action == "add_tx":
                kind = body.get("kind")  # income | expense | collection
                if kind not in ("income", "expense", "collection"):
                    return resp(400, {"error": "bad kind"})
                amount = num(body.get("amount"), 0)
                if amount <= 0:
                    return resp(400, {"error": "amount must be > 0"})
                type_id = body.get("type_id")
                note = body.get("note", "")
                affects_pnl = kind != "collection"  # инкассация не влияет на прибыль
                user_id = body.get("user_id")
                occurred = body.get("occurred_at")
                cur.execute(
                    f"INSERT INTO {SCHEMA}.finance_transactions "
                    f"(kind, type_id, amount, note, affects_pnl, user_id, occurred_at) "
                    f"VALUES ({esc(kind)}, {esc(type_id) if type_id else 'NULL'}, "
                    f"{amount}, {esc(note)}, {affects_pnl}, "
                    f"{esc(user_id) if user_id else 'NULL'}, "
                    f"{esc(occurred) if occurred else 'NOW()'}) RETURNING id"
                )
                tx_id = cur.fetchone()[0]
                conn.commit()
                return resp(200, {"ok": True, "id": tx_id})

            # Синхронизация авто-расходов «Закупка товара» из поставок.
            # Вызывается складом после приёмки/правки и кнопкой «Обновить расходы».
            # store_id/date — точечно (одна группа), без них — пересчёт всего.
            if action == "sync_supply_expense":
                sid = body.get("store_id")
                edate = body.get("date")
                n = sync_supply_expense(cur, sid, edate)
                conn.commit()
                return resp(200, {"ok": True, "processed": n})

            # Добавить тип операции
            if action == "add_type":
                name = body.get("name", "").strip()
                direction = body.get("direction")
                if not name or direction not in ("income", "expense", "collection"):
                    return resp(400, {"error": "bad type"})
                cur.execute(
                    f"INSERT INTO {SCHEMA}.finance_types (name, direction, is_system, sort_order) "
                    f"VALUES ({esc(name)}, {esc(direction)}, FALSE, 100) RETURNING id"
                )
                tid = cur.fetchone()[0]
                conn.commit()
                return resp(200, {"ok": True, "id": tid})

            # Подтверждение предоплаты / оплата остатка: приход в финансы +
            # зачисление на выбранный счёт (денежный cash_account ИЛИ сотрудник).
            # mode: 'prepayment' (по умолчанию) | 'remaining'
            if action in ("confirm_prepayment", "confirm_remaining"):
                amount = num(body.get("amount"), 0)
                if amount <= 0:
                    return resp(400, {"error": "amount must be > 0"})
                mode = "remaining" if action == "confirm_remaining" else "prepayment"
                order_id = body.get("order_id")
                employee_id = body.get("employee_id")        # начислить сотруднику
                cash_account_id = body.get("cash_account_id")  # денежный счёт (касса/Авито/терминал)

                # Имя счёта для описания
                dest_name = "касса"
                if employee_id:
                    cur.execute(f"SELECT name FROM {SCHEMA}.employees WHERE id = {int(employee_id)}")
                    er = cur.fetchone()
                    dest_name = (er[0] if er else "сотрудник")
                elif cash_account_id:
                    cur.execute(f"SELECT name FROM {SCHEMA}.cash_accounts WHERE id = {int(cash_account_id)}")
                    cr = cur.fetchone()
                    dest_name = (cr[0] if cr else "счёт")

                # тип операции
                type_name = "Оплата заказа" if mode == "remaining" else "Предоплата"
                cur.execute(
                    f"SELECT id FROM {SCHEMA}.finance_types WHERE name = {esc(type_name)} LIMIT 1"
                )
                tr = cur.fetchone()
                if tr:
                    type_id = tr[0]
                else:
                    cur.execute(
                        f"INSERT INTO {SCHEMA}.finance_types (name, direction, is_system, sort_order) "
                        f"VALUES ({esc(type_name)}, 'income', TRUE, 5) RETURNING id"
                    )
                    type_id = cur.fetchone()[0]

                label = "Оплата заказа" if mode == "remaining" else "Предоплата за заказ"
                note = f"{label} #{order_id} ({dest_name})" if order_id else f"{label} ({dest_name})"
                cur.execute(
                    f"INSERT INTO {SCHEMA}.finance_transactions "
                    f"(kind, type_id, amount, note, affects_pnl, employee_id, cash_account_id, order_id, occurred_at) "
                    f"VALUES ('income', {type_id if type_id else 'NULL'}, {amount}, {esc(note)}, "
                    f"TRUE, {int(employee_id) if employee_id else 'NULL'}, "
                    f"{int(cash_account_id) if cash_account_id else 'NULL'}, "
                    f"{int(order_id) if order_id else 'NULL'}, NOW()) RETURNING id"
                )
                tx_id = cur.fetchone()[0]
                acct_note = note
                if employee_id:
                    credit_account(cur, employee_id, amount, acct_note, order_id)
                elif cash_account_id:
                    credit_cash(cur, cash_account_id, amount, acct_note, order_id)

                # отмечаем заказ
                if order_id:
                    if mode == "remaining":
                        cur.execute(
                            f"UPDATE {SCHEMA}.orders SET remaining_paid = TRUE, "
                            f"remaining_paid_amount = COALESCE(remaining_paid_amount,0) + {amount}, "
                            f"updated_at = NOW() WHERE id = {int(order_id)}"
                        )
                    else:
                        cur.execute(
                            f"UPDATE {SCHEMA}.orders SET prepayment_confirmed = TRUE, "
                            f"prepayment_amount = {amount}, "
                            f"prepayment_percent = CASE WHEN total > 0 THEN ROUND({amount}/total*100, 2) ELSE 0 END, "
                            f"updated_at = NOW() WHERE id = {int(order_id)}"
                        )
                conn.commit()
                return resp(200, {"ok": True, "id": tx_id})

            # Ручное зачисление/списание на счёт сотрудника
            if action == "credit_account":
                employee_id = body.get("employee_id")
                amount = num(body.get("amount"), 0)
                if not employee_id or amount == 0:
                    return resp(400, {"error": "employee_id and amount required"})
                credit_account(cur, employee_id, amount, body.get("note", "Корректировка"))
                conn.commit()
                return resp(200, {"ok": True})

            return resp(400, {"error": "unknown action"})

        # ── DELETE ──
        if method == "DELETE":
            if action == "del_tx":
                tx_id = params.get("id") or body.get("id")
                cur.execute(
                    f"DELETE FROM {SCHEMA}.finance_transactions WHERE id = {esc(tx_id)}"
                )
                conn.commit()
                return resp(200, {"ok": True})
            if action == "del_type":
                tid = params.get("id") or body.get("id")
                cur.execute(
                    f"DELETE FROM {SCHEMA}.finance_types WHERE id = {esc(tid)} AND is_system = FALSE"
                )
                conn.commit()
                return resp(200, {"ok": True})
            return resp(400, {"error": "unknown action"})

        return resp(405, {"error": "method not allowed"})
    finally:
        cur.close()
        conn.close()