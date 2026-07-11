import json
import os
import psycopg2
from psycopg2.extras import Json


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def handler(event: dict, context) -> dict:
    """
    Анкета подбора ПК (quiz) — вопросы, заявки клиентов и админ-управление.

    GET  /?resource=questions            — активные вопросы анкеты (для клиента)
    GET  /?resource=questions&all=true   — все вопросы (для админки)
    POST /?resource=submit               — клиент отправляет заполненную анкету
    GET  /?resource=requests             — список заявок (для админки)
    PATCH/?resource=requests             — обновить статус заявки (body: id, status)
    DELETE /?resource=requests&id=N      — удалить заявку

    POST /?resource=questions            — создать вопрос (админ)
    PUT  /?resource=questions            — обновить вопрос (админ, body.id)
    DELETE /?resource=questions&id=N     — удалить вопрос (админ)
    """
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
    }
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    method = event.get("httpMethod", "GET")
    params = event.get("queryStringParameters") or {}
    resource = params.get("resource", "questions")
    body = json.loads(event.get("body") or "{}")

    conn = get_conn()
    cur = conn.cursor()

    def ok(data, status=200):
        return {"statusCode": status, "headers": cors, "body": json.dumps(data, default=str)}

    def question_row(r):
        return {
            "id": r[0], "sort_order": r[1], "title": r[2],
            "field_type": r[3], "options": r[4] or [], "is_active": r[5],
            "description": r[6] if len(r) > 6 else "",
        }

    def request_row(r):
        return {
            "id": r[0], "name": r[1], "phone": r[2], "contact_method": r[3],
            "budget_min": r[4], "budget_max": r[5], "answers": r[6] or {},
            "extra_wishes": r[7], "status": r[8],
            "created_at": r[9].isoformat() if r[9] else None,
            "telegram_tag": r[10] if len(r) > 10 else None,
        }

    # ─────────── ВОПРОСЫ ───────────
    if resource == "questions":
        if method == "GET":
            only_active = params.get("all") != "true"
            where = "WHERE is_active = TRUE" if only_active else ""
            cur.execute(
                f"SELECT id, sort_order, title, field_type, options, is_active, description "
                f"FROM quiz_questions {where} ORDER BY sort_order, id"
            )
            rows = [question_row(r) for r in cur.fetchall()]
            return ok({"questions": rows})

        if method == "POST":
            cur.execute(
                "INSERT INTO quiz_questions (sort_order, title, field_type, options, is_active, description) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (body.get("sort_order", 0), body.get("title", ""),
                 body.get("field_type", "multi"), Json(body.get("options", [])),
                 body.get("is_active", True), body.get("description", "")),
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return ok({"id": new_id, "ok": True}, 201)

        if method == "PUT":
            cur.execute(
                "UPDATE quiz_questions SET sort_order=%s, title=%s, field_type=%s, "
                "options=%s, is_active=%s, description=%s WHERE id=%s",
                (body.get("sort_order", 0), body.get("title", ""),
                 body.get("field_type", "multi"), Json(body.get("options", [])),
                 body.get("is_active", True), body.get("description", ""), body["id"]),
            )
            conn.commit()
            return ok({"ok": True})

        if method == "DELETE":
            qid = params.get("id")
            cur.execute("DELETE FROM quiz_questions WHERE id=%s", (qid,))
            conn.commit()
            return ok({"ok": True})

    # ─────────── ОТПРАВКА АНКЕТЫ КЛИЕНТОМ ───────────
    if resource == "submit" and method == "POST":
        _tg_tag = (body.get("telegram_tag") or "").strip().lstrip("@")
        # UTM-метки, пойманные с лендинга (для аналитики источников)
        _utm_source = (body.get("utm_source") or "").strip() or None
        _utm_medium = (body.get("utm_medium") or "").strip() or None
        _utm_campaign = (body.get("utm_campaign") or "").strip() or None
        # Авто-подбор источника по utm_source
        _source_id = None
        if _utm_source:
            cur.execute(
                "SELECT id FROM marketing_sources "
                "WHERE is_active = TRUE AND LOWER(utm_source) = LOWER(%s) "
                "ORDER BY sort_order LIMIT 1",
                (_utm_source,)
            )
            _sm = cur.fetchone()
            if _sm:
                _source_id = _sm[0]
        cur.execute(
            "INSERT INTO quiz_requests (name, phone, contact_method, budget_min, "
            "budget_max, answers, extra_wishes, telegram_tag, status, "
            "source_id, utm_source, utm_medium, utm_campaign) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'new', %s, %s, %s, %s) RETURNING id",
            (body.get("name"), body.get("phone"), body.get("contact_method"),
             body.get("budget_min"), body.get("budget_max"),
             Json(body.get("answers", {})), body.get("extra_wishes"),
             _tg_tag or None,
             _source_id, _utm_source, _utm_medium, _utm_campaign),
        )
        new_id = cur.fetchone()[0]
        conn.commit()

        try:
            from tg_notify import notify_managers
            _bmin = body.get("budget_min")
            _bmax = body.get("budget_max")
            _budget = ""
            if _bmin or _bmax:
                _budget = f"\nБюджет: {_bmin or '?'}–{_bmax or '?'} ₽"
            _method = body.get("contact_method", "—")
            if _method == "telegram":
                if _tg_tag:
                    _contact = f"Telegram: <a href=\"https://t.me/{_tg_tag}\">@{_tg_tag}</a>"
                else:
                    _contact = "Telegram (тег не указан, искать по телефону)"
            else:
                _contact = f"Связь: {_method}"
            _base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
            _link = f"\n🔗 <a href=\"{_base}/admin/quiz_requests\">Открыть заявки</a>" if _base else ""
            notify_managers(
                f"🎯 <b>Новый лид из квиза</b>\n"
                f"Имя: {body.get('name','—')}\n"
                f"Телефон: {body.get('phone','—')}\n"
                f"{_contact}"
                f"{_budget}"
                f"{_link}"
            )
        except Exception as _e:
            print(f"TG_NOTIFY quiz: {_e}")

        return ok({"id": new_id, "ok": True}, 201)

    # ─────────── ЗАЯВКИ (АДМИН) ───────────
    if resource == "requests":
        if method == "GET":
            # автоочистка selftest-мусора (тестовые прогоны деплоя)
            cur.execute("DELETE FROM quiz_requests WHERE name = '__selftest__'")
            cur.execute("DELETE FROM quiz_questions WHERE title LIKE '__selftest%%'")
            conn.commit()
            cur.execute(
                "SELECT id, name, phone, contact_method, budget_min, budget_max, "
                "answers, extra_wishes, status, created_at, telegram_tag "
                "FROM quiz_requests ORDER BY created_at DESC"
            )
            rows = [request_row(r) for r in cur.fetchall()]
            return ok({"requests": rows})

        if method == "PATCH":
            cur.execute(
                "UPDATE quiz_requests SET status=%s WHERE id=%s",
                (body.get("status", "new"), body["id"]),
            )
            conn.commit()
            return ok({"ok": True})

        if method == "DELETE":
            rid = params.get("id")
            cur.execute("DELETE FROM quiz_requests WHERE id=%s", (rid,))
            conn.commit()
            return ok({"ok": True})

    return {"statusCode": 405, "headers": cors, "body": json.dumps({"error": "Method not allowed"})}