import json
import os
import base64
import uuid
import html as html_mod
import psycopg2
import boto3
from botocore.client import Config
from tg_notify import send_stress
import notify_prefs as np
import brand_pack as bp


def _esc(v) -> str:
    """Экранирование для parse_mode=HTML (иначе <, >, & ломают сообщение → 400)."""
    return html_mod.escape("—" if v is None or v == "" else str(v), quote=False)

SCHEMA = "t_p72635010_quantum_fusion_resea"

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token, X-Session-Id, X-Admin-Token, X-Stress-Token, X-Partner-Scope",
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


def partner_company_from_session(cur, headers):
    """Компания залогиненного партнёра с доступом в ЛК (lk).
    Возвращает id компании или None. Доступ к ЛК: close/paid либо активный
    триал, и статус != suspended."""
    session_id = headers.get("X-Session-Id") or headers.get("x-session-id")
    if not session_id:
        return None
    cur.execute(
        f"SELECT c.id, c.tier, c.status, "
        f"(c.trial_ends_at IS NOT NULL AND c.trial_ends_at > NOW()) AS trial_active "
        f"FROM {SCHEMA}.user_sessions s "
        f"JOIN {SCHEMA}.users u ON u.id = s.user_id "
        f"JOIN {SCHEMA}.partner_companies c ON c.id = u.partner_company_id "
        f"WHERE s.id = {esc(session_id)} AND s.expires_at > NOW()"
    )
    row = cur.fetchone()
    if not row:
        return None
    cid, tier, status, trial_active = row
    if status == "suspended":
        return None
    if trial_active or tier in ("close", "paid"):
        return cid
    return None


def company_by_ingest_token(cur, token):
    """Компания по её stress_ingest_token (для приёма прогонов от EXE партнёра).
    Возвращает id активной компании или None."""
    if not token:
        return None
    cur.execute(
        f"SELECT id, status FROM {SCHEMA}.partner_companies "
        f"WHERE stress_ingest_token = {esc(token)} AND stress_ingest_token <> ''"
    )
    row = cur.fetchone()
    if not row or row[1] == "suspended":
        return None
    return row[0]


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
        # ── Публичная проверка отчёта по QR-коду (без авторизации) ──────────
        if action == "verify" and method == "GET":
            data = bp.lookup_verify(cur, params.get("code"))
            if not data:
                # Код валиден по форме, но прогон ещё не загружен на сервер
                # (offline-PDF) — либо кода не существует. Наружу не различаем.
                return ok({"ok": True, "found": False})
            return ok({"ok": True, **data})

        # Cron-проверка просроченных отбивок: доступ по CRON_SECRET либо админу.
        if action == "check_stale_heartbeats":
            cron_key = (params.get("cron_key") or "").strip()
            cron_secret = (os.environ.get("CRON_SECRET") or "").strip()
            is_cron = bool(cron_secret) and cron_key == cron_secret
            if not is_cron and not is_admin(cur, headers, params, body):
                return err("forbidden", 403)
            return ok(check_stale_heartbeats(cur, conn))

        if action in ("ingest", "profiles_pull", "verify_token", "notify",
                      "heartbeat",
                      "partner_branding", "partner_branding_assets",
                      "partner_branding_zip"):
            token = headers.get("X-Stress-Token") or headers.get("x-stress-token")
            is_global = bool(token) and token == os.environ.get("STRESS_INGEST_TOKEN")
            # Партнёрский токен компании (если не совпал с общим)
            partner_cid = None if is_global else company_by_ingest_token(cur, token)
            if not is_global and partner_cid is None:
                return err("forbidden", 403)
            if action == "verify_token" and method == "GET":
                # Совместимость: прежние поля ok/valid сохранены. Дополнительно
                # отдаём пресет уведомлений компании, чтобы софт знал, какие
                # события вообще имеет смысл слать.
                out = {"ok": True, "valid": True}
                try:
                    out["notify_prefs"] = np.prefs_for_agent(cur, partner_cid)
                except Exception as e:
                    print(f"[VERIFY_TOKEN] prefs error: {e}")
                return ok(out)
            if action == "ingest" and method == "POST":
                return ingest(cur, conn, body, partner_cid)
            if action == "profiles_pull" and method == "GET":
                return profiles_pull(cur)
            if action == "notify" and method == "POST":
                return notify(body, cur, conn, partner_cid)
            if action == "heartbeat" and method == "POST":
                return heartbeat(cur, conn, body, partner_cid)
            if action in ("partner_branding", "partner_branding_assets",
                          "partner_branding_zip") and method == "GET":
                # Синхронизация брендинга при онлайн-входе StressRunner.
                if not partner_cid:
                    # Общий (не партнёрский) токен — брендинга нет.
                    return err("no branding for this token", 404)
                pack, error = bp.build_pack(cur, partner_cid, signed=True)
                if error == "no_brand":
                    return err("brand pack not configured", 404)
                if error == "revoked":
                    return err("brand pack revoked", 404)
                if error == "no_signing_key":
                    print("[BRANDING] STRESS_BRAND_SIGNING_KEY_PEM не задан")
                    return err("signing key not configured", 503)
                if error == "signature_self_test_failed":
                    return err("signature self-test failed: key mismatch", 503)
                if not pack:
                    return err("brand pack unavailable", 404)

                br = pack.get("branding") or {}
                # assets НЕ подписывается, поэтому логотип/splash здесь отдаём
                # всегда (в самом паке логотип может быть пустым — base64
                # ломает сверку подписи на стороне .NET; splash в подпись не
                # входит вовсе, но докачивается тем же путём).
                logo_b64 = br.get("logo_png_base64") or ""
                if not logo_b64:
                    try:
                        logo_b64 = bp.company_defaults(cur, partner_cid)["logo_png_base64"]
                    except Exception as e:
                        print(f"[BRANDING] assets: логотип не получен: {e}")
                splash_b64 = br.get("splash_png_base64") or ""
                if not splash_b64 and br.get("splash_url"):
                    splash_b64 = bp.splash_base64_from_url(br["splash_url"])
                assets = {
                    "logo_base64": logo_b64,
                    "logo_url": br.get("logo_url") or "",
                    "splash_base64": splash_b64,
                    "splash_url": br.get("splash_url") or "",
                    "qr_url_template": br.get("qr_url_template") or "",
                    "verify_page_url": br.get("verify_page_url") or "",
                }
                if action == "partner_branding_assets":
                    # Докачка тяжёлых картинок отдельно от пака.
                    return ok({"ok": True, "assets": assets})
                if action == "partner_branding_zip":
                    # Тот же ZIP, что и в ЛК, — для импорта одним файлом.
                    comp = bp.get_company(cur, partner_cid)
                    slug = "".join(ch if ch.isalnum() else "-"
                                   for ch in (comp[1] or "partner")).strip("-").lower()
                    data = bp.build_brand_archive(cur, partner_cid, pack)
                    return ok({"ok": True, "filename": f"brand-{slug or 'brand'}.zip",
                               "zip_base64": base64.b64encode(data).decode()})
                # pack + assets: если PNG большой, клиент может взять логотип
                # отдельно (или по logo_url), не разбирая пак.
                return ok({"ok": True, "pack": pack, "assets": assets})
            return err("bad request", 400)

        # ── Контур ПАРТНЁРА (ЛК): данные строго своей компании ──────────────
        # Флаг «партнёрского режима» (заголовок X-Partner-Scope) от страницы
        # /partners: даже админ в ЛК видит ТОЛЬКО свою компанию.
        partner_scope = (headers.get("X-Partner-Scope") or headers.get("x-partner-scope") or "") == "1"
        admin = False if partner_scope else is_admin(cur, headers, params, body)
        partner_cid = None if admin else partner_company_from_session(cur, headers)
        if not admin and partner_cid is None:
            return err("forbidden", 403)

        # Фильтр по компании: партнёр — жёстко своя; админ — опц. ?company_id
        if admin:
            cid_param = params.get("company_id")
            if cid_param and str(cid_param).isdigit():
                company_filter = int(cid_param)
            elif str(params.get("all_companies") or "") == "1":
                company_filter = None          # «Показать все» — явный запрос
            else:
                # По умолчанию админ видит ТОЛЬКО наши прогоны
                company_filter = f"own_{own_company_id(cur) or ''}"
        else:
            company_filter = partner_cid
        # Партнёру доступны только read-операции и папки; профили/метрики/пресеты — админ
        partner_allowed = {
            "list", "get", "folders_list", "folder_save", "folder_delete",
            "runs_assign_folder", "folder_report", "delete_run", "delete_runs",
            # Настройки Telegram-уведомлений своей компании
            "notify_config", "notify_settings_save", "notify_chat_save",
            "notify_chat_delete", "notify_chat_test",
            # White-label брендинг PDF и файл-ключ .stbrand
            "brand_config", "brand_save", "brand_download", "brand_revoke",
            "brand_prefill", "brand_archive",
        }
        if not admin and action not in partner_allowed:
            return err("forbidden", 403)

        if action == "list" and method == "GET":
            return list_runs(cur, company_filter)
        if action == "get" and method == "GET":
            return get_run(cur, int(params.get("id") or 0), partner_cid if not admin else None)
        if action == "delete_runs" and method in ("POST", "DELETE"):
            return delete_runs(cur, conn, body.get("run_ids"),
                               partner_cid if not admin else None)
        if action == "delete_run" and method == "DELETE":
            return delete_run(cur, conn, int(params.get("id") or 0), partner_cid if not admin else None)
        if action == "rename_run" and method in ("POST", "PUT"):
            return rename_run(cur, conn, body, partner_cid if not admin else None)

        # Папки прогонов
        if action == "folders_list" and method == "GET":
            return folders_list(cur, company_filter)
        if action == "folder_save" and method in ("POST", "PUT"):
            return folder_save(cur, conn, body, partner_cid if not admin else None)
        if action == "folder_delete" and method == "DELETE":
            return folder_delete(cur, conn, int(params.get("id") or 0), partner_cid if not admin else None)
        if action == "runs_assign_folder" and method in ("POST", "PUT"):
            return runs_assign_folder(cur, conn, body, partner_cid if not admin else None)
        if action == "folder_reorder" and method in ("POST", "PUT"):
            return folder_reorder(cur, conn, body, partner_cid if not admin else None)
        if action == "folder_report" and method == "GET":
            return folder_report(cur, int(params.get("id") or 0), partner_cid if not admin else None)

        # Telegram-уведомления партнёра (его чаты + события + шаблоны).
        # Компания берётся из сессии; админ может смотреть чужую через company_id.
        # Админ без явной компании настраивает НАШУ компанию (is_own).
        # company_filter у админа может быть строкой-режимом («только наши») —
        # для настроек нужен конкретный id компании.
        notify_cid = company_filter if isinstance(company_filter, int) else None
        if admin and not notify_cid:
            notify_cid = own_company_id(cur)
        if action in ("notify_config", "notify_settings_save", "notify_chat_save",
                      "notify_chat_delete", "notify_chat_test"):
            if not notify_cid:
                return err("company_required", 400)
            return notify_config_route(cur, conn, action, method, params, body, notify_cid)

        # White-label брендинг PDF-отчётов + выдача файла-ключа .stbrand
        if action in ("brand_config", "brand_save", "brand_download",
                      "brand_revoke", "brand_prefill", "brand_archive"):
            if not notify_cid:
                return err("company_required", 400)
            return brand_route(cur, conn, action, method, body, notify_cid)

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


