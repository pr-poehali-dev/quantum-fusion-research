import json
import os
import base64
import uuid
import psycopg2
import boto3
from botocore.client import Config
from tg_notify import notify_stress

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


# Кэшируем S3-клиент между файлами/вызовами (создание клиента дорогое — экономим время ingest)
_S3 = None


def _s3():
    global _S3
    if _S3 is None:
        _S3 = boto3.client(
            "s3",
            endpoint_url="https://bucket.poehali.dev",
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4"),
        )
    return _S3


_CONTENT_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
    "gif": "image/gif", "html": "text/html; charset=utf-8", "htm": "text/html; charset=utf-8",
    "txt": "text/plain; charset=utf-8", "log": "text/plain; charset=utf-8",
    "csv": "text/csv; charset=utf-8", "json": "application/json",
}


def upload_report(file_name, b64):
    raw = base64.b64decode(b64)
    ext = (file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "bin")[:12]
    key = f"stress_reports/{uuid.uuid4().hex}.{ext}"
    content_type = _CONTENT_TYPES.get(ext, "application/octet-stream")
    _s3().put_object(Bucket="files", Key=key, Body=raw, ContentType=content_type)
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
        if action in ("ingest", "profiles_pull", "verify_token", "notify"):
            token = headers.get("X-Stress-Token") or headers.get("x-stress-token")
            if not token or token != os.environ.get("STRESS_INGEST_TOKEN"):
                return err("forbidden", 403)
            if action == "verify_token" and method == "GET":
                return ok({"ok": True, "valid": True})
            if action == "ingest" and method == "POST":
                return ingest(cur, conn, body)
            if action == "profiles_pull" and method == "GET":
                return profiles_pull(cur)
            if action == "notify" and method == "POST":
                return notify(body)
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

        # Папки прогонов
        if action == "folders_list" and method == "GET":
            return folders_list(cur)
        if action == "folder_save" and method in ("POST", "PUT"):
            return folder_save(cur, conn, body)
        if action == "folder_delete" and method == "DELETE":
            return folder_delete(cur, conn, int(params.get("id") or 0))
        if action == "runs_assign_folder" and method in ("POST", "PUT"):
            return runs_assign_folder(cur, conn, body)
        if action == "folder_report" and method == "GET":
            return folder_report(cur, int(params.get("id") or 0))

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

        # Пресеты тестов (конструктор готовых тестов)
        if action == "presets_list" and method == "GET":
            return presets_list(cur)
        if action == "preset_save" and method in ("POST", "PUT"):
            return preset_save(cur, conn, body)
        if action == "preset_delete" and method == "DELETE":
            return preset_delete(cur, conn, int(params.get("id") or 0))

        return err(f"unknown action: {action}")
    except Exception as e:
        conn.rollback()
        return err(str(e), 500)
    finally:
        cur.close()
        conn.close()


def notify(body):
    """Уведомление в Telegram о событии стресс-теста.
    body: {event: 'test_failed'|'run_finished', machine, profile, ...}"""
    event = body.get("event", "")
    machine = body.get("machine") or "—"
    profile = body.get("profile") or "—"
    site = os.environ.get("SITE_BASE_URL", "").rstrip("/")
    link = f"\n🔗 {site}/admin/stress" if site else ""

    if event == "test_failed":
        test_name = body.get("test_name") or "—"
        exit_code = body.get("exit_code")
        code_s = "—" if exit_code is None else str(exit_code)
        dur = body.get("duration_sec")
        dur_s = f"{float(dur):.0f} сек" if dur is not None else "—"
        text = (
            f"🔴 <b>Ошибка стресс-теста</b>\n"
            f"💻 ПК: <b>{machine}</b>\n"
            f"📋 Профиль: {profile}\n"
            f"❌ Тест: <b>{test_name}</b>\n"
            f"   код выхода: {code_s}, длительность: {dur_s}{link}"
        )
    elif event == "run_finished":
        passed = body.get("passed", 0)
        total = body.get("total", 0)
        failed = total - passed
        status_emoji = "✅" if failed == 0 else "⚠️"
        text = (
            f"{status_emoji} <b>Прогон завершён</b>\n"
            f"💻 ПК: <b>{machine}</b>\n"
            f"📋 Профиль: {profile}\n"
            f"📊 Итог: <b>{passed}/{total}</b> успешно"
            + (f", ошибок: {failed}" if failed else "") + link
        )
    else:
        return err("unknown event")

    notify_stress(text)
    return ok({"ok": True})


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
        f"started_at, finished_at, total_tests, passed_tests, failed_tests, status, created_at, folder_id "
        f"FROM {SCHEMA}.stress_runs ORDER BY created_at DESC LIMIT 500"
    )
    runs = [{
        "id": r[0], "run_uid": r[1], "profile_name": r[2], "machine_name": r[3],
        "os_info": r[4], "note": r[5], "started_at": r[6], "finished_at": r[7],
        "total_tests": r[8], "passed_tests": r[9], "failed_tests": r[10],
        "status": r[11], "created_at": r[12], "folder_id": r[13],
    } for r in cur.fetchall()]
    return ok({"runs": runs})


