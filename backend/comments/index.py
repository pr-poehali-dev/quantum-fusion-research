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
    Комментарии к сборкам и статьям.
    GET ?token=...              — комментарии к сборке
    GET ?article_id=...         — комментарии к статье
    POST ?action=add            — добавить комментарий (token или article_id в body, требует X-Session-Id)
    POST ?action=delete         — удалить комментарий (требует X-Session-Id, только свои)
    POST ?action=vote           — лайк/дизлайк комментария (body: id, value=1|-1|0; требует X-Session-Id)
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
        cur.execute(
            f"SELECT u.id, u.username, u.avatar_url FROM {SCHEMA}.user_sessions s "
            f"JOIN {SCHEMA}.users u ON s.user_id = u.id "
            f"WHERE s.id = {esc(sid)} AND s.expires_at > NOW()"
        )
        return cur.fetchone()

    def fetch_comments(token, me_id=None):
        cur.execute(
            f"SELECT c.id, c.parent_id, c.text, c.created_at, c.user_id, u.username, u.avatar_url, "
            f"COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0) AS likes, "
            f"COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes, "
            f"COALESCE(MAX(CASE WHEN v.user_id = {int(me_id)} THEN v.value ELSE 0 END), 0) AS my_vote "
            f"FROM {SCHEMA}.build_comments c "
            f"JOIN {SCHEMA}.users u ON c.user_id = u.id "
            f"LEFT JOIN {SCHEMA}.comment_votes v ON v.comment_id = c.id "
            f"WHERE c.build_token = {esc(token)} "
            f"GROUP BY c.id, c.parent_id, c.text, c.created_at, c.user_id, u.username, u.avatar_url "
            f"ORDER BY c.created_at ASC"
            if me_id else
            f"SELECT c.id, c.parent_id, c.text, c.created_at, c.user_id, u.username, u.avatar_url, "
            f"COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0) AS likes, "
            f"COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes, "
            f"0 AS my_vote "
            f"FROM {SCHEMA}.build_comments c "
            f"JOIN {SCHEMA}.users u ON c.user_id = u.id "
            f"LEFT JOIN {SCHEMA}.comment_votes v ON v.comment_id = c.id "
            f"WHERE c.build_token = {esc(token)} "
            f"GROUP BY c.id, c.parent_id, c.text, c.created_at, c.user_id, u.username, u.avatar_url "
            f"ORDER BY c.created_at ASC"
        )
        rows = cur.fetchall()
        return [
            {
                "id": r[0], "parent_id": r[1], "text": r[2],
                "created_at": r[3].isoformat() if r[3] else None,
                "user_id": r[4], "username": r[5], "avatar_url": r[6] or "",
                "likes": int(r[7]), "dislikes": int(r[8]), "my_vote": int(r[9]),
            }
            for r in rows
        ]

    try:
        if method == "GET":
            me = get_user(session_id)
            me_id = me[0] if me else None
            # Статья
            article_id = params.get("article_id")
            if article_id:
                token = f"article-{article_id}"
                comments = fetch_comments(token, me_id)
                return {"statusCode": 200, "headers": cors, "body": json.dumps({"comments": comments})}

            # Сборка
            token = params.get("token")
            if not token:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нет token или article_id"})}
            comments = fetch_comments(token, me_id)
            return {"statusCode": 200, "headers": cors, "body": json.dumps({"comments": comments})}

        elif method == "POST" and action == "add":
            u = get_user(session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            parent_id = body.get("parent_id")

            # Определяем token: либо явный (сборка), либо по article_id
            token = body.get("token")
            article_id = body.get("article_id")
            if not token and article_id:
                token = f"article-{article_id}"

            text = (body.get("text") or "").strip()
            if not token or not text:
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Нет token/article_id или text"})}

            # Нормализуем parent_id к КОРНЮ ветки, чтобы "ответ на ответ" работал.
            # Реальному адресату ответа отправим уведомление и подставим @упоминание.
            reply_target_user_id = None
            reply_target_username = None
            root_parent_id = None
            if parent_id:
                cur.execute(
                    f"SELECT c.parent_id, c.user_id, u.username FROM {SCHEMA}.build_comments c "
                    f"JOIN {SCHEMA}.users u ON c.user_id = u.id WHERE c.id = {int(parent_id)}"
                )
                pr = cur.fetchone()
                if pr:
                    root_parent_id = pr[0] if pr[0] else int(parent_id)
                    reply_target_user_id = pr[1]
                    reply_target_username = pr[2]

            parent_sql = str(root_parent_id) if root_parent_id else "NULL"
            cur.execute(
                f"INSERT INTO {SCHEMA}.build_comments (build_token, user_id, parent_id, text) "
                f"VALUES ({esc(token)}, {u[0]}, {parent_sql}, {esc(text)}) RETURNING id, created_at"
            )
            new_id, created_at = cur.fetchone()

            # Уведомления
            notify_user_id = None
            notify_text = None

            if root_parent_id:
                if reply_target_user_id and reply_target_user_id != u[0]:
                    notify_user_id = reply_target_user_id
                    preview = text[:40] + ("..." if len(text) > 40 else "")
                    notify_text = f"{u[1]} ответил на ваш комментарий: «{preview}»"
                link = f"/articles/{article_id}#comment-{new_id}" if article_id else f"/configurator?build={token}#comment-{new_id}"
            else:
                if article_id:
                    link = f"/articles/{article_id}#comment-{new_id}"
                    # Уведомление авторам статьи не реализуем (нет поля user_id в articles)
                else:
                    link = f"/configurator?build={token}#comment-{new_id}"
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
                "id": new_id, "parent_id": root_parent_id, "text": text,
                "created_at": created_at.isoformat(),
                "user_id": u[0], "username": u[1], "avatar_url": u[2] or "",
                "likes": 0, "dislikes": 0, "my_vote": 0,
                "reply_to_username": reply_target_username,
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

        elif method == "POST" and action == "vote":
            u = get_user(session_id)
            if not u:
                return {"statusCode": 401, "headers": cors, "body": json.dumps({"error": "Не авторизован"})}
            body = json.loads(event.get("body") or "{}")
            comment_id = int(body.get("id", 0))
            value = int(body.get("value", 0))
            if comment_id <= 0 or value not in (-1, 0, 1):
                return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "Некорректный голос"})}

            if value == 0:
                cur.execute(
                    f"DELETE FROM {SCHEMA}.comment_votes WHERE comment_id = {comment_id} AND user_id = {u[0]}"
                )
            else:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.comment_votes (comment_id, user_id, value) "
                    f"VALUES ({comment_id}, {u[0]}, {value}) "
                    f"ON CONFLICT (comment_id, user_id) DO UPDATE SET value = {value}, created_at = now()"
                )
            cur.execute(
                f"SELECT COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0), "
                f"COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) "
                f"FROM {SCHEMA}.comment_votes WHERE comment_id = {comment_id}"
            )
            likes, dislikes = cur.fetchone()
            conn.commit()
            return {"statusCode": 200, "headers": cors, "body": json.dumps({
                "id": comment_id, "likes": int(likes), "dislikes": int(dislikes), "my_vote": value,
            })}

        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Not found"})}

    finally:
        cur.close()
        conn.close()