# Смайлы статусов тестов в списке (спека NOTIFY_TELEGRAM_FORMAT.md).
_TEST_STATUS_EMOJI = {
    "ok": "✅",
    "error": "💥",
    "problem": "💥",      # legacy-алиас error
    "crash": "💥",
    "warning": "⚠️",
    "skipped": "⏭",
    "pending": "⏳",
    "running": "▶️",
}


def _site_base():
    """Боевой домен для ссылок в уведомлениях (preview-адрес не нужен)."""
    site = os.environ.get("SITE_BASE_URL", "").rstrip("/")
    if not site or "poehali.dev" in site:
        site = "https://begraphics.ru"
    return site


def _notify_headline(body, fallback):
    """Заголовок сообщения. Его формирует StressRunner и кладёт в headline;
    старые версии программы поля не шлют — тогда берём запасной текст."""
    headline = (body.get("headline") or "").strip()
    return f"<b>{_esc(headline)}</b>" if headline else fallback


def _format_notify_core(body):
    """Общая часть любого уведомления: стенд, заказ, профиль, список тестов,
    примечание. Возвращает готовый кусок HTML-текста."""
    parts = []
    stand = body.get("stand_name") or body.get("machine")
    parts.append(f"🖥 Стенд: <b>{_esc(stand)}</b>")
    order = (body.get("order_number") or "").strip() if body.get("order_number") else ""
    if order:
        parts.append(f"📦 Заказ: {_esc(order)}")
    profile = body.get("profile_name") or body.get("profile")
    parts.append(f"📋 Профиль: {_esc(profile)}")

    tests = body.get("tests") or []
    if tests:
        lines = ["", "Тесты:"]
        for t in tests:
            emoji = _TEST_STATUS_EMOJI.get(str(t.get("status") or "").lower(), "•")
            line = f"{emoji} {_esc(t.get('name'))}"
            detail = (t.get("detail") or "").strip() if t.get("detail") else ""
            if detail:
                line += f" — {_esc(detail)}"
            lines.append(line)
        parts.append("\n".join(lines))

    note = (body.get("note") or "").strip() if body.get("note") else ""
    if note:
        parts.append(f"\n📝 {_esc(note)}")
    return "\n".join(parts)


def _gpu_block(issues):
    """Блок «GPU — обслуживание» со списком человекочитаемых проблем."""
    issues = [i for i in (issues or []) if str(i).strip()]
    if not issues:
        return ""
    lines = ["", "🌡 GPU — обслуживание:"]
    lines += [f"• {_esc(i)}" for i in issues]
    return "\n".join(lines)