# ─── Папки прогонов (группировка + номинальная привязка к заказу) ───────────

def folders_list(cur):
    # Папки + количество прогонов в каждой
    cur.execute(
        f"SELECT f.id, f.name, f.order_id, f.order_ref, f.note, f.created_at, "
        f"COUNT(r.id) AS runs_count "
        f"FROM {SCHEMA}.stress_folders f "
        f"LEFT JOIN {SCHEMA}.stress_runs r ON r.folder_id = f.id "
        f"GROUP BY f.id ORDER BY f.created_at DESC"
    )
    folders = [{
        "id": r[0], "name": r[1], "order_id": r[2], "order_ref": r[3],
        "note": r[4], "created_at": r[5], "runs_count": r[6],
    } for r in cur.fetchall()]
    return ok({"folders": folders})


def folder_save(cur, conn, body):
    fid = body.get("id")
    name = (body.get("name") or "Новая папка").strip() or "Новая папка"
    order_id = body.get("order_id")
    order_id_sql = str(int(order_id)) if order_id not in (None, "", 0, "0") else "NULL"
    order_ref = body.get("order_ref") or ""
    note = body.get("note") or ""
    if fid:
        cur.execute(
            f"UPDATE {SCHEMA}.stress_folders SET name = {esc(name)}, order_id = {order_id_sql}, "
            f"order_ref = {esc(order_ref)}, note = {esc(note)}, updated_at = NOW() "
            f"WHERE id = {int(fid)} RETURNING id"
        )
    else:
        cur.execute(
            f"INSERT INTO {SCHEMA}.stress_folders (name, order_id, order_ref, note) VALUES "
            f"({esc(name)}, {order_id_sql}, {esc(order_ref)}, {esc(note)}) RETURNING id"
        )
    new_id = cur.fetchone()[0]
    conn.commit()
    return ok({"ok": True, "id": new_id})


def folder_delete(cur, conn, fid):
    if not fid:
        return err("id required")
    # Прогоны из папки не удаляем — просто отвязываем (folder_id = NULL)
    cur.execute(f"UPDATE {SCHEMA}.stress_runs SET folder_id = NULL WHERE folder_id = {int(fid)}")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_folders WHERE id = {int(fid)}")
    conn.commit()
    return ok({"ok": True})


def runs_assign_folder(cur, conn, body):
    # body: {run_ids: [..], folder_id: int|null}
    run_ids = body.get("run_ids") or []
    run_ids = [int(x) for x in run_ids if str(x).isdigit()]
    if not run_ids:
        return err("run_ids required")
    folder_id = body.get("folder_id")
    fid_sql = str(int(folder_id)) if folder_id not in (None, "", 0, "0") else "NULL"
    ids_sql = ",".join(str(x) for x in run_ids)
    cur.execute(
        f"UPDATE {SCHEMA}.stress_runs SET folder_id = {fid_sql} WHERE id IN ({ids_sql})"
    )
    conn.commit()
    return ok({"ok": True, "updated": len(run_ids)})


def folder_report(cur, fid):
    """Полные данные папки для отчёта: папка + все её прогоны с метриками."""
    if not fid:
        return err("id required")
    cur.execute(
        f"SELECT id, name, order_id, order_ref, note, created_at "
        f"FROM {SCHEMA}.stress_folders WHERE id = {int(fid)}"
    )
    f = cur.fetchone()
    if not f:
        return err("not found", 404)
    folder = {
        "id": f[0], "name": f[1], "order_id": f[2], "order_ref": f[3],
        "note": f[4], "created_at": f[5],
    }
    cur.execute(
        f"SELECT id, run_uid, profile_name, machine_name, os_info, note, "
        f"started_at, finished_at, total_tests, passed_tests, failed_tests, status, created_at "
        f"FROM {SCHEMA}.stress_runs WHERE folder_id = {int(fid)} ORDER BY created_at DESC"
    )
    runs = []
    for r in cur.fetchall():
        runs.append({
            "id": r[0], "run_uid": r[1], "profile_name": r[2], "machine_name": r[3],
            "os_info": r[4], "note": r[5], "started_at": r[6], "finished_at": r[7],
            "total_tests": r[8], "passed_tests": r[9], "failed_tests": r[10],
            "status": r[11], "created_at": r[12], "metrics": [], "results": [],
        })
    if runs:
        ids = ",".join(str(x["id"]) for x in runs)
        # Метрики (датчики) по всем прогонам папки
        cur.execute(
            f"SELECT run_id, key, label, unit, min_val, max_val, avg_val, samples "
            f"FROM {SCHEMA}.stress_metrics WHERE run_id IN ({ids}) ORDER BY id"
        )
        by_run = {}
        for m in cur.fetchall():
            by_run.setdefault(m[0], []).append({
                "key": m[1], "label": m[2], "unit": m[3],
                "min": float(m[4]) if m[4] is not None else None,
                "max": float(m[5]) if m[5] is not None else None,
                "avg": float(m[6]) if m[6] is not None else None,
                "samples": m[7],
            })
        for x in runs:
            x["metrics"] = by_run.get(x["id"], [])

        # Результаты тестов (бенчмарки) + файлы — для компактного отчёта
        cur.execute(
            f"SELECT id, run_id, test_name, command, exit_code, duration_sec, "
            f"timed_out, success FROM {SCHEMA}.stress_results "
            f"WHERE run_id IN ({ids}) ORDER BY sort_order, id"
        )
        res_by_run = {}
        res_index = {}
        for x in cur.fetchall():
            item = {
                "id": x[0], "test_name": x[2], "command": x[3], "exit_code": x[4],
                "duration_sec": float(x[5]) if x[5] is not None else 0,
                "timed_out": x[6], "success": x[7], "files": [],
            }
            res_by_run.setdefault(x[1], []).append(item)
            res_index[x[0]] = item
        if res_index:
            res_ids = ",".join(str(i) for i in res_index)
            cur.execute(
                f"SELECT result_id, file_name, file_url, file_size FROM {SCHEMA}.stress_files "
                f"WHERE result_id IN ({res_ids}) ORDER BY id"
            )
            for fr in cur.fetchall():
                if fr[0] in res_index:
                    res_index[fr[0]]["files"].append({"file_name": fr[1], "file_url": fr[2], "file_size": fr[3]})
        for x in runs:
            x["results"] = res_by_run.get(x["id"], [])
    return ok({"folder": folder, "runs": runs})


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


