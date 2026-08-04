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
            # ПОРЯДОК КЛЮЧЕЙ ФИКСИРОВАН И ЗНАЧИМ (подпись считается по байтам):
            # logo_png_base64 → logo_url → verify_page_url → links → qr_url_template
            "logo_png_base64": br.get("logo_png_base64") or "",
            "logo_url": br.get("logo_url") or "",
            "verify_page_url": br.get("verify_page_url") or "",
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


def _label_for_url(url: str) -> str:
    """Человекочитаемое название ссылки по домену (Telegram, Avito, ...)."""
    u = (url or "").lower()
    known = [
        ("t.me", "Telegram"), ("telegram", "Telegram"), ("vk.com", "ВКонтакте"),
        ("avito", "Avito"), ("youtube", "YouTube"), ("youtu.be", "YouTube"),
        ("tiktok", "TikTok"), ("instagram", "Instagram"), ("wa.me", "WhatsApp"),
        ("whatsapp", "WhatsApp"), ("ozon", "Ozon"), ("wildberries", "Wildberries"),
        ("dzen", "Дзен"), ("rutube", "RuTube"), ("mailto:", "Почта"), ("tel:", "Телефон"),
    ]
    for needle, label in known:
        if needle in u:
            return label
    # Иначе — домен без www и схемы
    host = u.split("//", 1)[-1].split("/", 1)[0].replace("www.", "")
    return host or "Сайт"


def links_from_social(social_links: str):
    """Ссылки из профиля партнёра (по одной на строку) → [{label, url}]."""
    out = []
    for line in (social_links or "").splitlines():
        url = line.strip()
        if not url:
            continue
        if not url.startswith(("http://", "https://", "mailto:", "tel:")):
            url = "https://" + url
        out.append({"label": _label_for_url(url), "url": url})
        if len(out) >= MAX_LINKS:
            break
    return out