def _tests_from_results(results):
    """Список тестов прогона для блока «Тесты:» (когда программа его не прислала)."""
    out = []
    for r in results or []:
        detail = (r.get("score_text") or "").strip()
        if not r.get("success") and r.get("exit_code") is not None:
            detail = f"код {r.get('exit_code')}"
        out.append({"name": r.get("test_name"),
                    "status": "ok" if r.get("success") else "error",
                    "detail": detail[:120]})
    return out


def notify_parts(body):
    """Заголовок и хвост конкретного события.

    Вынесено отдельно, чтобы партнёрские чаты получали такой же отчёт,
    как и админский. Возвращает (headline, tail) либо None для неизвестного
    события. Формат — NOTIFY_TELEGRAM_FORMAT.md.
    """
    event = body.get("event", "")

    passed = int(body.get("passed") or 0)
    total = int(body.get("total") or 0)
    tail = ""

    if event == "test_stand_started":
        headline = _notify_headline(body, "▶️ <b>Старт прогона</b>")
        gpu = (body.get("gpu") or "").strip() if body.get("gpu") else ""
        if gpu:
            tail = f"\n\n🎮 GPU: {_esc(gpu)}"

    elif event == "test_failed":
        test_name = body.get("test_name")
        headline = _notify_headline(body, f"💥 <b>Упал тест: {_esc(test_name)}</b>")
        tail = f"\n\n❌ {_esc(test_name)}"
        detail = (body.get("error_detail") or "").strip() if body.get("error_detail") else ""
        exit_code = body.get("exit_code")
        dur = body.get("duration_sec")
        extra = []
        if exit_code is not None:
            extra.append(f"код {_esc(exit_code)}")
        if dur is not None:
            try:
                extra.append(f"{float(dur):.0f} сек")
            except (TypeError, ValueError):
                pass
        if extra:
            tail += f"\n   {', '.join(extra)}"
        if detail:
            tail += f"\n   {_esc(detail)}"

    elif event == "gpu_maintenance_required":
        headline = _notify_headline(body, "⚠️ <b>Проблема с температурой GPU</b>")
        tail = "\n" + _gpu_block(body.get("issues"))

    elif event == "run_finished":
        failed = total - passed
        fb = "✅ <b>Прогон завершён — всё в порядке</b>" if failed == 0 \
            else "⚠️ <b>Прогон завершён с ошибками</b>"
        headline = _notify_headline(body, fb)
        tail = f"\n\n📊 Итог: <b>{passed}/{total}</b> успешно"
        if failed > 0:
            tail += f", ошибок: {failed}"
        if body.get("gpu_maintenance"):
            tail += "\n" + _gpu_block(body.get("gpu_issues"))

    elif event == "upload_failed":
        headline = _notify_headline(body, "⚠️ <b>Отчёт не загружен на сайт</b>")
        tail = (f"\n\n📊 Прогон: <b>{passed}/{total}</b> успешно"
                f"\nДанные сохранены локально на ПК.")

    elif event == "run_interrupted":
        interrupted = body.get("interrupted_test")
        headline = _notify_headline(
            body, f"💥 <b>Перезагрузка ПК — прерван: {_esc(interrupted)}</b>")
        tail = f"\n\n⚡ Прервано на: <b>{_esc(interrupted)}</b>"
        planned = int(body.get("planned_total") or 0)
        done = int(body.get("completed") or 0)
        if planned:
            tail += f"\n📊 Пройдено: {done}/{planned}"

    elif event == "heartbeat_stale":
        headline = _notify_headline(body, "💥 <b>Нет отбивки — проверьте ПК</b>")
        missed = int(body.get("missed_minutes") or 0)
        idx = body.get("current_test_index") or 0
        planned = body.get("planned_total") or 0
        tail = f"\n\n⏱ Просрочка: ~{missed} мин (ожидали отбивку)"
        if body.get("current_test_name"):
            tail += (f"\n▶️ Последний тест: <b>{_esc(body.get('current_test_name'))}</b>"
                     f" ({idx}/{planned})")
        company = body.get("company_name")
        if company:
            tail += f"\n🏢 Компания: {_esc(company)}"

    elif event == "run_started":
        # Legacy-событие старых версий программы.
        headline = _notify_headline(body, "▶️ <b>Прогон запущен</b>")

    else:
        return None

    return headline, tail


def _build_notify_text(body):
    """Полный текст сообщения: заголовок, общий блок, хвост события, ссылка.
    Возвращает str или None (неизвестное событие)."""
    parts = notify_parts(body)
    if parts is None:
        return None
    headline, tail = parts
    core = _format_notify_core(body)
    link = f"\n\n🔗 {_site_base()}/admin/stress"
    return f"{headline}\n\n{core}{tail}{link}"


def notify(body, cur=None, conn=None, company_id=None):
    """Уведомление в Telegram о событии стресс-теста.
    body: {event: 'run_started'|'test_failed'|'run_finished', machine, profile, ...}

    Шлёт в общий админский чат (как раньше) и, если прогон принадлежит
    партнёру, — в его чаты по его настройкам/шаблонам.
    """
    partner_res = None
    if cur is not None and company_id:
        try:
            parts = notify_parts(body) or ("", "")
            partner_res = np.notify_company(cur, company_id, body.get("event", ""), {
                "machine": body.get("stand_name") or body.get("machine"),
                "profile": body.get("profile_name") or body.get("profile"),
                "order_number": body.get("order_number"),
                "note": body.get("note"),
                "tests": body.get("tests"),
                "headline": body.get("headline"),
                "tail": parts[1],
                "test_name": body.get("test_name"), "exit_code": body.get("exit_code"),
                "duration_sec": body.get("duration_sec"),
                "passed": body.get("passed"), "total": body.get("total"),
                "failed": body.get("failed"),
            })
            if conn is not None:
                conn.commit()
        except Exception as e:
            if conn is not None:
                conn.rollback()
            print(f"[PARTNER_NOTIFY] notify exception: {e}")

    text = _build_notify_text(body)
    if text is not None and cur is not None and not np.claim_admin_send(
            cur, body.get("event", ""), {
                "machine": body.get("machine"), "profile": body.get("profile"),
                "test_name": body.get("test_name"), "exit_code": body.get("exit_code"),
                "passed": body.get("passed"), "total": body.get("total"),
            }):
        # Такое же сообщение уже ушло (десктоп послал и ingest, и notify).
        if conn is not None:
            conn.commit()
        return ok({"ok": True, "skipped": "duplicate",
                   **({"partner": partner_res} if partner_res is not None else {})})
    if cur is not None and conn is not None:
        conn.commit()
    if text is None:
        # Событие вне общего шаблона (например run_started) — не ошибка,
        # если оно ушло партнёру.
        if partner_res and (partner_res.get("sent") or partner_res.get("failed")):
            return ok({"ok": True, "partner": partner_res})
        return err("unknown event")
    res = send_stress(text)
    out = {"ok": bool(res.get("ok"))}
    if not res.get("ok"):
        out["error"] = res.get("error")
    if partner_res is not None:
        out["partner"] = partner_res
    return ok(out)


