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

def require_admin(cur, session_id):
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
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    action = params.get("action", "")
    headers = event.get("headers") or {}
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")

    conn = get_conn()
    cur = conn.cursor()

    def err(msg, code=400):
        return {"statusCode": code, "headers": cors, "body": json.dumps({"error": msg})}

    try:
        admin_id = require_admin(cur, session_id)
        if not admin_id:
            return err("Нет доступа", 403)

        # ── Сотрудники ──────────────────────────────────────────────────────────

        if action == "employees" and method == "GET":
            cur.execute(f"SELECT id, name, color, is_active FROM {SCHEMA}.employees ORDER BY name")
            rows = cur.fetchall()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "employees": [{"id": r[0], "name": r[1], "color": r[2], "is_active": r[3]} for r in rows]
            })}

        elif action == "employee_create" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            name = (body.get("name") or "").strip()
            color = body.get("color") or "#3b82f6"
            if not name:
                return err("Имя обязательно")
            cur.execute(f"INSERT INTO {SCHEMA}.employees (name, color) VALUES ({esc(name)}, {esc(color)}) RETURNING id")
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({"id": new_id, "name": name, "color": color, "is_active": True})}

        elif action == "employee_update" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            eid = int(body["id"])
            name = (body.get("name") or "").strip()
            color = body.get("color") or "#3b82f6"
            is_active = "TRUE" if body.get("is_active", True) else "FALSE"
            cur.execute(f"UPDATE {SCHEMA}.employees SET name={esc(name)}, color={esc(color)}, is_active={is_active} WHERE id={eid}")
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
            # Свои события месяца + ответственные
            cur.execute(
                f"SELECT ce.id, ce.event_date, ce.title, ce.description, "
                f"COALESCE(json_agg(json_build_object('id', e.id, 'name', e.name, 'color', e.color)) "
                f"  FILTER (WHERE e.id IS NOT NULL), '[]') as employees "
                f"FROM {SCHEMA}.calendar_events ce "
                f"LEFT JOIN {SCHEMA}.calendar_event_employees cee ON cee.event_id = ce.id "
                f"LEFT JOIN {SCHEMA}.employees e ON e.id = cee.employee_id "
                f"WHERE EXTRACT(YEAR FROM ce.event_date) = {year} "
                f"AND EXTRACT(MONTH FROM ce.event_date) = {month} "
                f"GROUP BY ce.id ORDER BY ce.event_date, ce.id"
            )
            events = [{
                "id": r[0], "event_date": r[1].isoformat() if r[1] else None,
                "title": r[2], "description": r[3], "employees": r[4], "kind": "event",
            } for r in cur.fetchall()]

            # Авто-события «забрать из магазина»: группируем ETA по (магазин, дата).
            # Одно событие на магазин в день, с числом заказов.
            cur.execute(
                f"SELECT eta.eta_date, st.id, st.name, st.code, "
                f"COUNT(DISTINCT wb.order_id) as orders_cnt "
                f"FROM {SCHEMA}.wip_component_eta eta "
                f"JOIN {SCHEMA}.warehouse_stores st ON st.id = eta.store_id "
                f"JOIN {SCHEMA}.wip_builds wb ON wb.id = eta.wip_id "
                f"WHERE eta.eta_date IS NOT NULL AND eta.store_id IS NOT NULL "
                f"AND EXTRACT(YEAR FROM eta.eta_date) = {year} "
                f"AND EXTRACT(MONTH FROM eta.eta_date) = {month} "
                f"AND wb.stage NOT IN ('Архив', 'Забрали', 'Отменён') "
                f"GROUP BY eta.eta_date, st.id, st.name, st.code "
                f"ORDER BY eta.eta_date"
            )
            pickups = [{
                "event_date": r[0].isoformat() if r[0] else None,
                "store_id": r[1], "store_name": r[2], "store_code": r[3],
                "orders_count": int(r[4]), "kind": "pickup",
            } for r in cur.fetchall()]

            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "events": events, "pickups": pickups
            })}

        elif action == "event_create" and method == "POST":
            body = json.loads(event.get("body") or "{}")
            title = (body.get("title") or "").strip()
            event_date = body.get("event_date")
            if not title or not event_date:
                return err("Нужны title и event_date")
            description = body.get("description") or ""
            employee_ids = body.get("employee_ids") or []
            cur.execute(
                f"INSERT INTO {SCHEMA}.calendar_events (event_date, title, description) "
                f"VALUES ({esc(event_date)}, {esc(title)}, {esc(description)}) RETURNING id"
            )
            eid = cur.fetchone()[0]
            for emp in employee_ids:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.calendar_event_employees (event_id, employee_id) "
                    f"VALUES ({eid}, {int(emp)}) ON CONFLICT DO NOTHING"
                )
            conn.commit()
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