# ─── Пресеты тестов (конструктор готовых тестов) ───────────────────────────

def _row_to_preset(r):
    report = r[12]
    if isinstance(report, str):
        try:
            report = json.loads(report)
        except Exception:
            report = []
    return {
        "id": r[0], "label": r[1], "hint": r[2], "test_name": r[3],
        "program": r[4], "args": r[5], "duration_sec": r[6],
        "timeout_is_success": r[7], "success_exit_code": r[8], "min_run_sec": r[9],
        "send_keys": r[10], "send_keys_delay_sec": r[11],
        "report_files": report or [], "sort_order": r[13],
    }


def presets_list(cur):
    cur.execute(
        f"SELECT id, label, hint, test_name, program, args, duration_sec, "
        f"timeout_is_success, success_exit_code, min_run_sec, send_keys, "
        f"send_keys_delay_sec, report_files, sort_order "
        f"FROM {SCHEMA}.stress_test_presets ORDER BY sort_order, id"
    )
    return ok({"presets": [_row_to_preset(r) for r in cur.fetchall()]})


def preset_save(cur, conn, body):
    pid = body.get("id")
    report_json = json.dumps(body.get("report_files") or [], ensure_ascii=False)
    fields = (
        f"label = {esc(body.get('label', ''))}, hint = {esc(body.get('hint', ''))}, "
        f"test_name = {esc(body.get('test_name', ''))}, program = {esc(body.get('program', ''))}, "
        f"args = {esc(body.get('args', ''))}, duration_sec = {int(num(body.get('duration_sec') or 600))}, "
        f"timeout_is_success = {'TRUE' if body.get('timeout_is_success', True) else 'FALSE'}, "
        f"success_exit_code = {int(num(body.get('success_exit_code') if body.get('success_exit_code') is not None else -1))}, "
        f"min_run_sec = {int(num(body.get('min_run_sec') or 0))}, "
        f"send_keys = {esc(body.get('send_keys', ''))}, "
        f"send_keys_delay_sec = {int(num(body.get('send_keys_delay_sec') or 5))}, "
        f"report_files = {esc(report_json)}::jsonb, "
        f"sort_order = {int(num(body.get('sort_order') or 0))}"
    )
    if pid:
        cur.execute(f"UPDATE {SCHEMA}.stress_test_presets SET {fields} WHERE id = {int(pid)} RETURNING id")
    else:
        cur.execute(
            f"INSERT INTO {SCHEMA}.stress_test_presets "
            f"(label, hint, test_name, program, args, duration_sec, timeout_is_success, "
            f"success_exit_code, min_run_sec, send_keys, send_keys_delay_sec, report_files, sort_order) VALUES "
            f"({esc(body.get('label', ''))}, {esc(body.get('hint', ''))}, {esc(body.get('test_name', ''))}, "
            f"{esc(body.get('program', ''))}, {esc(body.get('args', ''))}, {int(num(body.get('duration_sec') or 600))}, "
            f"{'TRUE' if body.get('timeout_is_success', True) else 'FALSE'}, "
            f"{int(num(body.get('success_exit_code') if body.get('success_exit_code') is not None else -1))}, "
            f"{int(num(body.get('min_run_sec') or 0))}, {esc(body.get('send_keys', ''))}, "
            f"{int(num(body.get('send_keys_delay_sec') or 5))}, {esc(report_json)}::jsonb, "
            f"{int(num(body.get('sort_order') or 0))}) RETURNING id"
        )
    new_id = cur.fetchone()[0]
    conn.commit()
    return ok({"ok": True, "id": new_id})


def preset_delete(cur, conn, pid):
    if not pid:
        return err("id required")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_test_presets WHERE id = {pid}")
    conn.commit()
    return ok({"ok": True})