def brand_route(cur, conn, action, method, body, company_id):
    """Брендинг PDF: настройки, сохранение, файл-ключ .stbrand, отзыв."""
    if action == "brand_config" and method == "GET":
        st = bp.brand_status(cur, company_id)
        st["signing_ready"] = bool(os.environ.get("STRESS_BRAND_SIGNING_KEY_PEM", "").strip())
        # Отпечаток публичного ключа — сверяется с тем, что вшит в StressRunner
        # (программа пишет свой отпечаток в журнал при ошибке импорта).
        st["key_fingerprint"] = bp.public_key_fingerprint()
        return ok({"ok": True, "brand": st})

    if action == "brand_prefill" and method == "GET":
        # Подтянуть логотип и контакты из профиля партнёра (для кнопки
        # «Взять из профиля», когда брендинг уже сохранён).
        return ok({"ok": True, **bp.company_defaults(cur, company_id)})

    if action == "brand_save" and method in ("POST", "PUT"):
        done, error = bp.save_brand(cur, company_id, body)
        if error == "logo_too_big":
            return err("Логотип слишком большой — уменьшите картинку", 400)
        if error == "splash_too_big":
            return err("Картинка загрузочного экрана слишком большая — уменьшите файл", 400)
        if not done:
            return err("save_failed", 400)
        conn.commit()
        return ok({"ok": True, "brand": bp.brand_status(cur, company_id)})

    if action in ("brand_download", "brand_archive") and method in ("GET", "POST"):
        pack, error = bp.build_pack(cur, company_id, signed=True)
        if error == "no_brand":
            return err("Сначала сохраните настройки брендинга", 400)
        if error == "revoked":
            return err("Брендинг отозван", 400)
        if error == "no_signing_key":
            return err("Подпись не настроена на сервере — обратитесь к администратору", 503)
        if error == "signature_self_test_failed":
            return err("Ключ подписи на сервере не совпадает с ключом в программе — "
                       "обратитесь к администратору", 503)
        if not pack:
            return err("brand pack unavailable", 400)
        comp = bp.get_company(cur, company_id)
        slug = "".join(ch if ch.isalnum() else "-" for ch in (comp[1] or "partner")).strip("-").lower()
        slug = slug or "brand"

        if action == "brand_archive":
            # ZIP: подписанный pack + логотип + пример QR + инструкция
            data = bp.build_brand_archive(cur, company_id, pack)
            return ok({"ok": True, "filename": f"brand-{slug}.zip",
                       "zip_base64": base64.b64encode(data).decode()})

        # Плоский ответ: pack + отдельно ассеты (удобно при большом PNG).
        # assets не подписывается — логотип/splash отдаём даже если в паке пусто.
        br = pack.get("branding") or {}
        logo_b64 = br.get("logo_png_base64") or ""
        if not logo_b64:
            try:
                logo_b64 = bp.company_defaults(cur, company_id)["logo_png_base64"]
            except Exception as e:
                print(f"[BRANDING] assets: логотип не получен: {e}")
        splash_b64 = br.get("splash_png_base64") or ""
        if not splash_b64 and br.get("splash_url"):
            splash_b64 = bp.splash_base64_from_url(br["splash_url"])
        return ok({
            "ok": True,
            "pack": pack,
            "filename": f"partner-{slug}.stbrand",
            "assets": {
                "logo_base64": logo_b64,
                "logo_url": br.get("logo_url") or "",
                "splash_base64": splash_b64,
                "splash_url": br.get("splash_url") or "",
                "qr_url_template": br.get("qr_url_template") or "",
                "verify_page_url": br.get("verify_page_url") or "",
            },
        })

    if action == "brand_revoke" and method in ("POST", "PUT", "DELETE"):
        cur.execute(
            f"UPDATE {SCHEMA}.partner_brands SET revoked_at=NOW(), updated_at=NOW() "
            f"WHERE company_id=%s", (int(company_id),))
        cur.execute(
            f"UPDATE {SCHEMA}.partner_companies SET white_label_enabled=FALSE, "
            f"updated_at=NOW() WHERE id=%s", (int(company_id),))
        conn.commit()
        return ok({"ok": True, "brand": bp.brand_status(cur, company_id)})

    return err(f"unknown action: {action}")


def notify_config_route(cur, conn, action, method, params, body, company_id):
    """Настройки Telegram-уведомлений компании: чтение, сохранение, тест."""
    if action == "notify_config" and method == "GET":
        return ok({
            "ok": True,
            "settings": np.get_settings(cur, company_id),
            "chats": np.list_chats(cur, company_id),
            "defaults": np.DEFAULT_TPL,
            "placeholders": np.PLACEHOLDERS,
        })

    if action == "notify_settings_save" and method in ("POST", "PUT"):
        st = np.save_settings(cur, company_id, body)
        conn.commit()
        return ok({"ok": True, "settings": st})

    if action == "notify_chat_save" and method in ("POST", "PUT"):
        rec_id, error = np.save_chat(cur, company_id, body)
        if error == "chat_taken":
            return err("Этот чат уже подключён к другой компании", 400)
        if error == "empty_chat_id":
            return err("Укажите ID чата", 400)
        conn.commit()
        return ok({"ok": True, "id": rec_id, "chats": np.list_chats(cur, company_id)})

    if action == "notify_chat_delete" and method == "DELETE":
        rec_id = int(params.get("id") or body.get("id") or 0)
        if not rec_id:
            return err("id required", 400)
        np.delete_chat(cur, company_id, rec_id)
        conn.commit()
        return ok({"ok": True, "chats": np.list_chats(cur, company_id)})

    if action == "notify_chat_test" and method in ("POST", "PUT"):
        # Проверка связи: шлём тестовое сообщение и возвращаем ответ Telegram
        # как есть — партнёр сразу видит причину (бот не добавлен и т.п.).
        chat_id = str(body.get("chat_id") or "").strip()
        if not chat_id:
            rec_id = int(body.get("id") or 0)
            for c in np.list_chats(cur, company_id):
                if c["id"] == rec_id:
                    chat_id = c["chat_id"]
                    break
        if not chat_id:
            return err("Укажите ID чата", 400)
        res = send_stress(
            "🔔 <b>Проверка связи</b>\nУведомления о стресс-тестах будут приходить сюда.",
            chat_id=chat_id)
        return ok({"ok": bool(res.get("ok")), "error": res.get("error")})

    return err(f"unknown action: {action}")


