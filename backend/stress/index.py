import json
import os
import base64
import uuid
import psycopg2
import boto3
from botocore.client import Config

SCHEMA = "t_p72635010_quantum_fusion_resea"

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token, X-Session-Id, X-Admin-Token, X-Stress-Token",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def esc(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def num(v, default=0):
    try:
        if v is None or v == "":
            return default
        return float(v)
    except Exception:
        return default


def ts(v):
    if not v:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def ok(data, code=200):
    return {"statusCode": code, "headers": cors, "body": json.dumps(data, default=str)}


def err(msg, code=400):
    return {"statusCode": code, "headers": cors, "body": json.dumps({"error": msg})}


def is_admin(cur, headers, params, body):
    admin_key = (headers.get("X-Admin-Token") or headers.get("x-admin-token")
                 or body.get("admin_key") or params.get("admin_key"))
    if admin_key and admin_key == os.environ.get("ADMIN_KEY"):
        return True
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")
    if session_id:
        cur.execute(
            f"SELECT u.role FROM {SCHEMA}.user_sessions s "
            f"JOIN {SCHEMA}.users u ON s.user_id = u.id "
            f"WHERE s.id = {esc(session_id)} AND s.expires_at > NOW()"
        )
        row = cur.fetchone()
        if row and row[0] == "admin":
            return True
    return False


def upload_report(file_name, b64):
    raw = base64.b64decode(b64)
    ext = (file_name.rsplit(".", 1)[-1] if "." in file_name else "bin")[:12]
    key = f"stress_reports/{uuid.uuid4().hex}.{ext}"
    s3 = boto3.client(
        "s3",
        endpoint_url="https://bucket.poehali.dev",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
    )
    s3.put_object(Bucket="files", Key=key, Body=raw, ContentType="application/octet-stream")
    url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{key}"
    return url, len(raw)


def handler(event, context):
    """Стресс-тесты: приём прогонов от desktop-приложения (EXE) и выдача данных в админку."""
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    headers = event.get("headers") or {}
    params = event.get("queryStringParameters") or {}
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            body = {}
    action = params.get("action") or body.get("action") or "list"

    conn = get_conn()
    cur = conn.cursor()
    try:
        # ── Контур EXE: приём результатов / выдача профилей по токену ────────
        if action in ("ingest", "profiles_pull", "verify_token"):
            token = headers.get("X-Stress-Token") or headers.get("x-stress-token")
            if not token or token != os.environ.get("STRESS_INGEST_TOKEN"):
                return err("forbidden", 403)
            if action == "verify_token" and method == "GET":
                return ok({"ok": True, "valid": True})
            if action == "ingest" and method == "POST":
                return ingest(cur, conn, body)
            if action == "profiles_pull" and method == "GET":
                return profiles_pull(cur)
            return err("bad request", 400)

        # ── Контур АДМИНА ───────────────────────────────────────────────────
        if not is_admin(cur, headers, params, body):
            return err("forbidden", 403)

        if action == "list" and method == "GET":
            return list_runs(cur)
        if action == "get" and method == "GET":
            return get_run(cur, int(params.get("id") or 0))
        if action == "delete_run" and method == "DELETE":
            return delete_run(cur, conn, int(params.get("id") or 0))

        # Профили (редактор в админке)
        if action == "profiles_list" and method == "GET":
            return profiles_list(cur)
        if action == "profile_save" and method in ("POST", "PUT"):
            return profile_save(cur, conn, body)
        if action == "profile_delete" and method == "DELETE":
            return profile_delete(cur, conn, int(params.get("id") or 0))

        # Настройки отображения метрик
        if action == "metric_prefs_list" and method == "GET":
            return metric_prefs_list(cur)
        if action == "metric_prefs_save" and method in ("POST", "PUT"):
            return metric_prefs_save(cur, conn, body)

        return err(f"unknown action: {action}")
    except Exception as e:
        conn.rollback()
        return err(str(e), 500)
    finally:
        cur.close()
        conn.close()