def logo_base64_from_url(url: str) -> str:
    """Скачивает логотип партнёра и приводит к PNG base64 (≤512×512).

    Логотипы в профиле лежат в WebP, а brand pack требует PNG — конвертируем.
    Любая ошибка не критична: вернём пусто, партнёр сможет загрузить вручную.
    """
    url = (url or "").strip()
    if not url:
        return ""
    try:
        import io
        import urllib.request
        from PIL import Image

        req = urllib.request.Request(url, headers={"User-Agent": "BeGraphics/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read(8 * 1024 * 1024)
        im = Image.open(io.BytesIO(raw))
        # Прозрачность сохраняем (RGBA), остальное приводим к RGB
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        im.thumbnail((512, 512), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        return base64.b64encode(buf.getvalue()).decode()
    except Exception as e:
        print(f"[BRANDING] не удалось подготовить логотип {url}: {e}")
        return ""


def company_defaults(cur, company_id):
    """Логотип и контакты, уже заполненные партнёром в кабинете, — чтобы
    брендинг не пришлось вводить второй раз."""
    cur.execute(
        f"SELECT report_logo_url, social_links FROM {SCHEMA}.partner_companies "
        f"WHERE id = %s", (int(company_id),))
    r = cur.fetchone()
    if not r:
        return {"logo_png_base64": "", "links": [], "logo_url": ""}
    return {
        "logo_png_base64": logo_base64_from_url(r[0]),
        "links": links_from_social(r[1]),
        "logo_url": r[0] or "",
    }


def _row_to_pack(row, company_uid, company_name):
    (brand_key, logo, links, qr_tpl, issued_at, expires_at, revoked_at,
     logo_url, verify_page_url) = row
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
            "logo_url": logo_url or "",
            "verify_page_url": verify_page_url or "",
            "links": (links or [])[:MAX_LINKS],
            "qr_url_template": qr_tpl or "",
        },
        "_revoked": revoked_at is not None,
    }


def get_brand_row(cur, company_id):
    cur.execute(
        f"SELECT brand_key, logo_base64, links, qr_url_template, issued_at, "
        f"expires_at, revoked_at, logo_url, verify_page_url "
        f"FROM {SCHEMA}.partner_brands WHERE company_id = %s",
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
    logo_url = str(body.get("logo_url") or "").strip()[:512]
    verify_page_url = str(body.get("verify_page_url") or "").strip().rstrip("/")[:512]
    # verify_page_url можно вывести из шаблона QR: .../v/{verify_code} → .../v
    if not verify_page_url and "{verify_code}" in qr_tpl:
        verify_page_url = qr_tpl.split("{verify_code}", 1)[0].rstrip("/")

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
            f"links=%s, qr_url_template=%s, logo_url=%s, verify_page_url=%s, "
            f"expires_at=%s, revoked_at=NULL, updated_at=NOW() WHERE company_id=%s",
            (brand_key, logo, json.dumps(clean), qr_tpl, logo_url, verify_page_url,
             expires_at, int(company_id)),
        )
    else:
        cur.execute(
            f"INSERT INTO {SCHEMA}.partner_brands "
            f"(company_id, brand_key, logo_base64, links, qr_url_template, "
            f"logo_url, verify_page_url, expires_at) "
            f"VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (int(company_id), brand_key, logo, json.dumps(clean), qr_tpl,
             logo_url, verify_page_url, expires_at),
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
        # Брендинг ещё не настраивали — подставляем логотип и контакты,
        # которые партнёр уже указал в кабинете, чтобы не вводить дважды.
        d = company_defaults(cur, company_id)
        return {
            "configured": False,
            "partner_id": str(comp[0]) if comp else "",
            "partner_name": comp[1] if comp else "",
            "links": d["links"],
            "logo_png_base64": d["logo_png_base64"],
            "logo_url": d["logo_url"],
            "prefilled": bool(d["logo_png_base64"] or d["links"]),
            "qr_url_template": "",
            "issued_at": "", "expires_at": "", "revoked": False, "expired": False,
        }
    pack = _row_to_pack(row, comp[0], comp[1])
    revoked = pack.pop("_revoked", False)
    expires_at = row[5]
    expired = bool(expires_at and expires_at < datetime.now(timezone.utc))

    # Запись есть, но логотип/ссылки пустые (например, сохранили до заполнения)
    # — подставляем данные из профиля компании, чтобы не вводить их вручную.
    logo = pack["branding"]["logo_png_base64"]
    links = pack["branding"]["links"]
    logo_url = pack["branding"]["logo_url"]
    prefilled = False
    if not logo or not links or not logo_url:
        d = company_defaults(cur, company_id)
        if not logo and d["logo_png_base64"]:
            logo = d["logo_png_base64"]
            prefilled = True
        if not links and d["links"]:
            links = d["links"]
            prefilled = True
        if not logo_url and d["logo_url"]:
            logo_url = d["logo_url"]

    return {
        "configured": True,
        "prefilled": prefilled,
        "partner_id": pack["partner_id"],
        "partner_name": pack["partner_name"],
        "logo_png_base64": logo,
        "logo_url": logo_url,
        "verify_page_url": pack["branding"]["verify_page_url"],
        "links": links,
        "qr_url_template": pack["branding"]["qr_url_template"],
        "issued_at": pack["issued_at"],
        "expires_at": pack["expires_at"],
        "revoked": revoked,
        "expired": expired,
        "has_key": bool(row[0]),
    }


def _qr_matrix(data: str):
    """QR-код версии 5 (37×37), коррекция L, байтовый режим — своя реализация,
    чтобы не зависеть от внешней библиотеки. Возвращает матрицу bool или None."""
    ver, size, cap, ec_len, blocks = 5, 37, 108, 26, 1  # 5-L: 108 байт данных
    raw = data.encode("utf-8")
    if len(raw) > cap - 2:
        return None

    # Битовый поток: режим 0100 + длина (8 бит для версий 1-9) + данные
    bits = []
    put = lambda val, n: bits.extend((val >> (n - 1 - i)) & 1 for i in range(n))
    put(0b0100, 4)
    put(len(raw), 8)
    for byte in raw:
        put(byte, 8)
    put(0, min(4, cap * 8 - len(bits)))            # терминатор
    while len(bits) % 8:
        bits.append(0)
    codewords = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    for i in range(cap - len(codewords)):          # padding
        codewords.append(0xEC if i % 2 == 0 else 0x11)

    # Рид-Соломон в GF(256)
    exp, log = [0] * 512, [0] * 256
    x = 1
    for i in range(255):
        exp[i] = x
        log[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        exp[i] = exp[i - 255]

    gen = [1]
    for i in range(ec_len):
        new = [0] * (len(gen) + 1)
        for j, c in enumerate(gen):
            new[j] ^= c
            new[j + 1] ^= exp[(log[c] + i) % 255] if c else 0
        gen = new

    rem = list(codewords) + [0] * ec_len
    for i in range(len(codewords)):
        factor = rem[i]
        if factor:
            lf = log[factor]
            for j, g in enumerate(gen):
                if g:
                    rem[i + j] ^= exp[(log[g] + lf) % 255]
    ec = rem[len(codewords):]
    full = codewords + ec

    # Разметка модулей
    m = [[None] * size for _ in range(size)]

    def finder(r0, c0):
        for r in range(-1, 8):
            for c in range(-1, 8):
                rr, cc = r0 + r, c0 + c
                if 0 <= rr < size and 0 <= cc < size:
                    inside = (0 <= r <= 6 and 0 <= c <= 6)
                    dark = inside and (r in (0, 6) or c in (0, 6) or (2 <= r <= 4 and 2 <= c <= 4))
                    m[rr][cc] = dark
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0)

    for i in range(8, size - 8):                    # тайминги
        m[6][i] = m[i][6] = (i % 2 == 0)

    for r in range(28, 33):                         # выравнивание (версия 5)
        for c in range(28, 33):
            m[r][c] = (r in (28, 32) or c in (28, 32) or (r == 30 and c == 30))

    m[size - 8][8] = True                           # dark module
    for i in range(9):                              # зоны формата
        if m[8][i] is None: m[8][i] = False
        if m[i][8] is None: m[i][8] = False
    for i in range(8):
        if m[8][size - 1 - i] is None: m[8][size - 1 - i] = False
        if m[size - 1 - i][8] is None: m[size - 1 - i][8] = False

    # Укладка данных зигзагом снизу вверх + маска 0
    bitstream = [(b >> (7 - i)) & 1 for b in full for i in range(8)]
    idx, upward, col = 0, True, size - 1
    while col > 0:
        if col == 6:
            col -= 1
        rows = range(size - 1, -1, -1) if upward else range(size)
        for row in rows:
            for c in (col, col - 1):
                if m[row][c] is None:
                    bit = bitstream[idx] if idx < len(bitstream) else 0
                    idx += 1
                    if (row + c) % 2 == 0:          # маска 000
                        bit ^= 1
                    m[row][c] = bool(bit)
        upward = not upward
        col -= 2

    # Формат: маска 000 + уровень L → биты 111011111000100
    # fmt[0] — старший бит. Копия 1: вокруг левого верхнего искателя,
    # копия 2: снизу слева (fmt[0..6]) и справа сверху (fmt[7..14]).
    fmt = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0]
    for i in range(6):
        m[8][i] = bool(fmt[i])
    m[8][7] = bool(fmt[6])
    m[8][8] = bool(fmt[7])
    m[7][8] = bool(fmt[8])
    for i in range(9, 15):
        m[14 - i][8] = bool(fmt[i])
    # Вторая копия
    for i in range(7):
        m[size - 1 - i][8] = bool(fmt[i])
    for i in range(7, 15):
        m[8][size - 15 + i] = bool(fmt[i])
    return [[bool(v) for v in row] for row in m]


