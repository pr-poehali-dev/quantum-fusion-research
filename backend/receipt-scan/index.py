import json
import os
import psycopg2
from datetime import datetime

from matcher import normalize, match_one

SCHEMA = "t_p72635010_quantum_fusion_resea"

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, X-Worker-Token",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def resp(data, code=200):
    return {"statusCode": code, "headers": cors, "body": json.dumps(data, default=str)}


def err(msg, code=400):
    return {"statusCode": code, "headers": cors, "body": json.dumps({"error": msg})}


def load_groups(cur):
    cur.execute(
        f"SELECT id, name, part_number, category, cell, warranty_months, price_retail "
        f"FROM {SCHEMA}.warehouse_groups WHERE is_archived = FALSE ORDER BY id"
    )
    cols = ["id", "name", "part_number", "category", "cell", "warranty_months", "price_retail"]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def load_memory(cur):
    cur.execute(f"SELECT raw_norm, group_id FROM {SCHEMA}.receipt_match_memory")
    mem = {}
    for raw_norm, gid in cur.fetchall():
        # при дублях берём с большим hits — но для простоты последний выигрывает
        mem[raw_norm] = gid
    return mem


def match_store(cur, store_hint):
    """Подбираем store_id из складских магазинов по названию из чека."""
    if not store_hint:
        return {"store_id": None, "store_name": None, "store_hint": None}
    hint = normalize(str(store_hint))
    cur.execute(f"SELECT id, name, code FROM {SCHEMA}.warehouse_stores ORDER BY id")
    best = None
    best_score = 0.0
    for sid, name, code in cur.fetchall():
        nname = normalize(name or "")
        ncode = normalize(code or "")
        score = 0.0
        # точное вхождение названия/кода в подсказку или наоборот
        if nname and (nname in hint or hint in nname):
            score = 100.0
        elif ncode and ncode and (ncode == hint or ncode in hint):
            score = 95.0
        else:
            # пословное пересечение
            hw = set(hint.split())
            nw = set(nname.split())
            if hw and nw:
                inter = hw & nw
                if inter:
                    score = len(inter) / max(1, min(len(hw), len(nw))) * 90
        if score > best_score:
            best_score = score
            best = (sid, name)
    if best and best_score >= 60:
        return {"store_id": best[0], "store_name": best[1], "store_hint": str(store_hint)}
    return {"store_id": None, "store_name": None, "store_hint": str(store_hint)}


def build_match(cur, raw_result):
    """По сырому JSON модели строим объект {store, rows[]} с подобранными товарами и магазином."""
    groups = load_groups(cur)
    memory = load_memory(cur)
    items = (raw_result or {}).get("items", []) if isinstance(raw_result, dict) else []
    store_hint = (raw_result or {}).get("store")
    store = match_store(cur, store_hint)
    rows = []
    for it in items:
        raw_name = (it.get("name") or "").strip()
        if not raw_name:
            continue
        article = (it.get("article") or "").strip()
        m = match_one(raw_name, article, groups, memory)
        g = next((x for x in groups if x["id"] == m["group_id"]), None) if m["group_id"] else None
        rows.append({
            "raw_name": raw_name,
            "article": article,
            "qty": int(it.get("qty") or 1),
            "price": float(it.get("price") or 0),
            "group_id": m["group_id"],
            "matched_name": g["name"] if g else None,
            "confidence": m["confidence"],
            "level": m["level"],
            "candidates": m["candidates"],
        })
    return {"store": store, "rows": rows}