def ingest(cur, conn, body):
    run_uid = (body.get("run_uid") or uuid.uuid4().hex).strip()
    # идемпотентность: один и тот же run_uid не плодит дубли
    cur.execute(f"SELECT id FROM {SCHEMA}.stress_runs WHERE run_uid = {esc(run_uid)}")
    existing = cur.fetchone()
    if existing:
        return ok({"ok": True, "run_id": existing[0], "duplicate": True})

    results = body.get("results") or []
    passed = sum(1 for r in results if r.get("success"))
    failed = len(results) - passed
    status = body.get("status") or ("completed" if failed == 0 else "partial")

    cur.execute(
        f"INSERT INTO {SCHEMA}.stress_runs "
        f"(run_uid, profile_name, machine_name, os_info, note, started_at, finished_at, "
        f"total_tests, passed_tests, failed_tests, status) VALUES "
        f"({esc(run_uid)}, {esc(body.get('profile_name', ''))}, {esc(body.get('machine_name', ''))}, "
        f"{esc(body.get('os_info', ''))}, {esc(body.get('note', ''))}, "
        f"{ts(body.get('started_at'))}, {ts(body.get('finished_at'))}, "
        f"{len(results)}, {passed}, {failed}, {esc(status)}) RETURNING id"
    )
    run_id = cur.fetchone()[0]

    for i, r in enumerate(results):
        exit_code = r.get("exit_code")
        exit_sql = "NULL" if exit_code is None else str(int(exit_code))
        cur.execute(
            f"INSERT INTO {SCHEMA}.stress_results "
            f"(run_id, test_name, command, exit_code, duration_sec, planned_sec, timed_out, success, "
            f"started_at, finished_at, sort_order) VALUES "
            f"({run_id}, {esc(r.get('test_name', ''))}, {esc(r.get('command', ''))}, {exit_sql}, "
            f"{num(r.get('duration_sec'))}, {int(num(r.get('planned_sec')))}, "
            f"{'TRUE' if r.get('timed_out') else 'FALSE'}, {'TRUE' if r.get('success') else 'FALSE'}, "
            f"{ts(r.get('started_at'))}, {ts(r.get('finished_at'))}, {i}) RETURNING id"
        )
        result_id = cur.fetchone()[0]
        for f in (r.get("files") or []):
            name = f.get("name", "report")
            content = f.get("content_base64")
            if not content:
                continue
            try:
                url, size = upload_report(name, content)
            except Exception:
                continue
            cur.execute(
                f"INSERT INTO {SCHEMA}.stress_files (result_id, file_name, file_url, file_size) VALUES "
                f"({result_id}, {esc(name)}, {esc(url)}, {size})"
            )

    # Метрики HWiNFO за прогон (min/max/avg по температурам, нагрузке, оборотам и т.д.)
    for m in (body.get("metrics") or []):
        cur.execute(
            f"INSERT INTO {SCHEMA}.stress_metrics (run_id, key, label, unit, min_val, max_val, avg_val, samples) VALUES "
            f"({run_id}, {esc(m.get('key', ''))}, {esc(m.get('label', ''))}, {esc(m.get('unit', ''))}, "
            f"{num(m.get('min'))}, {num(m.get('max'))}, {num(m.get('avg'))}, {int(num(m.get('samples')))})"
        )

    conn.commit()
    return ok({"ok": True, "run_id": run_id, "results": len(results), "metrics": len(body.get("metrics") or [])})


def list_runs(cur):
    cur.execute(
        f"SELECT id, run_uid, profile_name, machine_name, os_info, note, "
        f"started_at, finished_at, total_tests, passed_tests, failed_tests, status, created_at "
        f"FROM {SCHEMA}.stress_runs ORDER BY created_at DESC LIMIT 500"
    )
    runs = [{
        "id": r[0], "run_uid": r[1], "profile_name": r[2], "machine_name": r[3],
        "os_info": r[4], "note": r[5], "started_at": r[6], "finished_at": r[7],
        "total_tests": r[8], "passed_tests": r[9], "failed_tests": r[10],
        "status": r[11], "created_at": r[12],
    } for r in cur.fetchall()]
    return ok({"runs": runs})


def get_run(cur, run_id):
    if not run_id:
        return err("id required")
    cur.execute(
        f"SELECT id, run_uid, profile_name, machine_name, os_info, note, "
        f"started_at, finished_at, total_tests, passed_tests, failed_tests, status, created_at "
        f"FROM {SCHEMA}.stress_runs WHERE id = {run_id}"
    )
    r = cur.fetchone()
    if not r:
        return err("not found", 404)
    run = {
        "id": r[0], "run_uid": r[1], "profile_name": r[2], "machine_name": r[3],
        "os_info": r[4], "note": r[5], "started_at": r[6], "finished_at": r[7],
        "total_tests": r[8], "passed_tests": r[9], "failed_tests": r[10],
        "status": r[11], "created_at": r[12],
    }
    cur.execute(
        f"SELECT id, test_name, command, exit_code, duration_sec, planned_sec, timed_out, success, "
        f"started_at, finished_at, sort_order FROM {SCHEMA}.stress_results "
        f"WHERE run_id = {run_id} ORDER BY sort_order, id"
    )
    results = []
    for x in cur.fetchall():
        results.append({
            "id": x[0], "test_name": x[1], "command": x[2], "exit_code": x[3],
            "duration_sec": float(x[4]) if x[4] is not None else 0,
            "planned_sec": x[5], "timed_out": x[6], "success": x[7],
            "started_at": x[8], "finished_at": x[9], "sort_order": x[10], "files": [],
        })
    if results:
        ids = ",".join(str(r2["id"]) for r2 in results)
        cur.execute(
            f"SELECT result_id, file_name, file_url, file_size FROM {SCHEMA}.stress_files "
            f"WHERE result_id IN ({ids}) ORDER BY id"
        )
        by_res = {}
        for fr in cur.fetchall():
            by_res.setdefault(fr[0], []).append({"file_name": fr[1], "file_url": fr[2], "file_size": fr[3]})
        for r2 in results:
            r2["files"] = by_res.get(r2["id"], [])
    run["results"] = results

    # Метрики HWiNFO
    cur.execute(
        f"SELECT key, label, unit, min_val, max_val, avg_val, samples "
        f"FROM {SCHEMA}.stress_metrics WHERE run_id = {run_id} ORDER BY id"
    )
    run["metrics"] = [{
        "key": m[0], "label": m[1], "unit": m[2],
        "min": float(m[3]) if m[3] is not None else None,
        "max": float(m[4]) if m[4] is not None else None,
        "avg": float(m[5]) if m[5] is not None else None,
        "samples": m[6],
    } for m in cur.fetchall()]
    return ok({"run": run})