def _qr_png(data: str, box: int = 8) -> bytes:
    """QR-код в PNG. Возвращает b"" при неудаче — архив всё равно соберётся,
    просто без картинки QR (файл-ключ и логотип важнее)."""
    try:
        import io
        try:
            import qrcode  # если библиотека есть — берём её (надёжнее)
            buf = io.BytesIO()
            qrcode.make(data, box_size=box, border=2).save(buf, format="PNG")
            return buf.getvalue()
        except ImportError:
            pass

        from PIL import Image
        matrix = _qr_matrix(data)
        if not matrix:
            return b""
        n, border = len(matrix), 2
        side = (n + border * 2) * box
        img = Image.new("RGB", (side, side), "white")
        px = img.load()
        for r, row in enumerate(matrix):
            for c, dark in enumerate(row):
                if not dark:
                    continue
                x0, y0 = (c + border) * box, (r + border) * box
                for y in range(y0, y0 + box):
                    for x in range(x0, x0 + box):
                        px[x, y] = (0, 0, 0)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as e:
        print(f"[BRANDING] QR не сгенерирован: {e}")
        return b""


def build_brand_archive(cur, company_id, pack):
    """ZIP с готовыми материалами брендинга: подписанный pack + картинки.

    Внутри:
      pack.stbrand   — подписанный brand pack (его импортирует StressRunner)
      logo.png       — логотип для шапки отчёта
      qr-sample.png  — пример QR (с плейсхолдером), чтобы проверить вёрстку
      README.txt     — короткая инструкция на русском
    """
    import io
    import zipfile

    br = pack.get("branding") or {}
    logo_b64 = br.get("logo_png_base64") or ""
    qr_tpl = br.get("qr_url_template") or ""

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("pack.stbrand", json.dumps(pack, ensure_ascii=False, indent=2))

        if logo_b64:
            try:
                z.writestr("logo.png", base64.b64decode(logo_b64))
            except Exception as e:
                print(f"[BRANDING] логотип не вшит в архив: {e}")

        sample_url = qr_tpl.replace("{verify_code}", "SAMPLE0000000000") if qr_tpl else ""
        if sample_url:
            qr = _qr_png(sample_url)
            if qr:
                z.writestr("qr-sample.png", qr)

        links_txt = "\n".join(
            f"  - {l.get('label') or ''}: {l.get('url') or ''}"
            for l in (br.get("links") or [])) or "  (не заданы)"
        z.writestr("README.txt", (
            "Материалы брендинга отчётов\n"
            "===========================\n\n"
            f"Компания: {pack.get('partner_name') or ''}\n"
            f"Выдан:    {pack.get('issued_at') or ''}\n"
            f"Действует до: {pack.get('expires_at') or ''}\n\n"
            "Что внутри:\n"
            "  pack.stbrand  - файл-ключ. Импортируйте его в программе\n"
            "                  StressRunner: раздел \"Брендинг PDF\" -> Импорт.\n"
            "                  После этого отчёты выходят под вашим брендом,\n"
            "                  в том числе без интернета.\n"
            "  logo.png      - ваш логотип из шапки отчёта.\n"
            "  qr-sample.png - пример QR-кода (с тестовым кодом), чтобы\n"
            "                  посмотреть, как он будет выглядеть.\n\n"
            f"Контакты в отчёте:\n{links_txt}\n\n"
            "ВАЖНО: файл-ключ подписан. Не редактируйте pack.stbrand вручную -\n"
            "программа перестанет его принимать. Если нужно что-то изменить,\n"
            "поправьте настройки в личном кабинете и скачайте архив заново.\n"
        ))
    return buf.getvalue()


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