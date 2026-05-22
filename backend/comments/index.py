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

def handler(event: dict, context) -> dict:
    """
    Комментарии к сборкам пользователей.
    GET ?token=... — получить комментарии сборки
    POST ?action=add — добавить комментарий (требует X-Session-Id)
    POST ?action=delete — удалить комментарий (требует X-Session-Id, только свои)
    POST ?action=mark_read — пометить уведомления прочитанными
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
    session_id = (event.get("headers") or {}).get("X-Session-Id") or params.get("session_id")

    conn = get_conn()
    cur = conn.cursor()

    def get_user(sid):
        if not sid:
            return None
        cur.execute(f"SELECT id, username, avatar_url FROM {SCHEMA}.users WHERE session_id = {esc(sid)}")
        return cur.fetchone()

    try:
        if method == "GET":
            token = params.get("token")
            if not token:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нет token"})}
            cur.execute(
                f"SELECT c.id, c.parent_id, c.text, c.created_at, c.user_id, u.username, u.avatar_url "
                f"FROM {SCHEMA}.build_comments c "
                f"JOIN {SCHEMA}.users u ON c.user_id = u.id "
                f"WHERE c.build_token = {esc(token)} "
                f"ORDER BY c.created_at ASC"
            )
            rows = cur.fetchall()
            comments = [
                {
                    "id": r[0], "parent_id": r[1], "text": r[2],
                    "created_at": r[3].isoformat() if r[3] else None,
                    "user_id": r[4], "username": r[5], "avatar_url": r[6] or "",
                }
                for r in rows
            ]
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"comments": comments})}

        elif method == "POST" and action == "add":
            u = get_user(session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            token = body.get("token")
            text = (body.get("text") or "").strip()
            parent_id = body.get("parent_id")
            if not token or not text:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нет token или text"})}

            parent_sql = str(parent_id) if parent_id else "NULL"
            cur.execute(
                f"INSERT INTO {SCHEMA}.build_comments (build_token, user_id, parent_id, text) "
                f"VALUES ({esc(token)}, {u[0]}, {parent_sql}, {esc(text)}) RETURNING id, created_at"
            )
            new_id, created_at = cur.fetchone()

            # Уведомление автору сборки (или автору родительского комментария)
            notify_user_id = None
            notify_text = None
            link = f"/configurator?build={token}#comment-{new_id}"

            if parent_id:
                # Ответ на комментарий — уведомляем автора родительского
                cur.execute(f"SELECT user_id, text FROM {SCHEMA}.build_comments WHERE id = {parent_id}")
                parent_row = cur.fetchone()
                if parent_row and parent_row[0] != u[0]:
                    notify_user_id = parent_row[0]
                    preview = parent_row[1][:40] + ("..." if len(parent_row[1]) > 40 else "")
                    notify_text = f"{u[1]} ответил на ваш комментарий: «{preview}»"
            else:
                # Комментарий к сборке — уведомляем автора сборки
                cur.execute(f"SELECT user_id FROM {SCHEMA}.user_builds WHERE share_token = {esc(token)}")
                build_row = cur.fetchone()
                if build_row and build_row[0] != u[0]:
                    notify_user_id = build_row[0]
                    preview = text[:40] + ("..." if len(text) > 40 else "")
                    notify_text = f"{u[1]} прокомментировал вашу сборку: «{preview}»"

            if notify_user_id and notify_text:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.notifications (user_id, type, text, link) "
                    f"VALUES ({notify_user_id}, 'comment', {esc(notify_text)}, {esc(link)})"
                )

            conn.commit()
            return {"statusCode": 201, "headers": cors, "body": json.dumps({
                "id": new_id, "parent_id": parent_id, "text": text,
                "created_at": created_at.isoformat(),
                "user_id": u[0], "username": u[1], "avatar_url": u[2] or "",
            })}

        elif method == "POST" and action == "delete":
            u = get_user(session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            comment_id = int(body.get("id", 0))
            cur.execute(f"UPDATE {SCHEMA}.build_comments SET text = '[удалено]' WHERE id = {comment_id} AND user_id = {u[0]}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}

    finally:
        cur.close()
        conn.close()