def delete_run(cur, conn, run_id):
    if not run_id:
        return err("id required")
    cur.execute(
        f"DELETE FROM {SCHEMA}.stress_files WHERE result_id IN "
        f"(SELECT id FROM {SCHEMA}.stress_results WHERE run_id = {run_id})"
    )
    cur.execute(f"DELETE FROM {SCHEMA}.stress_results WHERE run_id = {run_id}")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_metrics WHERE run_id = {run_id}")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_runs WHERE id = {run_id}")
    conn.commit()
    return ok({"ok": True})


# ─── Профили тестов (редактор в админке + выдача приложению) ────────────────

def _row_to_profile(r):
    tests = r[3]
    if isinstance(tests, str):
        try:
            tests = json.loads(tests)
        except Exception:
            tests = []
    return {
        "id": r[0], "name": r[1], "note": r[2], "tests": tests or [],
        "is_active": r[4], "sort_order": r[5],
    }


def profiles_list(cur):
    cur.execute(
        f"SELECT id, name, note, tests, is_active, sort_order "
        f"FROM {SCHEMA}.stress_profiles ORDER BY sort_order, id"
    )
    return ok({"profiles": [_row_to_profile(r) for r in cur.fetchall()]})


def profiles_pull(cur):
    # То же, но только активные — для desktop-приложения.
    cur.execute(
        f"SELECT id, name, note, tests, is_active, sort_order "
        f"FROM {SCHEMA}.stress_profiles WHERE is_active = TRUE ORDER BY sort_order, id"
    )
    profiles = []
    for r in cur.fetchall():
        p = _row_to_profile(r)
        profiles.append({"name": p["name"], "note": p["note"], "tests": p["tests"]})
    return ok({"profiles": profiles})


def profile_save(cur, conn, body):
    pid = body.get("id")
    name = body.get("name", "")
    note = body.get("note", "")
    tests = body.get("tests") or []
    is_active = body.get("is_active", True)
    sort_order = int(body.get("sort_order") or 0)
    tests_json = json.dumps(tests, ensure_ascii=False)

    if pid:
        cur.execute(
            f"UPDATE {SCHEMA}.stress_profiles SET name = {esc(name)}, note = {esc(note)}, "
            f"tests = {esc(tests_json)}::jsonb, is_active = {'TRUE' if is_active else 'FALSE'}, "
            f"sort_order = {sort_order}, updated_at = NOW() WHERE id = {int(pid)} RETURNING id"
        )
    else:
        cur.execute(
            f"INSERT INTO {SCHEMA}.stress_profiles (name, note, tests, is_active, sort_order) VALUES "
            f"({esc(name)}, {esc(note)}, {esc(tests_json)}::jsonb, "
            f"{'TRUE' if is_active else 'FALSE'}, {sort_order}) RETURNING id"
        )
    new_id = cur.fetchone()[0]
    conn.commit()
    return ok({"ok": True, "id": new_id})


def profile_delete(cur, conn, pid):
    if not pid:
        return err("id required")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_profiles WHERE id = {pid}")
    conn.commit()
    return ok({"ok": True})


# ─── Настройки отображения метрик (видимость/порядок/имя/категория) ─────────

def metric_prefs_list(cur):
    cur.execute(
        f"SELECT metric_key, label_orig, label_custom, category, visible, sort_order "
        f"FROM {SCHEMA}.stress_metric_prefs ORDER BY sort_order, id"
    )
    prefs = [{
        "metric_key": r[0], "label_orig": r[1], "label_custom": r[2],
        "category": r[3], "visible": r[4], "sort_order": r[5],
    } for r in cur.fetchall()]
    return ok({"prefs": prefs})


def metric_prefs_save(cur, conn, body):
    # body: {prefs: [{metric_key, label_orig, label_custom, category, visible, sort_order}]}
    prefs = body.get("prefs") or []
    # Полная перезапись: проще и предсказуемо.
    cur.execute(f"DELETE FROM {SCHEMA}.stress_metric_prefs")
    for i, p in enumerate(prefs):
        cur.execute(
            f"INSERT INTO {SCHEMA}.stress_metric_prefs "
            f"(metric_key, label_orig, label_custom, category, visible, sort_order) VALUES "
            f"({esc(p.get('metric_key', ''))}, {esc(p.get('label_orig', ''))}, "
            f"{esc(p.get('label_custom', ''))}, {esc(p.get('category', ''))}, "
            f"{'TRUE' if p.get('visible', True) else 'FALSE'}, {int(p.get('sort_order') or i)})"
        )
    conn.commit()
    return ok({"ok": True, "count": len(prefs)})