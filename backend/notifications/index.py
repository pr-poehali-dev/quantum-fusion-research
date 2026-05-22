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
    Уведомления пользователя.
    GET — получить уведомления (требует X-Session-Id)
    POST ?action=read — пометить уведомление прочитанным
    POST ?action=read_all — пометить все прочитанными
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
        cur.execute(f"SELECT id FROM {SCHEMA}.users WHERE session_id = {esc(sid)}")
        return cur.fetchone()

    try:
        u = get_user(session_id)
        if not u:
            return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}

        if method == "GET":
            cur.execute(
                f"SELECT id, type, text, link, is_read, created_at "
                f"FROM {SCHEMA}.notifications "
                f"WHERE user_id = {u[0]} "
                f"ORDER BY created_at DESC LIMIT 50"
            )
            rows = cur.fetchall()
            items = [
                {
                    "id": r[0], "type": r[1], "text": r[2], "link": r[3],
                    "is_read": r[4], "created_at": r[5].isoformat() if r[5] else None,
                }
                for r in rows
            ]
            unread = sum(1 for r in rows if not r[4])
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"notifications": items, "unread": unread})}

        elif method == "POST" and action == "read":
            body = json.loads(event.get("body") or "{}")
            nid = int(body.get("id", 0))
            cur.execute(f"UPDATE {SCHEMA}.notifications SET is_read = TRUE WHERE id = {nid} AND user_id = {u[0]}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        elif method == "POST" and action == "read_all":
            cur.execute(f"UPDATE {SCHEMA}.notifications SET is_read = TRUE WHERE user_id = {u[0]}")
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}

    finally:
        cur.close()
        conn.close()