def heartbeat(cur, conn, body, company_id=None):
    """Почасовая отбивка длительного прогона (EXE → сайт).

    Хранит «живой» прогон в stress_run_live: какой тест идёт, сколько
    осталось, когда ждать следующую отбивку. Если отбивка не придёт к
    next_heartbeat_at + grace_sec — cron пришлёт предупреждение в Telegram.

    run_active=false — прогон закончился, строку удаляем.
    """
    run_uid = (body.get("run_uid") or "").strip()
    if not run_uid:
        return err("run_uid required", 400)

    # Финальная отбивка при остановке/отмене — просто снимаем прогон с контроля.
    if body.get("run_active") is False:
        cur.execute(f"DELETE FROM {SCHEMA}.stress_run_live WHERE run_uid = {esc(run_uid)}")
        conn.commit()
        return ok({"ok": True, "run_uid": run_uid, "finished": True})

    if not body.get("heartbeat_at") or not body.get("next_heartbeat_at"):
        return err("heartbeat_at / next_heartbeat_at required", 400)

    failed_tests = body.get("failed_tests") or []
    failed_json = json.dumps(failed_tests, ensure_ascii=False)
    payload_json = json.dumps(body, ensure_ascii=False)
    company_sql = str(int(company_id)) if company_id else "NULL"

    # UPSERT по run_uid. Новая отбивка = прогон жив, поэтому флаг алерта
    # сбрасываем: при следующей просрочке предупреждение уйдёт заново.
    cur.execute(
        f"INSERT INTO {SCHEMA}.stress_run_live ("
        f"run_uid, machine_name, profile_name, company_name, order_number, "
        f"started_at, heartbeat_at, next_heartbeat_at, heartbeat_interval_sec, grace_sec, "
        f"current_test_index, current_test_name, planned_total, completed_count, "
        f"failed_count, has_errors, failed_tests, remaining_sec, current_test_remaining_sec, "
        f"stale_alert_sent, stale_alert_at, payload, partner_company_id, updated_at) VALUES ("
        f"{esc(run_uid)}, {esc(body.get('machine', ''))}, {esc(body.get('profile', ''))}, "
        f"{esc(body.get('company_name', ''))}, {esc(body.get('order_number', ''))}, "
        f"{ts(body.get('started_at'))}, {ts(body.get('heartbeat_at'))}, "
        f"{ts(body.get('next_heartbeat_at'))}, "
        f"{int(num(body.get('heartbeat_interval_sec'), 3600))}, "
        f"{int(num(body.get('grace_sec'), 900))}, "
        f"{int(num(body.get('current_test_index')))}, {esc(body.get('current_test_name', ''))}, "
        f"{int(num(body.get('planned_total')))}, {int(num(body.get('completed_count')))}, "
        f"{int(num(body.get('failed_count')))}, "
        f"{'TRUE' if body.get('has_errors') else 'FALSE'}, "
        f"{esc(failed_json)}::jsonb, {int(num(body.get('remaining_sec')))}, "
        f"{int(num(body.get('current_test_remaining_sec')))}, "
        f"FALSE, NULL, {esc(payload_json)}::jsonb, {company_sql}, NOW()) "
        f"ON CONFLICT (run_uid) DO UPDATE SET "
        f"machine_name=EXCLUDED.machine_name, profile_name=EXCLUDED.profile_name, "
        f"company_name=EXCLUDED.company_name, order_number=EXCLUDED.order_number, "
        f"started_at=EXCLUDED.started_at, heartbeat_at=EXCLUDED.heartbeat_at, "
        f"next_heartbeat_at=EXCLUDED.next_heartbeat_at, "
        f"heartbeat_interval_sec=EXCLUDED.heartbeat_interval_sec, "
        f"grace_sec=EXCLUDED.grace_sec, current_test_index=EXCLUDED.current_test_index, "
        f"current_test_name=EXCLUDED.current_test_name, planned_total=EXCLUDED.planned_total, "
        f"completed_count=EXCLUDED.completed_count, failed_count=EXCLUDED.failed_count, "
        f"has_errors=EXCLUDED.has_errors, failed_tests=EXCLUDED.failed_tests, "
        f"remaining_sec=EXCLUDED.remaining_sec, "
        f"current_test_remaining_sec=EXCLUDED.current_test_remaining_sec, "
        f"stale_alert_sent=FALSE, stale_alert_at=NULL, payload=EXCLUDED.payload, "
        f"partner_company_id=EXCLUDED.partner_company_id, updated_at=NOW()"
    )
    conn.commit()

    # Побочный эффект по спецификации: заодно проверяем остальные прогоны.
    # Ошибка проверки не должна ломать приём отбивки.
    try:
        check_stale_heartbeats(cur, conn)
    except Exception as e:
        print(f"[HEARTBEAT] stale check failed: {e}")

    return ok({"ok": True, "run_uid": run_uid})