def handler(event: dict, context) -> dict:
    """Приёмка по счёту: очередь распознавания для воркера + матчинг + черновики листа приёмки."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    params = event.get("queryStringParameters") or {}
    headers = event.get("headers") or {}
    body = json.loads(event.get("body") or "{}") if event.get("body") else {}
    action = params.get("action") or body.get("action") or ""

    worker_token = headers.get("X-Worker-Token") or headers.get("x-worker-token")
    admin_key = headers.get("X-Admin-Key") or headers.get("x-admin-key") or body.get("ak")

    is_worker = bool(worker_token and worker_token == os.environ.get("RECEIPT_WORKER_TOKEN"))
    is_admin = bool(admin_key and admin_key == os.environ.get("ADMIN_KEY"))

    conn = get_conn()
    cur = conn.cursor()
    try:
        # ───────── ВОРКЕР (сервер с GPU) ─────────
        if action == "worker_pull":
            if not is_worker:
                return err("Нет доступа", 403)
            cur.execute(
                f"UPDATE {SCHEMA}.receipt_jobs SET status='PROCESSING', started_at=NOW() "
                f"WHERE id = (SELECT id FROM {SCHEMA}.receipt_jobs WHERE status='NEW' "
                f"ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, image_url"
            )
            row = cur.fetchone()
            conn.commit()
            if not row:
                return resp({"job": None})
            return resp({"job": {"id": row[0], "image_url": row[1]}})

        if action == "worker_result":
            if not is_worker:
                return err("Нет доступа", 403)
            job_id = int(body.get("job_id") or 0)
            raw = body.get("result")
            error_txt = body.get("error")
            if error_txt:
                cur.execute(
                    f"UPDATE {SCHEMA}.receipt_jobs SET status='ERROR', error=%s, finished_at=NOW() WHERE id=%s",
                    (str(error_txt)[:2000], job_id),
                )
                conn.commit()
                return resp({"ok": True})
            matched = build_match(cur, raw)
            cur.execute(
                f"UPDATE {SCHEMA}.receipt_jobs SET status='DONE', raw_result=%s, matched=%s, finished_at=NOW() WHERE id=%s",
                (json.dumps(raw), json.dumps(matched), job_id),
            )
            conn.commit()
            return resp({"ok": True})

        # ───────── ФРОНТ (админка) ─────────
        if not is_admin:
            return err("Нет доступа", 403)

        if action == "create_job":
            # фото счёта уже загружено в S3 (через upload), сюда приходит image_url
            image_url = body.get("image_url")
            if not image_url:
                return err("Нет изображения")
            cur.execute(
                f"INSERT INTO {SCHEMA}.receipt_jobs (image_url, status) VALUES (%s, 'NEW') RETURNING id",
                (image_url,),
            )
            jid = cur.fetchone()[0]
            conn.commit()
            return resp({"job_id": jid, "status": "NEW"})

        if action == "job_status":
            jid = int(params.get("job_id") or body.get("job_id") or 0)
            cur.execute(
                f"SELECT id, status, matched, error FROM {SCHEMA}.receipt_jobs WHERE id=%s", (jid,)
            )
            r = cur.fetchone()
            if not r:
                return err("Задача не найдена", 404)
            return resp({"job_id": r[0], "status": r[1], "matched": r[2] or [], "error": r[3]})

        # черновик листа приёмки
        if action == "draft_save":
            draft_id = body.get("draft_id")
            rows = json.dumps(body.get("rows") or [])
            store_id = body.get("store_id")
            job_id = body.get("job_id")
            if draft_id:
                cur.execute(
                    f"UPDATE {SCHEMA}.receipt_drafts SET rows=%s, store_id=%s, updated_at=NOW() WHERE id=%s",
                    (rows, store_id, int(draft_id)),
                )
                conn.commit()
                return resp({"draft_id": int(draft_id)})
            cur.execute(
                f"INSERT INTO {SCHEMA}.receipt_drafts (job_id, store_id, rows, status) "
                f"VALUES (%s, %s, %s, 'OPEN') RETURNING id",
                (job_id, store_id, rows),
            )
            did = cur.fetchone()[0]
            conn.commit()
            return resp({"draft_id": did})

        if action == "draft_get":
            did = int(params.get("draft_id") or body.get("draft_id") or 0)
            cur.execute(
                f"SELECT id, job_id, store_id, rows, status FROM {SCHEMA}.receipt_drafts WHERE id=%s", (did,)
            )
            r = cur.fetchone()
            if not r:
                return err("Черновик не найден", 404)
            return resp({"draft_id": r[0], "job_id": r[1], "store_id": r[2], "rows": r[3] or [], "status": r[4]})

        if action == "drafts_open":
            cur.execute(
                f"SELECT id, store_id, rows, updated_at FROM {SCHEMA}.receipt_drafts "
                f"WHERE status='OPEN' ORDER BY updated_at DESC LIMIT 20"
            )
            items = [{"draft_id": r[0], "store_id": r[1], "rows_count": len(r[2] or []), "updated_at": r[3]} for r in cur.fetchall()]
            return resp({"drafts": items})

        if action == "draft_close":
            did = int(body.get("draft_id") or 0)
            new_status = body.get("status") or "DONE"
            cur.execute(
                f"UPDATE {SCHEMA}.receipt_drafts SET status=%s, updated_at=NOW() WHERE id=%s",
                (new_status, did),
            )
            conn.commit()
            return resp({"ok": True})

        # запомнить ручное сопоставление (для авто-зелёного в будущем)
        if action == "remember_match":
            raw_name = body.get("raw_name") or ""
            gid = int(body.get("group_id") or 0)
            raw_norm = normalize(raw_name)
            if raw_norm and gid:
                cur.execute(
                    f"INSERT INTO {SCHEMA}.receipt_match_memory (raw_norm, group_id) VALUES (%s, %s) "
                    f"ON CONFLICT (raw_norm, group_id) DO UPDATE SET hits = receipt_match_memory.hits + 1, updated_at=NOW()",
                    (raw_norm, gid),
                )
                conn.commit()
            return resp({"ok": True})

        # повторный матчинг (например после создания нового SKU)
        if action == "rematch":
            jid = int(body.get("job_id") or 0)
            cur.execute(f"SELECT raw_result FROM {SCHEMA}.receipt_jobs WHERE id=%s", (jid,))
            r = cur.fetchone()
            if not r:
                return err("Задача не найдена", 404)
            matched = build_match(cur, r[0])
            cur.execute(f"UPDATE {SCHEMA}.receipt_jobs SET matched=%s WHERE id=%s", (json.dumps(matched), jid))
            conn.commit()
            return resp({"matched": matched})

        return err("Неизвестное действие")
    finally:
        cur.close()
        conn.close()