"""White-label brand pack партнёра (.stbrand) — сборка, подпись, verify-код.

КРИТИЧНО: канонический payload обязан совпадать байт-в-байт с desktop
(PartnerBrandingCanonical.cs), иначе StressRunner отклонит подпись:
  • порядок ключей строго: v, partner_id, partner_name, issued_at,
    expires_at, brand_key, branding;
  • внутри branding: logo_png_base64, links[{label,url}], qr_url_template;
  • JSON без лишних пробелов, UTF-8;
  • подпись RSA-SHA256, padding PKCS#1 v1.5, значение — base64.

Приватный ключ берётся из секрета STRESS_BRAND_SIGNING_KEY_PEM и никогда
не покидает бэкенд. brand_key (секрет для HMAC verify-кодов) не отдаётся
никуда, кроме самого подписанного пака владельцу.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone

SCHEMA = "t_p72635010_quantum_fusion_resea"
PACK_VERSION = 1
MAX_LINKS = 5


def _iso(dt) -> str:
    """ISO 8601 UTC без микросекунд — формат, который ждёт desktop."""
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical_payload(pack: dict) -> bytes:
    """Канонический JSON для подписи (без поля signature)."""
    br = pack.get("branding") or {}
    links = []
    for l in (br.get("links") or []):
        links.append({"label": l.get("label") or "", "url": l.get("url") or ""})
    obj = {
        "v": pack.get("v", PACK_VERSION),
        "partner_id": pack.get("partner_id") or "",
        "partner_name": pack.get("partner_name") or "",
        "issued_at": pack.get("issued_at") or "",
        "expires_at": pack.get("expires_at") or "",
        "brand_key": pack.get("brand_key") or "",
        "branding": {
            "logo_png_base64": br.get("logo_png_base64") or "",
            "links": links,
            "qr_url_template": br.get("qr_url_template") or "",
        },
    }
    # separators без пробелов + ensure_ascii=False → тот же байтовый payload,
    # что и JSON.stringify в примере спецификации.
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def sign_pack(pack: dict) -> dict:
    """Добавляет signature. Бросает RuntimeError, если ключ не настроен."""
    pem = os.environ.get("STRESS_BRAND_SIGNING_KEY_PEM", "").strip()
    if not pem:
        raise RuntimeError("no_signing_key")
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    key = serialization.load_pem_private_key(pem.encode(), password=None)
    sig = key.sign(canonical_payload(pack), padding.PKCS1v15(), hashes.SHA256())
    out = dict(pack)
    out["signature"] = base64.b64encode(sig).decode()
    return out


def verify_code(brand_key: str, run_uid: str, finished_at) -> str:
    """verify_code = первые 16 символов base64url(HMAC-SHA256(brand_key, msg)),
    где msg = run_uid + "|" + finished_at (ISO UTC, без миллисекунд)."""
    if not brand_key or not run_uid or not finished_at:
        return ""
    fin = finished_at if isinstance(finished_at, str) else _iso(finished_at)
    msg = f"{run_uid}|{fin}"
    digest = hmac.new(brand_key.encode(), msg.encode(), hashlib.sha256).digest()
    b64 = base64.b64encode(digest).decode()
    return b64.replace("+", "-").replace("/", "_").rstrip("=")[:16]


def _row_to_pack(row, company_uid, company_name):
    (brand_key, logo, links, qr_tpl, issued_at, expires_at, revoked_at) = row
    if isinstance(links, str):
        try:
            links = json.loads(links or "[]")
        except Exception:
            links = []
    return {
        "v": PACK_VERSION,
        "partner_id": str(company_uid),
        "partner_name": company_name or "",
        "issued_at": _iso(issued_at),
        "expires_at": _iso(expires_at),
        "brand_key": brand_key or "",
        "branding": {
            "logo_png_base64": logo or "",
            "links": (links or [])[:MAX_LINKS],
            "qr_url_template": qr_tpl or "",
        },
        "_revoked": revoked_at is not None,
    }


def get_brand_row(cur, company_id):
    cur.execute(
        f"SELECT brand_key, logo_base64, links, qr_url_template, issued_at, "
        f"expires_at, revoked_at FROM {SCHEMA}.partner_brands WHERE company_id = %s",
        (int(company_id),),
    )
    return cur.fetchone()


def get_company(cur, company_id):
    cur.execute(
        f"SELECT public_uid, name, white_label_enabled "
        f"FROM {SCHEMA}.partner_companies WHERE id = %s",
        (int(company_id),),
    )
    return cur.fetchone()


def build_pack(cur, company_id, signed=True):
    """Собирает brand pack компании. Возвращает (pack|None, error|None).

    error: no_brand — брендинг не настроен; revoked — отозван;
           no_signing_key — на сервере нет ключа подписи.
    """
    comp = get_company(cur, company_id)
    if not comp:
        return None, "no_company"
    row = get_brand_row(cur, company_id)
    if not row:
        return None, "no_brand"
    pack = _row_to_pack(row, comp[0], comp[1])
    revoked = pack.pop("_revoked", False)
    if revoked:
        return None, "revoked"
    if not signed:
        return pack, None
    try:
        return sign_pack(pack), None
    except RuntimeError:
        return None, "no_signing_key"


def save_brand(cur, company_id, body):
    """Сохранить настройки брендинга. Возвращает (ok, error|None).

    rotate_key=True — перевыпустить brand_key (старые QR перестанут
    проверяться, desktop получит новый ключ при следующей синхронизации).
    """
    links = body.get("links")
    if not isinstance(links, list):
        links = []
    clean = []
    for l in links[:MAX_LINKS]:
        label = str((l or {}).get("label") or "").strip()[:64]
        url = str((l or {}).get("url") or "").strip()[:512]
        if label or url:
            clean.append({"label": label, "url": url})

    logo = str(body.get("logo_png_base64") or "")
    if "," in logo[:64] and logo.lstrip().startswith("data:"):
        logo = logo.split(",", 1)[1]  # срезаем data:image/png;base64,
    logo = logo.strip()
    # ~200 KB бинарника ≈ 280 KB в base64
    if len(logo) > 400_000:
        return False, "logo_too_big"

    qr_tpl = str(body.get("qr_url_template") or "").strip()[:512]

    row = get_brand_row(cur, company_id)
    rotate = bool(body.get("rotate_key"))
    brand_key = (row[0] if row else "") or ""
    if not brand_key or rotate:
        brand_key = secrets.token_hex(32)  # 64 hex-символа по спеке

    expires_at = body.get("expires_at")
    if not expires_at:
        expires_at = datetime.now(timezone.utc) + timedelta(days=365)

    if row:
        cur.execute(
            f"UPDATE {SCHEMA}.partner_brands SET brand_key=%s, logo_base64=%s, "
            f"links=%s, qr_url_template=%s, expires_at=%s, revoked_at=NULL, "
            f"updated_at=NOW() WHERE company_id=%s",
            (brand_key, logo, json.dumps(clean), qr_tpl, expires_at, int(company_id)),
        )
    else:
        cur.execute(
            f"INSERT INTO {SCHEMA}.partner_brands "
            f"(company_id, brand_key, logo_base64, links, qr_url_template, expires_at) "
            f"VALUES (%s,%s,%s,%s,%s,%s)",
            (int(company_id), brand_key, logo, json.dumps(clean), qr_tpl, expires_at),
        )
    # Брендинг настроен — включаем white-label для компании.
    cur.execute(
        f"UPDATE {SCHEMA}.partner_companies SET white_label_enabled=TRUE, "
        f"updated_at=NOW() WHERE id=%s AND white_label_enabled=FALSE",
        (int(company_id),),
    )
    return True, None


def brand_status(cur, company_id):
    """Состояние брендинга для ЛК. brand_key НЕ отдаём наружу."""
    comp = get_company(cur, company_id)
    row = get_brand_row(cur, company_id)
    if not row:
        return {
            "configured": False,
            "partner_id": str(comp[0]) if comp else "",
            "partner_name": comp[1] if comp else "",
            "links": [], "logo_png_base64": "", "qr_url_template": "",
            "issued_at": "", "expires_at": "", "revoked": False, "expired": False,
        }
    pack = _row_to_pack(row, comp[0], comp[1])
    revoked = pack.pop("_revoked", False)
    expires_at = row[5]
    expired = bool(expires_at and expires_at < datetime.now(timezone.utc))
    return {
        "configured": True,
        "partner_id": pack["partner_id"],
        "partner_name": pack["partner_name"],
        "logo_png_base64": pack["branding"]["logo_png_base64"],
        "links": pack["branding"]["links"],
        "qr_url_template": pack["branding"]["qr_url_template"],
        "issued_at": pack["issued_at"],
        "expires_at": pack["expires_at"],
        "revoked": revoked,
        "expired": expired,
        "has_key": bool(row[0]),
    }


def index_verify_code(cur, company_id, run_id, run_uid, finished_at):
    """При ingest считаем verify_code прогона и сохраняем — чтобы страница
    /v/{code} находила прогон сразу, без перебора."""
    if not company_id or not run_uid:
        return ""
    row = get_brand_row(cur, company_id)
    if not row or not row[0]:
        return ""
    code = verify_code(row[0], run_uid, finished_at)
    if code:
        cur.execute(
            f"UPDATE {SCHEMA}.stress_runs SET verify_code=%s WHERE id=%s",
            (code, int(run_id)),
        )
    return code


def lookup_verify(cur, code):
    """Публичная проверка отчёта по verify-коду. Секреты не раскрываем."""
    code = str(code or "").strip()
    if not code or len(code) > 32:
        return None
    cur.execute(
        f"SELECT r.run_uid, r.machine_name, r.profile_name, r.started_at, "
        f"r.finished_at, r.total_tests, r.passed_tests, r.failed_tests, "
        f"c.name, b.links "
        f"FROM {SCHEMA}.stress_runs r "
        f"JOIN {SCHEMA}.partner_companies c ON c.id = r.partner_company_id "
        f"LEFT JOIN {SCHEMA}.partner_brands b ON b.company_id = c.id "
        f"WHERE r.verify_code = %s LIMIT 1",
        (code,),
    )
    r = cur.fetchone()
    if not r:
        return None
    links = r[9]
    if isinstance(links, str):
        try:
            links = json.loads(links or "[]")
        except Exception:
            links = []
    return {
        "found": True,
        "partner_name": r[8] or "",
        "machine": r[1] or "",
        "profile": r[2] or "",
        "started_at": _iso(r[3]),
        "finished_at": _iso(r[4]),
        "total": r[5] or 0,
        "passed": r[6] or 0,
        "failed": r[7] or 0,
        "links": links or [],
    }
