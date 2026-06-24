import json
import os
import psycopg2

SCHEMA = "t_p72635010_quantum_fusion_resea"

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def esc(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

# Пароль входа в админ-панель берём из секрета ADMIN_KEY (фолбэк — старое значение).
ADMIN_PASSWORD = os.environ.get("ADMIN_KEY", "begraphics2024")


def require_admin(cur, session_id, admin_key=None):
    # 1) Доступ по admin-паролю панели (основной способ входа в админку)
    if admin_key and admin_key == ADMIN_PASSWORD:
        return -1
    # 2) Доступ по сессии пользователя с ролью admin
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


def _carry_over_tasks(cur):
    """
    Переносит (копирует) невыполненные задачи на сегодня.
    Для каждой цепочки задач (по origin_id) берём последнюю копию. Если она
    раньше сегодня и статус не 'done' — создаём копию на сегодняшнюю дату
    (если её ещё нет). Ответственные копируются. origin_id/origin_date цепочки
    сохраняются — это даёт корректный счётчик дней простоя (xN).
    """
    # Последняя копия каждой цепочки задач (origin_id), не завершённая, в прошлом
    cur.execute(
        f"""
        WITH chains AS (
            SELECT COALESCE(origin_id, id) AS chain_id, MAX(event_date) AS last_date
            FROM {SCHEMA}.calendar_events
            WHERE kind = 'task'
            GROUP BY COALESCE(origin_id, id)
        )
        SELECT ce.id, ce.title, ce.description, ce.status,
               COALESCE(ce.origin_id, ce.id) AS origin_id,
               COALESCE(ce.origin_date, ce.event_date) AS origin_date
        FROM {SCHEMA}.calendar_events ce
        JOIN chains c ON c.chain_id = COALESCE(ce.origin_id, ce.id)
                      AND c.last_date = ce.event_date
        WHERE ce.kind = 'task' AND ce.status <> 'done' AND ce.event_date < CURRENT_DATE
        """
    )
    rows = cur.fetchall()
    for (eid, title, descr, status, origin_id, origin_date) in rows:
        # Нет ли уже копии этой цепочки на сегодня
        cur.execute(
            f"SELECT 1 FROM {SCHEMA}.calendar_events "
            f"WHERE kind='task' AND COALESCE(origin_id, id) = {int(origin_id)} "
            f"AND event_date = CURRENT_DATE LIMIT 1"
        )
        if cur.fetchone():
            continue
        # Создаём копию на сегодня (статус сохраняем: new/in_progress)
        cur.execute(
            f"INSERT INTO {SCHEMA}.calendar_events "
            f"(event_date, title, description, kind, status, origin_id, origin_date) "
            f"VALUES (CURRENT_DATE, {esc(title)}, {esc(descr or '')}, 'task', {esc(status)}, "
            f"{int(origin_id)}, {esc(origin_date.isoformat())}) RETURNING id"
        )
        new_id = cur.fetchone()[0]
        # Копируем ответственных
        cur.execute(
            f"INSERT INTO {SCHEMA}.calendar_event_employees (event_id, employee_id) "
            f"SELECT {new_id}, employee_id FROM {SCHEMA}.calendar_event_employees "
            f"WHERE event_id = {int(eid)} ON CONFLICT DO NOTHING"
        )
        # Стираем прошлые «хвосты» цепочки (x2/x3/x4 и исходную) — оставляем
        # только сегодняшнюю копию. origin_id/origin_date уже сохранены в ней,
        # поэтому счётчик дней простоя не теряется.
        cur.execute(
            f"DELETE FROM {SCHEMA}.calendar_event_employees "
            f"WHERE event_id IN (SELECT id FROM {SCHEMA}.calendar_events "
            f"  WHERE kind='task' AND COALESCE(origin_id, id) = {int(origin_id)} "
            f"  AND event_date < CURRENT_DATE)"
        )
        cur.execute(
            f"DELETE FROM {SCHEMA}.calendar_events "
            f"WHERE kind='task' AND COALESCE(origin_id, id) = {int(origin_id)} "
            f"AND event_date < CURRENT_DATE"
        )


def handler(event: dict, context) -> dict:
    """
    Расписание сотрудников.
    GET ?action=employees — список сотрудников
    POST ?action=employee_create — создать сотрудника {name, color}
    POST ?action=employee_update — обновить {id, name, color, is_active}
    POST ?action=employee_delete — удалить {id}
    GET ?action=schedules&year=YYYY&month=MM — расписание за месяц
    POST ?action=schedule_set — установить смену {employee_id, work_date, time_start, time_end, is_day_off}
    POST ?action=schedule_delete — удалить смену {employee_id, work_date}
    GET ?action=summary&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD — сводка
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id, X-Admin-Key",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    action = params.get("action", "")
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")

    # admin-пароль панели: из заголовка X-Admin-Key, query (?ak=) или тела
    admin_key = headers.get("X-Admin-Key") or headers.get("x-admin-key") or params.get("ak")
    if not admin_key and method == "POST":
        try:
            admin_key = (json.loads(event.get("body") or "{}")).get("ak")
        except (ValueError, TypeError):
            admin_key = None

    conn = get_conn()
    cur = conn.cursor()

    def err(msg, code=400):
        return {"statusCode": code, "headers": cors, "body": json.dumps({"error": msg})}

    try:
        # ── Разовая чистка: удалить ВСЕ авто-события «Задержка» из календаря ──────
        # Они захламляли календарь и размножались автопереносом задач.
        if action == "cleanup_delay_events":
            cur.execute(
                f"DELETE FROM {SCHEMA}.calendar_event_employees WHERE event_id IN "
                f"(SELECT id FROM {SCHEMA}.calendar_events WHERE title LIKE '⚠️ Задержка%')"
            )
            cur.execute(
                f"DELETE FROM {SCHEMA}.calendar_events WHERE title LIKE '⚠️ Задержка%'"
            )
            deleted = cur.rowcount
            conn.commit()
            return {"statusCode": 200, "headers": cors,
                    "body": json.dumps({"ok": True, "deleted": deleted})}

        # ── Утренний автопинг (11:00) — вызывается планировщиком ──────────────────
        # Доступ по admin-паролю панели (ak) ИЛИ по сессии админа.
        if action == "morning_ping":
            if require_admin(cur, session_id, admin_key) is None:
                return err("Нет доступа", 403)
            from tg_notify import notify_managers, notify_tasks

            def fmt_resp(emp_rows):
                """emp_rows: список (name, tag). Возвращает '@tag1, @tag2' либо имена."""
                parts = []
                for nm, tg in emp_rows:
                    parts.append(f"@{tg}" if tg else (nm or ""))
                return ", ".join([p for p in parts if p])

            sent = []
            _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
            _cal_link = f"\n🔗 <a href=\"{_base}/admin/calendar\">Открыть календарь</a>" if _base else ""

            # 1) ЗАБОР ЗАКАЗОВ на сегодня (wip_component_eta по магазинам)
            cur.execute(
                f"SELECT COALESCE(st.name, 'Магазин не указан') AS store, "
                f"COUNT(DISTINCT wb.order_id) AS cnt "
                f"FROM {SCHEMA}.wip_component_eta eta "
                f"LEFT JOIN {SCHEMA}.warehouse_stores st ON st.id = eta.store_id "
                f"JOIN {SCHEMA}.wip_builds wb ON wb.id = eta.wip_id "
                f"WHERE eta.eta_date = CURRENT_DATE "
                f"AND wb.stage NOT IN ('Архив', 'Забрали', 'Отменён') "
                f"GROUP BY st.name ORDER BY store"
            )
            pickups = cur.fetchall()
            if pickups:
                lines = ["📦 <b>Забрать заказы сегодня</b>", ""]
                for store, cnt in pickups:
                    lines.append(f"• {store} — {int(cnt)} заказ(ов)")
                notify_managers("\n".join(lines) + _cal_link)
                sent.append("pickups")

            # 2) ЗАДАЧИ НА СЕГОДНЯ (calendar_events kind='task', не done) + ответственные
            cur.execute(
                f"SELECT ce.id, ce.title, ce.description, ce.origin_date, ce.event_date, "
                f"COALESCE(json_agg(json_build_object('name', e.name, 'tag', e.telegram_tag)) "
                f"  FILTER (WHERE e.id IS NOT NULL), '[]') AS emps "
                f"FROM {SCHEMA}.calendar_events ce "
                f"LEFT JOIN {SCHEMA}.calendar_event_employees cee ON cee.event_id = ce.id "
                f"LEFT JOIN {SCHEMA}.employees e ON e.id = cee.employee_id "
                f"WHERE ce.kind='task' AND ce.status <> 'done' AND ce.event_date = CURRENT_DATE "
                f"GROUP BY ce.id ORDER BY ce.id"
            )
            tasks = cur.fetchall()
            if tasks:
                blocks = ["📋 <b>Задачи на сегодня</b>"]
                for _id, title, descr, origin_date, event_date, emps_json in tasks:
                    emps = json.loads(emps_json) if isinstance(emps_json, str) else (emps_json or [])
                    resp = fmt_resp([(e.get("name"), e.get("tag")) for e in emps])
                    # Дни простоя задачи (xN) — если переносилась с прошлых дней
                    days_idle = 0
                    if origin_date and event_date:
                        days_idle = (event_date - origin_date).days + 1
                    _x = f" <b>×{days_idle}</b>" if days_idle > 1 else ""
                    block = f"\n━━━━━━━━━━\n• <b>{title}</b>{_x}"
                    if descr:
                        block += f"\n{descr}"
                    if resp:
                        block += f"\nОтветственные: {resp}"
                    blocks.append(block)
                notify_tasks("\n".join(blocks) + _cal_link)
                sent.append("tasks")

            # 3) КОРЗИНА ЗАКУПКИ: есть железо для заказа (status=NEW) — в основной чат
            cur.execute(
                f"SELECT COUNT(*), COALESCE(SUM(required_qty), 0) "
                f"FROM {SCHEMA}.warehouse_purchase_basket "
                f"WHERE status = 'NEW' AND required_qty > 0"
            )
            _b = cur.fetchone()
            basket_positions = int(_b[0]) if _b else 0
            basket_qty = int(_b[1]) if _b else 0
            if basket_positions > 0:
                _wip_link = f"\n🔗 <a href=\"{_base}/admin/wip_builds\">Открыть корзину закупки</a>" if _base else ""
                notify_managers(
                    f"🛒 <b>В корзине закупки есть железо для заказа</b>\n"
                    f"Позиций: {basket_positions} (всего {basket_qty} шт)" + _wip_link
                )
                sent.append("basket")

            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True, "sent": sent})}

        admin_id = require_admin(cur, session_id, admin_key)
        if admin_id is None:
            return err("Нет доступа", 403)

        # ── Сотрудники ──────────────────────────────────────────────────────────

        if action == "employees" and method == "GET":
            cur.execute(f"SELECT id, name, color, is_active, COALESCE(assembler_percent, 0), COALESCE(telegram_tag, '') FROM {SCHEMA}.employees ORDER BY name")
            rows = cur.fetchall()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "employees": [{"id": r[0], "name": r[1], "color": r[2], "is_active": r[3], "assembler_percent": float(r[4]), "telegram_tag": r[5]} for r in rows]
            })}

        elif action == "employee_create" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            name = (body.get("name") or "").strip()
            color = body.get("color") or "#3b82f6"
            tg_tag = (body.get("telegram_tag") or "").strip().lstrip("@")
            if not name:
                return err("Имя обязательно")
            cur.execute(f"INSERT INTO {SCHEMA}.employees (name, color, telegram_tag) VALUES ({esc(name)}, {esc(color)}, {esc(tg_tag) if tg_tag else 'NULL'}) RETURNING id")
            new_id = cur.fetchone()[0]
            # Автосоздание финансового счёта сотрудника
            cur.execute(
                f"INSERT INTO {SCHEMA}.employee_accounts (employee_id, balance) "
                f"VALUES ({new_id}, 0) ON CONFLICT (employee_id) DO NOTHING"
            )
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "name": name, "color": color, "is_active": True})}

        elif action == "employee_update" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            eid = int(body["id"])
            name = (body.get("name") or "").strip()
            color = body.get("color") or "#3b82f6"
            is_active = "TRUE" if body.get("is_active", True) else "FALSE"
            asm_pct = float(body.get("assembler_percent", 0) or 0)
            tg_tag = (body.get("telegram_tag") or "").strip().lstrip("@")
            tg_sql = esc(tg_tag) if tg_tag else "NULL"
            cur.execute(f"UPDATE {SCHEMA}.employees SET name={esc(name)}, color={esc(color)}, is_active={is_active}, assembler_percent={asm_pct}, telegram_tag={tg_sql} WHERE id={eid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif action == "employee_delete" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            eid = int(body["id"])
            cur.execute(f"UPDATE {SCHEMA}.employees SET is_active=FALSE WHERE id={eid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # ── Расписание ──────────────────────────────────────────────────────────

        elif action == "schedules" and method == "GET":
            year = int(params.get("year", 2026))
            month = int(params.get("month", 1))
            cur.execute(
                f"SELECT s.id, s.employee_id, s.work_date, s.time_start, s.time_end, s.is_day_off, s.note "
                f"FROM {SCHEMA}.schedules s "
                f"JOIN {SCHEMA}.employees e ON e.id = s.employee_id "
                f"WHERE EXTRACT(YEAR FROM s.work_date) = {year} "
                f"AND EXTRACT(MONTH FROM s.work_date) = {month} "
                f"ORDER BY s.work_date, e.name"
            )
            rows = cur.fetchall()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "schedules": [{
                    "id": r[0], "employee_id": r[1],
                    "work_date": r[2].isoformat() if r[2] else None,
                    "time_start": r[3], "time_end": r[4],
                    "is_day_off": r[5], "note": r[6],
                } for r in rows]
            })}

        elif action == "schedule_set" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            emp_id = int(body["employee_id"])
            work_date = body["work_date"]
            time_start = esc(body.get("time_start"))
            time_end = esc(body.get("time_end"))
            is_day_off = "TRUE" if body.get("is_day_off") else "FALSE"
            note = esc(body.get("note"))
            cur.execute(
                f"INSERT INTO {SCHEMA}.schedules (employee_id, work_date, time_start, time_end, is_day_off, note) "
                f"VALUES ({emp_id}, {esc(work_date)}, {time_start}, {time_end}, {is_day_off}, {note}) "
                f"ON CONFLICT (employee_id, work_date) DO UPDATE SET "
                f"time_start={time_start}, time_end={time_end}, is_day_off={is_day_off}, note={note}, updated_at=NOW() "
                f"RETURNING id"
            )
            rid = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"id": rid, "ok": True})}

        elif action == "schedule_delete" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            emp_id = int(body["employee_id"])
            work_date = body["work_date"]
            cur.execute(f"DELETE FROM {SCHEMA}.schedules WHERE employee_id={emp_id} AND work_date={esc(work_date)}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif action == "summary" and method == "GET":
            date_from = params.get("date_from")
            date_to = params.get("date_to")
            if not date_from or not date_to:
                return err("Нужны date_from и date_to")
            cur.execute(
                f"SELECT e.id, e.name, e.color, "
                f"COUNT(CASE WHEN s.is_day_off = FALSE AND (s.note IS NULL OR s.note != 'Отсутствовал') THEN 1 END) as work_days, "
                f"COUNT(CASE WHEN s.is_day_off = TRUE THEN 1 END) as day_offs, "
                f"COUNT(CASE WHEN s.note = 'Отсутствовал' THEN 1 END) as absent_days, "
                f"COALESCE(SUM(CASE WHEN s.is_day_off = FALSE AND s.time_start IS NOT NULL AND s.time_end IS NOT NULL "
                f"THEN EXTRACT(EPOCH FROM (TO_TIMESTAMP(s.time_end,'HH24:MI') - TO_TIMESTAMP(s.time_start,'HH24:MI')))/3600.0 "
                f"ELSE 0 END), 0) as total_hours "
                f"FROM {SCHEMA}.employees e "
                f"LEFT JOIN {SCHEMA}.schedules s ON s.employee_id = e.id "
                f"AND s.work_date BETWEEN {esc(date_from)} AND {esc(date_to)} "
                f"WHERE e.is_active = TRUE "
                f"GROUP BY e.id, e.name, e.color ORDER BY e.name"
            )
            rows = cur.fetchall()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "summary": [{
                    "id": r[0], "name": r[1], "color": r[2],
                    "work_days": int(r[3]) if r[3] else 0,
                    "day_offs": int(r[4]) if r[4] else 0,
                    "absent_days": int(r[5]) if r[5] else 0,
                    "total_hours": round(float(r[6]), 1) if r[6] else 0,
                } for r in rows]
            })}

        # ── Календарь событий ───────────────────────────────────────────────────

        elif action == "events" and method == "GET":
            year = int(params.get("year", 2026))
            month = int(params.get("month", 1))

            # Авто-перенос невыполненных задач (kind='task', status != 'done')
            # из прошлых дней на сегодня. Копируем (дублируем) последнюю копию
            # цепочки на сегодняшнюю дату, если её там ещё нет.
            _carry_over_tasks(cur)
            conn.commit()

            # Свои события/задачи месяца + ответственные
            cur.execute(
                f"SELECT ce.id, ce.event_date, ce.title, ce.description, ce.kind, ce.status, "
                f"ce.origin_id, ce.origin_date, "
                f"COALESCE(json_agg(json_build_object('id', e.id, 'name', e.name, 'color', e.color)) "
                f"  FILTER (WHERE e.id IS NOT NULL), '[]') as employees "
                f"FROM {SCHEMA}.calendar_events ce "
                f"LEFT JOIN {SCHEMA}.calendar_event_employees cee ON cee.event_id = ce.id "
                f"LEFT JOIN {SCHEMA}.employees e ON e.id = cee.employee_id "
                f"WHERE EXTRACT(YEAR FROM ce.event_date) = {year} "
                f"AND EXTRACT(MONTH FROM ce.event_date) = {month} "
                f"GROUP BY ce.id ORDER BY ce.event_date, ce.id"
            )
            events = []
            for r in cur.fetchall():
                kind = r[4] or "event"
                origin_date = r[7]
                event_date = r[1]
                # Дни простоя задачи = дни с первого дня (origin_date) до текущей даты копии
                days_idle = 0
                if kind == "task" and origin_date and event_date:
                    days_idle = (event_date - origin_date).days + 1
                events.append({
                    "id": r[0], "event_date": event_date.isoformat() if event_date else None,
                    "title": r[2], "description": r[3], "kind": kind, "status": r[5] or "new",
                    "origin_id": r[6], "days_idle": days_idle, "employees": r[8],
                })

            # Авто-события «забрать из магазина»: группируем ETA по (магазин, дата).
            # Одно событие на магазин в день, с числом заказов. Магазин не выбран →
            # отдельная группа «Магазин не указан» (LEFT JOIN), чтобы забор был виден.
            cur.execute(
                f"SELECT eta.eta_date, st.id, st.name, st.code, "
                f"COUNT(DISTINCT wb.order_id) as orders_cnt "
                f"FROM {SCHEMA}.wip_component_eta eta "
                f"LEFT JOIN {SCHEMA}.warehouse_stores st ON st.id = eta.store_id "
                f"JOIN {SCHEMA}.wip_builds wb ON wb.id = eta.wip_id "
                f"WHERE eta.eta_date IS NOT NULL "
                f"AND EXTRACT(YEAR FROM eta.eta_date) = {year} "
                f"AND EXTRACT(MONTH FROM eta.eta_date) = {month} "
                f"AND wb.stage NOT IN ('Архив', 'Забрали', 'Отменён') "
                f"GROUP BY eta.eta_date, st.id, st.name, st.code "
                f"ORDER BY eta.eta_date"
            )
            pickups = [{
                "event_date": r[0].isoformat() if r[0] else None,
                "store_id": r[1], "store_name": r[2] or "Магазин не указан",
                "store_code": r[3] or "—",
                "orders_count": int(r[4]), "kind": "pickup",
            } for r in cur.fetchall()]

            # Авто-события «выдача ПК» по дате выдачи (issued_at) из wip_builds
            cur.execute(
                f"SELECT wb.issued_at, wb.order_number, wb.order_id, "
                f"COALESCE(o.customer_name, '') as customer "
                f"FROM {SCHEMA}.wip_builds wb "
                f"LEFT JOIN {SCHEMA}.orders o ON o.id = wb.order_id "
                f"WHERE wb.issued_at IS NOT NULL "
                f"AND EXTRACT(YEAR FROM wb.issued_at) = {year} "
                f"AND EXTRACT(MONTH FROM wb.issued_at) = {month} "
                f"AND wb.stage NOT IN ('Архив', 'Отменён') "
                f"ORDER BY wb.issued_at"
            )
            handouts = [{
                "event_date": r[0].isoformat() if r[0] else None,
                "order_number": r[1], "order_id": r[2], "customer_name": r[3],
                "kind": "handout",
            } for r in cur.fetchall()]

            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "events": events, "pickups": pickups, "handouts": handouts
            })}

        elif action == "event_create" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            title = (body.get("title") or "").strip()
            event_date = body.get("event_date")
            if not title or not event_date:
                return err("Нужны title и event_date")
            description = body.get("description") or ""
            employee_ids = body.get("employee_ids") or []
            kind = body.get("kind") or "event"
            if kind not in ("event", "task"):
                kind = "event"
            status = body.get("status") or "new"
            # Для задачи origin_date = дата создания (первый день цепочки)
            origin_date = esc(event_date) if kind == "task" else "NULL"
            cur.execute(
                f"INSERT INTO {SCHEMA}.calendar_events "
                f"(event_date, title, description, kind, status, origin_date) "
                f"VALUES ({esc(event_date)}, {esc(title)}, {esc(description)}, "
                f"{esc(kind)}, {esc(status)}, {origin_date}) RETURNING id"
            )
            eid = cur.fetchone()[0]
            for emp in employee_ids:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.calendar_event_employees (event_id, employee_id) "
                    f"VALUES ({eid}, {int(emp)}) ON CONFLICT DO NOTHING"
                )
            conn.commit()

            try:
                from tg_notify import notify_tasks
                _emp_parts = []
                if employee_ids:
                    ids_csv = ",".join(str(int(e)) for e in employee_ids)
                    cur.execute(f"SELECT name, telegram_tag FROM {SCHEMA}.employees WHERE id IN ({ids_csv})")
                    for nm, tg in cur.fetchall():
                        # Тегаем сотрудника, если задан telegram_tag, иначе пишем имя
                        _emp_parts.append(f"@{tg}" if tg else (nm or ""))
                _emp_parts = [p for p in _emp_parts if p]
                _kind_label = "Задача" if kind == "task" else "Событие"
                _resp = ("\nОтветственные: " + ", ".join(_emp_parts)) if _emp_parts else ""
                _descr = ("\n" + description) if description else ""
                notify_tasks(
                    f"📅 <b>{_kind_label} в календаре</b>\n"
                    f"{title}\n"
                    f"Дата: {event_date}"
                    f"{_resp}{_descr}"
                )
            except Exception as _e:
                print(f"TG_NOTIFY calendar: {_e}")

            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": eid, "ok": True})}

        elif action == "event_update" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            eid = int(body["id"])
            title = (body.get("title") or "").strip()
            event_date = body.get("event_date")
            description = body.get("description") or ""
            employee_ids = body.get("employee_ids") or []
            cur.execute(
                f"UPDATE {SCHEMA}.calendar_events SET title={esc(title)}, "
                f"event_date={esc(event_date)}, description={esc(description)}, updated_at=NOW() WHERE id={eid}"
            )
            cur.execute(f"DELETE FROM {SCHEMA}.calendar_event_employees WHERE event_id={eid}")
            for emp in employee_ids:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.calendar_event_employees (event_id, employee_id) "
                    f"VALUES ({eid}, {int(emp)}) ON CONFLICT DO NOTHING"
                )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        # Смена статуса задачи (доступна любому сотруднику, без отдельной авторизации)
        elif action == "event_set_status" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            eid = int(body["id"])
            status = body.get("status")
            if status not in ("new", "in_progress", "done"):
                return err("Неверный статус")
            cur.execute(
                f"UPDATE {SCHEMA}.calendar_events SET status={esc(status)}, updated_at=NOW() "
                f"WHERE id={eid} AND kind='task'"
            )
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif action == "event_delete" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            eid = int(body["id"])
            cur.execute(f"DELETE FROM {SCHEMA}.calendar_event_employees WHERE event_id={eid}")
            cur.execute(f"DELETE FROM {SCHEMA}.calendar_events WHERE id={eid}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        return err("Неизвестный action", 404)

    finally:
        cur.close()
        conn.close()