def check_stale_heartbeats(cur, conn):
    """Ищет прогоны без отбивки и шлёт предупреждение в Telegram.

    Просрочен, если NOW() > next_heartbeat_at + grace_sec И алерт ещё не слали.
    grace_sec берём из записи (его прислал EXE), а не хардкодим.
    """
    cur.execute(
        f"SELECT run_uid, machine_name, profile_name, company_name, order_number, "
        f"current_test_index, current_test_name, planned_total, failed_count, has_errors, "
        f"EXTRACT(EPOCH FROM (NOW() - (next_heartbeat_at + (grace_sec || ' seconds')::interval))) "
        f"FROM {SCHEMA}.stress_run_live "
        f"WHERE stale_alert_sent = FALSE AND next_heartbeat_at IS NOT NULL "
        f"AND NOW() > next_heartbeat_at + (grace_sec || ' seconds')::interval"
    )
    rows = cur.fetchall()
    alerted = []
    for r in rows:
        run_uid = r[0]
        # missed_minutes считаем от момента, когда отбивку ждали (с учётом grace).
        missed_min = int(max(0, (r[10] or 0)) // 60)
        payload = {
            "event": "heartbeat_stale",
            "machine": r[1], "profile": r[2],
            "company_name": r[3], "order_number": r[4],
            "current_test_index": r[5], "current_test_name": r[6],
            "planned_total": r[7], "failed_count": r[8],
            "has_errors": bool(r[9]), "missed_minutes": missed_min,
        }
        text = _build_notify_text(payload)
        if text:
            send_stress(text)
        # Флаг ставим в любом случае, иначе при недоступном Telegram
        # cron будет долбить одно и то же сообщение каждые 5 минут.
        cur.execute(
            f"UPDATE {SCHEMA}.stress_run_live SET stale_alert_sent = TRUE, "
            f"stale_alert_at = NOW() WHERE run_uid = {esc(run_uid)}"
        )
        alerted.append(run_uid)
    if alerted:
        conn.commit()
    return {"ok": True, "alerted": alerted, "count": len(alerted)}


def ingest(cur, conn, body, company_id=None):
    run_uid = (body.get("run_uid") or uuid.uuid4().hex).strip()

    # Прогон доехал до сайта — снимаем его с heartbeat-контроля, иначе
    # cron решит, что отбивка просрочена, и пришлёт ложную тревогу.
    # Делаем это и для duplicate ingest (спецификация, §4).
    cur.execute(f"DELETE FROM {SCHEMA}.stress_run_live WHERE run_uid = {esc(run_uid)}")

    # идемпотентность: один и тот же run_uid не плодит дубли
    cur.execute(f"SELECT id FROM {SCHEMA}.stress_runs WHERE run_uid = {esc(run_uid)}")
    existing = cur.fetchone()
    if existing:
        conn.commit()
        return ok({"ok": True, "run_id": existing[0], "duplicate": True})

    results = body.get("results") or []
    passed = sum(1 for r in results if r.get("success"))
    failed = len(results) - passed
    status = body.get("status") or ("completed" if failed == 0 else "partial")

    company_sql = str(int(company_id)) if company_id else "NULL"
    # Конфигурация ПК (процессор/мат.плата/ОЗУ/видеокарта/диски) — десктоп
    # собирает её сам и шлёт вместе с прогоном. Формат см. в шапке отчёта.
    hardware = body.get("hardware")
    hardware_sql = f"{esc(json.dumps(hardware, ensure_ascii=False))}::jsonb" if hardware else "NULL"
    cur.execute(
        f"INSERT INTO {SCHEMA}.stress_runs "
        f"(run_uid, profile_name, machine_name, os_info, note, started_at, finished_at, "
        f"total_tests, passed_tests, failed_tests, status, partner_company_id, hardware) VALUES "
        f"({esc(run_uid)}, {esc(body.get('profile_name', ''))}, {esc(body.get('machine_name', ''))}, "
        f"{esc(body.get('os_info', ''))}, {esc(body.get('note', ''))}, "
        f"{ts(body.get('started_at'))}, {ts(body.get('finished_at'))}, "
        f"{len(results)}, {passed}, {failed}, {esc(status)}, {company_sql}, {hardware_sql}) RETURNING id"
    )
    run_id = cur.fetchone()[0]

    for i, r in enumerate(results):
        exit_code = r.get("exit_code")
        exit_sql = "NULL" if exit_code is None else str(int(exit_code))
        cur.execute(
            f"INSERT INTO {SCHEMA}.stress_results "
            f"(run_id, test_name, command, exit_code, duration_sec, planned_sec, timed_out, success, "
            f"score_text, ocr_stress_failed, started_at, finished_at, sort_order) VALUES "
            f"({run_id}, {esc(r.get('test_name', ''))}, {esc(r.get('command', ''))}, {exit_sql}, "
            f"{num(r.get('duration_sec'))}, {int(num(r.get('planned_sec')))}, "
            f"{'TRUE' if r.get('timed_out') else 'FALSE'}, {'TRUE' if r.get('success') else 'FALSE'}, "
            f"{esc(r.get('score_text', '') or '')}, {'TRUE' if r.get('ocr_stress_failed') else 'FALSE'}, "
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

    # Индексируем verify-код прогона (HMAC на brand_key партнёра) — чтобы
    # страница /v/{код} по QR из PDF находила прогон сразу, без перебора.
    if company_id:
        try:
            bp.index_verify_code(cur, company_id, run_id, run_uid,
                                 body.get("finished_at") or body.get("started_at"))
        except Exception as e:
            print(f"[VERIFY_INDEX] run_id={run_id} error: {e}")

    conn.commit()

    # Уведомление в Telegram сразу после приёма результата — если EXE попросил
    # (notify:true в теле ingest). Тогда отдельный вызов action=notify не нужен.
    # Сбой Telegram НЕ роняет приём результата (всё уже сохранено и закоммичено).
    notify_result = None
    if body.get("notify"):
        try:
            machine = body.get("machine_name") or "—"
            profile = body.get("profile_name") or "—"
            # По каждому упавшему тесту — отдельное «test_failed»
            for r in results:
                if not r.get("success"):
                    t = _build_notify_text({
                        "event": "test_failed", "machine": machine, "profile": profile,
                        "test_name": r.get("test_name"), "exit_code": r.get("exit_code"),
                        "duration_sec": r.get("duration_sec"),
                    })
                    if t and np.claim_admin_send(cur, "test_failed", {
                            "machine": machine, "profile": profile,
                            "test_name": r.get("test_name"),
                            "exit_code": r.get("exit_code")}):
                        send_stress(t)
            # Итог прогона — со списком тестов, как в спеке формата.
            fin_text = _build_notify_text({
                "event": "run_finished", "machine": machine, "profile": profile,
                "order_number": body.get("order_number"), "note": body.get("note"),
                "tests": _tests_from_results(results),
                "passed": passed, "total": len(results),
            })
            if fin_text and np.claim_admin_send(cur, "run_finished", {
                    "machine": machine, "profile": profile,
                    "passed": passed, "total": len(results)}):
                notify_result = send_stress(fin_text)
            conn.commit()
            if notify_result and not notify_result.get("ok"):
                print(f"[INGEST_NOTIFY] run_id={run_id} telegram error: {notify_result.get('error')}")
        except Exception as e:
            print(f"[INGEST_NOTIFY] run_id={run_id} exception: {e}")

    # Уведомления партнёра — в ЕГО чаты, по ЕГО настройкам и шаблонам.
    # Не зависят от флага notify софта (им управляет панель партнёра) и никак
    # не влияют на общий админский чат выше.
    if company_id:
        try:
            for r in results:
                if not r.get("success"):
                    np.notify_company(cur, company_id, "test_failed", {
                        "machine": body.get("machine_name"),
                        "profile": body.get("profile_name"),
                        "test_name": r.get("test_name"),
                        "exit_code": r.get("exit_code"),
                        "duration_sec": r.get("duration_sec"),
                    })
            fin_body = {
                "event": "run_finished",
                "machine": body.get("machine_name"),
                "profile": body.get("profile_name"),
                "order_number": body.get("order_number"),
                "note": body.get("note"),
                "tests": _tests_from_results(results),
                "passed": passed, "total": len(results),
            }
            fin_parts = notify_parts(fin_body) or ("", "")
            np.notify_company(cur, company_id, "run_finished",
                              {**fin_body, "tail": fin_parts[1]})
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"[PARTNER_NOTIFY] run_id={run_id} exception: {e}")

    out = {"ok": True, "run_id": run_id, "results": len(results), "metrics": len(body.get("metrics") or [])}
    if notify_result is not None:
        out["notified"] = bool(notify_result.get("ok"))
        if not notify_result.get("ok"):
            out["notify_error"] = notify_result.get("error")
    return ok(out)


def own_company_id(cur):
    """id нашей компании (is_own) — под ней живёт брендинг наших отчётов."""
    cur.execute(f"SELECT id FROM {SCHEMA}.partner_companies WHERE is_own LIMIT 1")
    row = cur.fetchone()
    return row[0] if row else None


def _company_where(company_filter, prefix=""):
    """WHERE-условие фильтра по компании. None → все; 0 → без компании; N → компания N."""
    p = f"{prefix}." if prefix else ""
    if company_filter is None:
        return ""
    if isinstance(company_filter, str) and company_filter.startswith("own"):
        # «Наши» прогоны: без партнёра + помеченные нашей компанией
        own = company_filter[4:]
        if own.isdigit():
            return f"({p}partner_company_id IS NULL OR {p}partner_company_id = {int(own)})"
        return f"{p}partner_company_id IS NULL"
    if company_filter == 0:
        return f"{p}partner_company_id IS NULL"
    return f"{p}partner_company_id = {int(company_filter)}"


def list_runs(cur, company_filter=None):
    where = _company_where(company_filter, "r")
    where_sql = f"WHERE {where}" if where else ""
    # Название компании — для бейджа «чей прогон» в списке
    cur.execute(
        f"SELECT r.id, r.run_uid, r.profile_name, r.machine_name, r.os_info, r.note, "
        f"r.started_at, r.finished_at, r.total_tests, r.passed_tests, r.failed_tests, "
        f"r.status, r.created_at, r.folder_id, r.partner_company_id, r.folder_sort, "
        f"COALESCE(c.name, ''), COALESCE(c.is_own, FALSE), r.hardware "
        f"FROM {SCHEMA}.stress_runs r "
        f"LEFT JOIN {SCHEMA}.partner_companies c ON c.id = r.partner_company_id "
        f"{where_sql} ORDER BY r.created_at DESC LIMIT 500"
    )
    runs = [{
        "id": r[0], "run_uid": r[1], "profile_name": r[2], "machine_name": r[3],
        "os_info": r[4], "note": r[5], "started_at": r[6], "finished_at": r[7],
        "total_tests": r[8], "passed_tests": r[9], "failed_tests": r[10],
        "status": r[11], "created_at": r[12], "folder_id": r[13], "partner_company_id": r[14],
        "folder_sort": r[15],
        # Пустая компания = наш прогон (загружен не партнёром)
        "company_name": r[16] or "", "company_is_own": bool(r[17]) or not r[14],
        "hardware": r[18] or None,
    } for r in cur.fetchall()]
    return ok({"runs": runs})


# ─── Папки прогонов (группировка + номинальная привязка к заказу) ───────────

def folders_list(cur, company_filter=None):
    # Папки + количество прогонов в каждой
    where = _company_where(company_filter, "f")
    where_sql = f"WHERE {where}" if where else ""
    cur.execute(
        f"SELECT f.id, f.name, f.order_id, f.order_ref, f.note, f.created_at, "
        f"COUNT(r.id) AS runs_count, f.partner_company_id "
        f"FROM {SCHEMA}.stress_folders f "
        f"LEFT JOIN {SCHEMA}.stress_runs r ON r.folder_id = f.id "
        f"{where_sql} "
        f"GROUP BY f.id ORDER BY f.created_at DESC"
    )
    folders = [{
        "id": r[0], "name": r[1], "order_id": r[2], "order_ref": r[3],
        "note": r[4], "created_at": r[5], "runs_count": r[6], "partner_company_id": r[7],
    } for r in cur.fetchall()]
    return ok({"folders": folders})


def _own_folder(cur, fid, owner_cid):
    """Проверка, что папка fid принадлежит компании owner_cid (для партнёра)."""
    if owner_cid is None:
        return True
    cur.execute(f"SELECT partner_company_id FROM {SCHEMA}.stress_folders WHERE id = {int(fid)}")
    row = cur.fetchone()
    return bool(row) and row[0] == owner_cid


def folder_save(cur, conn, body, owner_cid=None):
    fid = body.get("id")
    name = (body.get("name") or "Новая папка").strip() or "Новая папка"
    order_id = body.get("order_id")
    order_id_sql = str(int(order_id)) if order_id not in (None, "", 0, "0") else "NULL"
    order_ref = body.get("order_ref") or ""
    note = body.get("note") or ""
    if fid:
        if not _own_folder(cur, fid, owner_cid):
            return err("forbidden", 403)
        cur.execute(
            f"UPDATE {SCHEMA}.stress_folders SET name = {esc(name)}, order_id = {order_id_sql}, "
            f"order_ref = {esc(order_ref)}, note = {esc(note)}, updated_at = NOW() "
            f"WHERE id = {int(fid)} RETURNING id"
        )
    else:
        cid_sql = str(int(owner_cid)) if owner_cid else "NULL"
        cur.execute(
            f"INSERT INTO {SCHEMA}.stress_folders (name, order_id, order_ref, note, partner_company_id) VALUES "
            f"({esc(name)}, {order_id_sql}, {esc(order_ref)}, {esc(note)}, {cid_sql}) RETURNING id"
        )
    new_id = cur.fetchone()[0]
    conn.commit()
    return ok({"ok": True, "id": new_id})


def folder_delete(cur, conn, fid, owner_cid=None):
    if not fid:
        return err("id required")
    if not _own_folder(cur, fid, owner_cid):
        return err("forbidden", 403)
    # Прогоны из папки не удаляем — просто отвязываем (folder_id = NULL)
    cur.execute(f"UPDATE {SCHEMA}.stress_runs SET folder_id = NULL WHERE folder_id = {int(fid)}")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_folders WHERE id = {int(fid)}")
    conn.commit()
    return ok({"ok": True})


def rename_run(cur, conn, body, owner_cid=None):
    # Переименование компа (machine_name) прогона. body: {id, machine_name}
    run_id = int(num(body.get("id")))
    if not run_id:
        return err("id required")
    name = (body.get("machine_name") or "").strip()[:200]
    own = f" AND partner_company_id = {int(owner_cid)}" if owner_cid is not None else ""
    cur.execute(
        f"UPDATE {SCHEMA}.stress_runs SET machine_name = {esc(name)} WHERE id = {run_id}{own}"
    )
    conn.commit()
    if not cur.rowcount:
        return err("not found", 404)
    return ok({"ok": True, "id": run_id, "machine_name": name})


def runs_assign_folder(cur, conn, body, owner_cid=None):
    # body: {run_ids: [..], folder_id: int|null}
    run_ids = body.get("run_ids") or []
    run_ids = [int(x) for x in run_ids if str(x).isdigit()]
    if not run_ids:
        return err("run_ids required")
    folder_id = body.get("folder_id")
    fid_sql = str(int(folder_id)) if folder_id not in (None, "", 0, "0") else "NULL"
    ids_sql = ",".join(str(x) for x in run_ids)
    # Партнёр может двигать только свои прогоны и в свою папку
    own = ""
    if owner_cid is not None:
        if folder_id and not _own_folder(cur, folder_id, owner_cid):
            return err("forbidden", 403)
        own = f" AND partner_company_id = {int(owner_cid)}"
    cur.execute(
        f"UPDATE {SCHEMA}.stress_runs SET folder_id = {fid_sql} WHERE id IN ({ids_sql}){own}"
    )
    conn.commit()
    return ok({"ok": True, "updated": cur.rowcount})


def folder_reorder(cur, conn, body, owner_cid=None):
    """Задаёт порядок прогонов внутри папки (drag&drop). Порядок = порядок в отчёте.
    body: {folder_id, run_ids: [упорядоченный список id]}"""
    folder_id = body.get("folder_id")
    run_ids = [int(x) for x in (body.get("run_ids") or []) if str(x).isdigit()]
    if not folder_id or not run_ids:
        return err("folder_id and run_ids required")
    if owner_cid is not None and not _own_folder(cur, folder_id, owner_cid):
        return err("forbidden", 403)
    own = f" AND partner_company_id = {int(owner_cid)}" if owner_cid is not None else ""
    # Проставляем folder_sort по позиции в списке (0,1,2,…) только для прогонов этой папки
    for idx, rid in enumerate(run_ids):
        cur.execute(
            f"UPDATE {SCHEMA}.stress_runs SET folder_sort = {idx} "
            f"WHERE id = {int(rid)} AND folder_id = {int(folder_id)}{own}"
        )
    conn.commit()
    return ok({"ok": True, "reordered": len(run_ids)})


def _first_link(social_links):
    """Первая непустая ссылка партнёра из social_links (по строке на ссылку)."""
    if not social_links:
        return ""
    for line in str(social_links).splitlines():
        s = line.strip()
        if s:
            return s[:300]
    return ""


def _all_links(social_links):
    """Весь перечень строк/ссылок партнёра (по строке на элемент, до 10)."""
    if not social_links:
        return []
    out = []
    for line in str(social_links).splitlines():
        s = line.strip()
        if s:
            out.append(s[:300])
        if len(out) >= 10:
            break
    return out


def folder_report(cur, fid, owner_cid=None):
    """Полные данные папки для отчёта: папка + все её прогоны с метриками."""
    if not fid:
        return err("id required")
    if not _own_folder(cur, fid, owner_cid):
        return err("forbidden", 403)
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
        f"SELECT sr.id, sr.run_uid, sr.profile_name, sr.machine_name, sr.os_info, sr.note, "
        f"sr.started_at, sr.finished_at, sr.total_tests, sr.passed_tests, sr.failed_tests, "
        f"sr.status, sr.created_at, pc.report_logo_url, pc.social_links, "
        f"sr.partner_company_id, COALESCE(pc.name, ''), COALESCE(pc.is_own, FALSE), sr.hardware "
        f"FROM {SCHEMA}.stress_runs sr "
        f"LEFT JOIN {SCHEMA}.partner_companies pc ON pc.id = sr.partner_company_id "
        f"WHERE sr.folder_id = {int(fid)} ORDER BY sr.folder_sort, sr.created_at DESC"
    )
    runs = []
    for r in cur.fetchall():
        runs.append({
            "id": r[0], "run_uid": r[1], "profile_name": r[2], "machine_name": r[3],
            "os_info": r[4], "note": r[5], "started_at": r[6], "finished_at": r[7],
            "total_tests": r[8], "passed_tests": r[9], "failed_tests": r[10],
            "status": r[11], "created_at": r[12], "partner_logo_url": r[13] or "",
            "partner_link": _first_link(r[14]), "partner_links": _all_links(r[14]),
            "hardware": r[18] or None,
            "metrics": [], "results": [],
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
            f"timed_out, success, score_text, ocr_stress_failed FROM {SCHEMA}.stress_results "
            f"WHERE run_id IN ({ids}) ORDER BY sort_order, id"
        )
        res_by_run = {}
        res_index = {}
        for x in cur.fetchall():
            item = {
                "id": x[0], "test_name": x[2], "command": x[3], "exit_code": x[4],
                "duration_sec": float(x[5]) if x[5] is not None else 0,
                "timed_out": x[6], "success": x[7],
                "score_text": x[8] or "", "ocr_stress_failed": x[9], "files": [],
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


def get_run(cur, run_id, owner_cid=None):
    if not run_id:
        return err("id required")
    own = f" AND sr.partner_company_id = {int(owner_cid)}" if owner_cid is not None else ""
    cur.execute(
        f"SELECT sr.id, sr.run_uid, sr.profile_name, sr.machine_name, sr.os_info, sr.note, "
        f"sr.started_at, sr.finished_at, sr.total_tests, sr.passed_tests, sr.failed_tests, "
        f"sr.status, sr.created_at, pc.report_logo_url, pc.social_links, "
        f"sr.partner_company_id, COALESCE(pc.name, ''), COALESCE(pc.is_own, FALSE), sr.hardware "
        f"FROM {SCHEMA}.stress_runs sr "
        f"LEFT JOIN {SCHEMA}.partner_companies pc ON pc.id = sr.partner_company_id "
        f"WHERE sr.id = {run_id}{own}"
    )
    r = cur.fetchone()
    if not r:
        return err("not found", 404)
    run = {
        "id": r[0], "run_uid": r[1], "profile_name": r[2], "machine_name": r[3],
        "os_info": r[4], "note": r[5], "started_at": r[6], "finished_at": r[7],
        "total_tests": r[8], "passed_tests": r[9], "failed_tests": r[10],
        "status": r[11], "created_at": r[12], "partner_logo_url": r[13] or "",
        "partner_link": _first_link(r[14]), "partner_links": _all_links(r[14]),
        # Чей прогон — для бейджа компании в карточке
        "partner_company_id": r[15], "company_name": r[16] or "",
        "company_is_own": bool(r[17]) or not r[15],
        "hardware": r[18] or None,
    }
    cur.execute(
        f"SELECT id, test_name, command, exit_code, duration_sec, planned_sec, timed_out, success, "
        f"started_at, finished_at, sort_order, score_text, ocr_stress_failed FROM {SCHEMA}.stress_results "
        f"WHERE run_id = {run_id} ORDER BY sort_order, id"
    )
    results = []
    for x in cur.fetchall():
        results.append({
            "id": x[0], "test_name": x[1], "command": x[2], "exit_code": x[3],
            "duration_sec": float(x[4]) if x[4] is not None else 0,
            "planned_sec": x[5], "timed_out": x[6], "success": x[7],
            "started_at": x[8], "finished_at": x[9], "sort_order": x[10],
            "score_text": x[11] or "", "ocr_stress_failed": x[12], "files": [],
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


def delete_run(cur, conn, run_id, owner_cid=None):
    if not run_id:
        return err("id required")
    # Партнёр может удалять только прогоны своей компании
    if owner_cid is not None:
        cur.execute(f"SELECT partner_company_id FROM {SCHEMA}.stress_runs WHERE id = {run_id}")
        row = cur.fetchone()
        if not row or row[0] != owner_cid:
            return err("forbidden", 403)
    cur.execute(
        f"DELETE FROM {SCHEMA}.stress_files WHERE result_id IN "
        f"(SELECT id FROM {SCHEMA}.stress_results WHERE run_id = {run_id})"
    )
    cur.execute(f"DELETE FROM {SCHEMA}.stress_results WHERE run_id = {run_id}")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_metrics WHERE run_id = {run_id}")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_runs WHERE id = {run_id}")
    conn.commit()
    return ok({"ok": True})


def delete_runs(cur, conn, run_ids, owner_cid=None):
    """Массовое удаление прогонов (кнопка «Выбрать» → «Удалить»).
    Партнёру доступны только прогоны своей компании — чужие молча пропускаем."""
    ids = [int(x) for x in (run_ids or []) if str(x).isdigit() or isinstance(x, int)]
    if not ids:
        return err("run_ids required")
    ids = ids[:500]
    in_list = ",".join(str(i) for i in ids)
    if owner_cid is not None:
        cur.execute(
            f"SELECT id FROM {SCHEMA}.stress_runs "
            f"WHERE id IN ({in_list}) AND partner_company_id = {int(owner_cid)}")
        ids = [r[0] for r in cur.fetchall()]
        if not ids:
            return err("forbidden", 403)
        in_list = ",".join(str(i) for i in ids)

    cur.execute(
        f"DELETE FROM {SCHEMA}.stress_files WHERE result_id IN "
        f"(SELECT id FROM {SCHEMA}.stress_results WHERE run_id IN ({in_list}))")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_results WHERE run_id IN ({in_list})")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_metrics WHERE run_id IN ({in_list})")
    cur.execute(f"DELETE FROM {SCHEMA}.stress_runs WHERE id IN ({in_list})")
    conn.commit()
    return ok({"ok": True, "deleted": len(ids)})


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