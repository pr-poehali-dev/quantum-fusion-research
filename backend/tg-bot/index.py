"""Telegram-бот склада BeGraphics.

UX:
- Каждое действие — НОВОЕ сообщение (без редактирования).
- Железо выводится ТЕКСТОМ нумерованным списком.
- Управление — reply-кнопки у клавиатуры: 📂 Категории / 🔍 Поиск / 🛒 Корзина / 🏠 Меню.
- Выбор товара: написать его номер из списка. Кол-во: «2 x3» или «2*3» = товар №2, 3 шт.

Возможности:
- 📂 Категории — наличие по разделам (динамически из warehouse_groups.category).
- 🔍 Интеллектуальный поиск: синонимы (видяха→видеокарта, проц→процессор...),
  фикс раскладки, многословный AND-поиск, ранжирование, подсказка категорий.
- 🛒 Корзина: позиции с количеством, оформление заказа.
- Создание заказа железа (order_type=parts) с авторезервом через warehouse_core.

Доступ: поиск — всем; заказ — всем (менеджеры из tg_bot_managers помечаются).
Webhook: Telegram шлёт POST с update. Токен — TELEGRAM_BOT_TOKEN.
"""
import os
import json
import socket
import ssl
import threading
import http.client
import time
import urllib.request
import urllib.parse
import urllib.error
import psycopg2

# В облаке у api.telegram.org резолвится ещё и IPv6-адрес, но исходящего IPv6
# нет — попытка соединения висит до таймаута, и бот отвечает с задержкой.
# Поэтому IPv4-адреса ставим ПЕРВЫМИ. Важно: именно сортируем, а не отбрасываем
# IPv6 — раньше жёсткая фильтрация оставляла бота вообще без маршрута, если
# IPv4-путь недоступен (все попытки падали в "timed out", бот молчал).
_getaddrinfo_orig = socket.getaddrinfo


def _getaddrinfo_ipv4_first(host, port, family=0, type=0, proto=0, flags=0):
    res = _getaddrinfo_orig(host, port, family, type, proto, flags)
    return sorted(res, key=lambda r: 0 if r[0] == socket.AF_INET else 1)


socket.getaddrinfo = _getaddrinfo_ipv4_first

# Таймауты подключения к Telegram. 1 сек не хватало: в облаке TLS-рукопожатие
# нередко занимает дольше, и все 5 попыток срывались на этапе connect
# (вызов длился ровно 5×(1.0+0.2)=6 сек и заканчивался "timed out").
TG_CONNECT_TIMEOUT = 5.0
TG_READ_TIMEOUT = 10.0

SCHEMA = "t_p72635010_quantum_fusion_resea"
TG_API = "https://api.telegram.org/bot{token}/{method}"
SELF_URL = "https://functions.poehali.dev/6cf7e69d-a5f1-45db-b94e-43f37dd16961"
PAGE_SIZE = 10

# Главное меню — теперь inline-кнопки (внутри сообщений), а не reply-клавиатура.
MAIN_INLINE = [
    [{"text": "📂 Категории", "callback_data": "menu:categories"},
     {"text": "🔍 Поиск", "callback_data": "menu:search"}],
    [{"text": "🛒 Корзина", "callback_data": "menu:cart"},
     {"text": "🏠 Меню", "callback_data": "menu:home"}],
]


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


_tg_conn = None
_tg_ip_ok = None  # последний IP Telegram, с которым связь реально поднялась

# У api.telegram.org несколько дата-центров. Из облака провайдера часть из них
# недоступна: DNS стабильно отдаёт 149.154.166.110, а TCP до него не проходит
# (timeout), при этом 149.154.167.220 отвечает за ~50 мс.
#
# ВАЖНО (v8.08): последовательный перебор адресов не годится. Лимит исполнения
# функции бывает 5 сек (stress), и одно ожидание мёртвого адреса съедало его
# целиком — до живого адреса очередь не доходила, вызов падал с 504.
# Поэтому подключаемся ко ВСЕМ адресам ПАРАЛЛЕЛЬНО и берём первый ответивший
# (happy eyeballs). Мёртвые адреса больше не задерживают отправку.
TG_HOST = "api.telegram.org"
TG_FALLBACK_IPS = [
    "149.154.167.220",
    "149.154.175.50",
    "149.154.166.110",
    "91.108.56.130",
    "149.154.171.5",
]
# Бюджет на установку связи. Держим заведомо меньше самого жёсткого лимита
# функции (5 сек), чтобы осталось время на сам запрос и ответ.
TG_DIAL_TIMEOUT = 2.5


def _tg_candidate_ips():
    """Адреса Telegram: подтверждённый рабочий, известные запасные и выдача DNS."""
    ips = []
    if _tg_ip_ok:
        ips.append(_tg_ip_ok)
    for ip in TG_FALLBACK_IPS:
        if ip not in ips:
            ips.append(ip)
    try:
        for i in _getaddrinfo_orig(TG_HOST, 443, socket.AF_INET, socket.SOCK_STREAM):
            ip = i[4][0]
            if ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


def _tg_dial():
    """Параллельно подключается ко всем адресам Telegram, возвращает (сокет, ip)
    первого ответившего. Остальные соединения закрываются."""
    ctx = ssl.create_default_context()
    ips = _tg_candidate_ips()
    result = {}
    lock = threading.Lock()
    done = threading.Event()

    def dial(ip):
        try:
            raw = socket.create_connection((ip, 443), timeout=TG_DIAL_TIMEOUT)
            tls = ctx.wrap_socket(raw, server_hostname=TG_HOST)
        except Exception as e:
            with lock:
                result.setdefault("err", e)
            return
        with lock:
            if "sock" in result:
                try:
                    tls.close()
                except Exception:
                    pass
                return
            result["sock"] = tls
            result["ip"] = ip
        done.set()

    threads = [threading.Thread(target=dial, args=(ip,), daemon=True) for ip in ips]
    for t in threads:
        t.start()
    done.wait(TG_DIAL_TIMEOUT + 0.5)
    with lock:
        if "sock" in result:
            return result["sock"], result["ip"]
        err = result.get("err")
    raise err if err else RuntimeError("telegram unreachable")


def _tg_connect():
    """Одно keep-alive соединение с Telegram на весь запуск функции.
    Возвращает (соединение, свежее_ли_оно): для свежего повтор запроса опасен."""
    global _tg_conn, _tg_ip_ok
    if _tg_conn is not None:
        return _tg_conn, False
    # TCP идёт на конкретный IP, а TLS-рукопожатие и заголовок Host —
    # на api.telegram.org, поэтому сертификат проверяется штатно.
    tls, ip = _tg_dial()
    tls.settimeout(TG_READ_TIMEOUT)
    c = http.client.HTTPSConnection(TG_HOST, 443, timeout=TG_READ_TIMEOUT)
    c.sock = tls
    _tg_conn = c
    _tg_ip_ok = ip
    return _tg_conn, True


def _tg_drop():
    global _tg_conn
    if _tg_conn is not None:
        try:
            _tg_conn.close()
        except Exception:
            pass
        _tg_conn = None


def tg_call(method: str, payload: dict):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("TG_BOT: нет TELEGRAM_BOT_TOKEN")
        return None
    path = f"/bot{token}/{method}"
    data = json.dumps(payload).encode()
    last_err = None
    # Повторяем только заведомо недоставленное: обрыв при установке связи или
    # на переиспользованном канале. Сбой на свежем соединении уже после
    # отправки не повторяем — иначе сообщение уйдёт в чат дважды.
    # Попыток 3, а не 5: с TG_CONNECT_TIMEOUT=5s пять попыток съели бы ~26 сек
    # и функция упала бы по таймауту исполнения, не успев ответить Telegram.
    for _ in range(3):
        try:
            c, fresh = _tg_connect()
        except Exception as e:
            last_err = e
            _tg_drop()
            time.sleep(0.2)
            continue
        try:
            c.request("POST", path, data, {"Content-Type": "application/json"})
            resp = c.getresponse()
            raw = resp.read()
            if resp.status != 200:
                print(f"TG_BOT {method}: HTTP {resp.status} {raw[:300].decode('utf-8', 'replace')}")
                return None
            return json.loads(raw)
        except Exception as e:
            last_err = e
            _tg_drop()
            if fresh:
                break
            time.sleep(0.2)
    print(f"TG_BOT {method}: {last_err}")
    return None


def send(chat_id, text, reply_kb=True, inline=None):
    """Отправить НОВОЕ сообщение.
    По умолчанию прикрепляем inline главное меню (Категории/Поиск/Корзина/Меню).
    Если передан свой inline — используем его. reply_kb=False — без кнопок вообще.
    Параметр reply_kb оставлен для обратной совместимости вызовов."""
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
               "disable_web_page_preview": True}
    if inline is not None:
        payload["reply_markup"] = {"inline_keyboard": inline}
    elif reply_kb:
        payload["reply_markup"] = {"inline_keyboard": MAIN_INLINE}
    return tg_call("sendMessage", payload)


def remove_reply_kb(chat_id):
    """Одноразово убрать старую залипшую reply-клавиатуру у поля ввода."""
    tg_call("sendMessage", {
        "chat_id": chat_id,
        "text": "Меню переехало в кнопки под сообщениями 👇",
        "reply_markup": {"remove_keyboard": True},
    })


# ─────────────────────────── СОСТОЯНИЕ / КОРЗИНА ───────────────────────────

def load_cart(cur, chat_id):
    cur.execute(
        f"SELECT state, state_data, items FROM {SCHEMA}.tg_bot_carts WHERE chat_id=%s",
        (chat_id,))
    row = cur.fetchone()
    if not row:
        cur.execute(f"INSERT INTO {SCHEMA}.tg_bot_carts (chat_id) VALUES (%s)", (chat_id,))
        return {"state": "idle", "state_data": {}, "items": []}
    return {"state": row[0] or "idle", "state_data": row[1] or {}, "items": row[2] or []}


def save_cart(cur, chat_id, state=None, state_data=None, items=None):
    sets, vals = [], []
    if state is not None:
        sets.append("state=%s"); vals.append(state)
    if state_data is not None:
        sets.append("state_data=%s"); vals.append(json.dumps(state_data))
    if items is not None:
        sets.append("items=%s"); vals.append(json.dumps(items))
    sets.append("updated_at=NOW()")
    vals.append(chat_id)
    cur.execute(f"UPDATE {SCHEMA}.tg_bot_carts SET {', '.join(sets)} WHERE chat_id=%s", vals)


def is_manager(cur, chat_id):
    cur.execute(f"SELECT 1 FROM {SCHEMA}.tg_bot_managers WHERE chat_id=%s", (chat_id,))
    return cur.fetchone() is not None


# ─────────────────────────── ИНТЕЛЛЕКТУАЛЬНЫЙ ПОИСК ───────────────────────────

_LAYOUT_RU2EN = str.maketrans(
    "йцукенгшщзхъфывапролджэячсмитьбю",
    "qwertyuiop[]asdfghjkl;'zxcvbnm,.")
_LAYOUT_EN2RU = str.maketrans(
    "qwertyuiop[]asdfghjkl;'zxcvbnm,.",
    "йцукенгшщзхъфывапролджэячсмитьбю")

SYNONYMS = {
    "видяха": "видеокарта", "видюха": "видеокарта", "гпу": "видеокарта",
    "гпушка": "видеокарта", "gpu": "видеокарта", "карта": "видеокарта",
    "проц": "процессор", "цпу": "процессор", "cpu": "процессор",
    "камень": "процессор",
    "мать": "материнская", "матка": "материнская", "мамка": "материнская",
    "мб": "материнская", "motherboard": "материнская", "плата": "материнская",
    "озу": "оперативная память", "память": "память", "рам": "память",
    "ram": "память", "ddr": "память",
    "ссд": "ssd", "хард": "накопитель", "диск": "накопитель", "hdd": "накопитель",
    "винт": "накопитель", "ссдшка": "ssd",
    "бп": "блок питания", "psu": "блок питания",
    "кулер": "охлаждение", "куллер": "охлаждение", "вентилятор": "охлаждение",
    "корпус": "корпус", "кейс": "корпус", "case": "корпус",
}


# Похожие кириллические/латинские буквы → к латинице (для моделей: 9800х3d == 9800x3d)
_CONFUSABLES = str.maketrans({
    "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o",
    "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "і": "i", "ї": "i",
})


def canon(s):
    """Каноничная форма для сравнения: lower, унификация похожих букв,
    выкидываем всё кроме букв/цифр. «RTX 3080 Ti» -> «rtx3080ti»,
    «9800х3d»(кир) -> «9800x3d»."""
    s = (s or "").lower().translate(_CONFUSABLES)
    return "".join(ch for ch in s if ch.isalnum())


def _word_variants(w):
    """Варианты слова для LIKE: само слово + версия с латинизацией спутанных букв."""
    out = {w}
    lat = w.translate(_CONFUSABLES)
    if lat != w:
        out.add(lat)
    return out


def normalize_query(q):
    q = (q or "").lower().strip()
    variants = set()

    def words_of(s):
        toks = []
        for w in s.replace(",", " ").split():
            w = w.strip(".,!?;:()[]\"'")
            if not w:
                continue
            toks.append(SYNONYMS.get(w, w))
        out = []
        for t in toks:
            out.extend(t.split())
        return out

    variants.add(tuple(words_of(q)))
    variants.add(tuple(words_of(q.translate(_LAYOUT_EN2RU))))
    variants.add(tuple(words_of(q.translate(_LAYOUT_RU2EN))))
    return [list(v) for v in variants if v]


def _trigrams(s):
    s = f"  {s} "
    return {s[i:i+3] for i in range(len(s) - 2)}


def _similarity(a, b):
    """Триграммное сходство 0..1 (аналог pg_trgm.similarity)."""
    if not a or not b:
        return 0.0
    ta, tb = _trigrams(a), _trigrams(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


# Унификация спутанных букв прямо в SQL: translate(lower(...), кир, лат).
# Тогда «x3d»(лат) найдёт и «9800х3d»(кир), и «7800x3d»(лат).
_SQL_FROM = "аєвекмнорстухії"
_SQL_TO = "aebekmhopctyxii"
_NAME_CANON = f"translate(LOWER(g.name), '{_SQL_FROM}', '{_SQL_TO}')"
_CAT_CANON = f"translate(LOWER(g.category), '{_SQL_FROM}', '{_SQL_TO}')"


def _canon_word(w):
    """Латинизируем слово запроса теми же правилами, что и имя в SQL."""
    return w.translate(_CONFUSABLES)


def _run_search(cur, words, offset, limit):
    if not words:
        return [], False
    conds, params = [], []
    for w in words:
        cw = _canon_word(w)
        conds.append(f"({_NAME_CANON} LIKE %s OR {_CAT_CANON} LIKE %s)")
        params += [f"%{cw}%", f"%{cw}%"]
    where = " AND ".join(conds)
    rank_word = _canon_word(words[0])
    sql = f"""
        SELECT g.product_id, g.name, g.price_retail,
               COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
        FROM {SCHEMA}.warehouse_groups g
        LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
        WHERE g.is_archived = FALSE AND g.product_id IS NOT NULL AND {where}
        GROUP BY g.id, g.product_id, g.name, g.price_retail
        HAVING (COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0)) > 0
        ORDER BY (CASE WHEN POSITION(%s IN {_NAME_CANON}) = 0 THEN 9999
                       ELSE POSITION(%s IN {_NAME_CANON}) END), g.name
        LIMIT %s OFFSET %s"""
    cur.execute(sql, params + [rank_word, rank_word, limit + 1, offset])
    rows = cur.fetchall()
    has_more = len(rows) > limit
    return [r[:4] for r in rows[:limit]], has_more


def _all_instock(cur):
    """Все товары в наличии (id, name, price, avail) — для фаззи-поиска в Python."""
    cur.execute(
        f"""SELECT g.product_id, g.name, g.price_retail, g.category,
                   COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.is_archived = FALSE AND g.product_id IS NOT NULL
            GROUP BY g.id, g.product_id, g.name, g.price_retail, g.category
            HAVING (COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0)) > 0""")
    return cur.fetchall()


def _fuzzy_search(cur, query):
    """Поиск по модели «склеенной» и с опечатками: канонизуем запрос и названия,
    матчим по вхождению подстроки и триграммному сходству. Возвращает
    отсортированный список (pid, name, price, avail)."""
    words = [w for ws in normalize_query(query) for w in ws]
    q_canon = canon(query)
    q_words_canon = [canon(w) for w in words if canon(w)]
    if not q_canon and not q_words_canon:
        return []
    # слишком короткий запрос — фаззи даст мусор, пропускаем
    if len(q_canon) < 3:
        return []
    scored = []
    for pid, name, price, category, avail in _all_instock(cur):
        nc = canon(name)
        cc = canon(category)
        score = 0.0
        # 1) Прямое вхождение склеенного запроса в склеенное имя — топ-приоритет
        if q_canon and q_canon in nc:
            score = 1.0 + (0.3 if nc.startswith(q_canon) else 0.0)
        else:
            # 2) Каждое слово запроса — вхождение или похожесть
            hit_words = 0
            sim_sum = 0.0
            for w in q_words_canon:
                if w and (w in nc or w in cc):
                    hit_words += 1
                    sim_sum += 1.0
                else:
                    sim_sum += _similarity(w, nc)
            if q_words_canon:
                coverage = hit_words / len(q_words_canon)
                score = coverage * 0.7 + (sim_sum / len(q_words_canon)) * 0.3
            # 3) общее триграммное сходство всей строки (ловит опечатки в одном слове)
            score = max(score, _similarity(q_canon, nc) * 0.9)
        if score >= 0.34:
            scored.append((score, name.lower(), pid, name, price, avail))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [(pid, name, price, avail) for _, _, pid, name, price, avail in scored]


def search_products(cur, query, offset=0):
    # 1) Быстрый точный поиск по словам (LIKE) с учётом раскладки и спутанных букв
    for words in normalize_query(query):
        rows, has_more = _run_search(cur, words, offset, PAGE_SIZE)
        if rows:
            return rows, has_more
    # 2) Фаззи-поиск: модели слитно/раздельно + опечатки (триграммы)
    fuzzy = _fuzzy_search(cur, query)
    if fuzzy:
        page = fuzzy[offset:offset + PAGE_SIZE]
        return page, len(fuzzy) > offset + PAGE_SIZE
    # 3) последний шанс — по самому длинному слову
    longest = max((w for ws in normalize_query(query) for w in ws), key=len, default="")
    if len(longest) >= 3:
        return _run_search(cur, [longest], offset, PAGE_SIZE)
    return [], False


def search_categories(cur, query):
    flat = [w for ws in normalize_query(query) for w in ws]
    if not flat:
        return []
    conds, params = [], []
    for w in set(flat):
        conds.append("LOWER(g.category) LIKE %s")
        params.append(f"%{w}%")
    cur.execute(
        f"""SELECT g.category FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.is_archived = FALSE AND g.category <> '' AND ({' OR '.join(conds)})
            GROUP BY g.category
            HAVING SUM(GREATEST(COALESCE(s.qty,0)-COALESCE(s.qty_reserved,0),0)) > 0
            ORDER BY 1 LIMIT 4""",
        params)
    return [r[0] for r in cur.fetchall()]


def fmt_price(v):
    try:
        return f"{float(v):,.0f}".replace(",", " ") + " ₽"
    except Exception:
        return "—"


def _cat_icon(cat):
    c = (cat or "").lower()
    if "процесс" in c: return "💎"
    if "видео" in c: return "🎮"
    if "память" in c or "озу" in c: return "🧠"
    if "накоп" in c or "ssd" in c or "диск" in c: return "💾"
    if "матери" in c: return "🔌"
    if "питан" in c: return "⚡"
    if "охлажд" in c or "вентил" in c or "кулер" in c: return "❄️"
    if "корпус" in c: return "🗄"
    return "🔧"


# ─────────────────────────── ВЫВОД СПИСКОВ ТЕКСТОМ ───────────────────────────

def render_list(cur, chat_id, title, rows, has_more, source, offset):
    """Печатает нумерованный список товаров текстом и запоминает его в state_data,
    чтобы потом выбрать товар по номеру. source: ('search', query) или ('cat', name)."""
    lst = []
    lines = [title, ""]
    for i, (pid, name, price, avail) in enumerate(rows, start=1):
        lines.append(f"<b>{i}.</b> {name}\n    💰 {fmt_price(price)} · 📦 {int(avail)} шт")
        lst.append({"n": i, "id": pid, "name": name,
                    "price": float(price or 0), "avail": int(avail or 0)})
    lines.append("")
    lines.append("👉 Чтобы добавить в корзину — напиши <b>номер</b> товара.")
    lines.append("   Для нескольких штук: <code>2 x3</code> (товар 2, 3 шт).")

    inline = []
    nav = []
    if offset > 0:
        nav.append({"text": "◀️ Назад", "callback_data": f"more:{offset-PAGE_SIZE}"})
    if has_more:
        nav.append({"text": "Ещё ▶️", "callback_data": f"more:{offset+PAGE_SIZE}"})
    if nav:
        inline.append(nav)

    # сохраняем контекст списка для выбора по номеру и пагинации
    c = load_cart(cur, chat_id)
    sd = c["state_data"]
    sd["list"] = lst
    sd["src_type"] = source[0]
    sd["src_val"] = source[1]
    sd["offset"] = offset
    save_cart(cur, chat_id, state="browsing", state_data=sd)

    send(chat_id, "\n".join(lines), inline=inline if inline else None)
    if not inline:
        # подсветим главную клавиатуру отдельным лёгким сообщением не нужно —
        # reply-клавиатура остаётся видимой от предыдущих сообщений
        pass


def do_search(cur, chat_id, query, offset=0):
    rows, has_more = search_products(cur, query, offset)
    if not rows:
        cats = search_categories(cur, query)
        txt = f"🔍 По запросу «{query}» ничего не нашёл в наличии."
        if cats:
            txt += "\n\nПосмотри похожие разделы:\n" + "\n".join(f"• {c}" for c in cats)
            txt += "\n\nНажми 📂 Категории или напиши название раздела."
        send(chat_id, txt)
        return
    title = f"🔍 <b>Результаты по «{query}»</b>"
    render_list(cur, chat_id, title, rows, has_more, ("search", query), offset)


def do_category(cur, chat_id, category, offset=0):
    cur.execute(
        f"""SELECT g.product_id, g.name, g.price_retail,
                   COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.is_archived = FALSE AND g.product_id IS NOT NULL AND g.category = %s
            GROUP BY g.id, g.product_id, g.name, g.price_retail
            HAVING (COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0)) > 0
            ORDER BY g.name LIMIT %s OFFSET %s""",
        (category, PAGE_SIZE + 1, offset))
    rows = cur.fetchall()
    has_more = len(rows) > PAGE_SIZE
    rows = [r[:4] for r in rows[:PAGE_SIZE]]
    if not rows:
        render_categories(cur, chat_id)
        return
    title = f"{_cat_icon(category)} <b>{category}</b>"
    render_list(cur, chat_id, title, rows, has_more, ("cat", category), offset)


def render_categories(cur, chat_id):
    """Список категорий: текст + reply-кнопки с названиями категорий."""
    cur.execute(
        f"""SELECT category, COUNT(*) AS positions FROM (
                SELECT g.category, g.id,
                       COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
                FROM {SCHEMA}.warehouse_groups g
                LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
                WHERE g.is_archived = FALSE AND g.product_id IS NOT NULL AND g.category <> ''
                GROUP BY g.category, g.id
                HAVING (COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0)) > 0
            ) t
            GROUP BY category
            ORDER BY positions DESC""")
    cats = cur.fetchall()
    if not cats:
        send(chat_id, "Пока нет позиций в наличии.")
        return
    lines = ["📂 <b>Категории в наличии</b>", ""]
    for cat, positions in cats:
        lines.append(f"{_cat_icon(cat)} {cat} · {int(positions)} поз.")
    lines.append("")
    lines.append("👇 Выбери раздел кнопкой ниже.")

    # inline-кнопки из категорий (по 2 в ряд) + строка главного меню.
    # Названия категорий храним в state по индексу, т.к. callback_data ≤ 64 байт.
    cat_index = {}
    kb_rows, row = [], []
    for i, (cat, _) in enumerate(cats):
        cat_index[str(i)] = cat
        row.append({"text": f"{_cat_icon(cat)} {cat}", "callback_data": f"cat:{i}"})
        if len(row) == 2:
            kb_rows.append(row); row = []
    if row:
        kb_rows.append(row)
    kb_rows += MAIN_INLINE
    send(chat_id, "\n".join(lines), inline=kb_rows)

    # запомним соответствие индекс → название категории для callback'а
    c = load_cart(cur, chat_id)
    sd = c["state_data"]
    sd["cat_index"] = cat_index
    save_cart(cur, chat_id, state="idle", state_data=sd)


# ─────────────────────────── КОРЗИНА ───────────────────────────

def add_by_number(cur, chat_id, number, qty):
    c = load_cart(cur, chat_id)
    lst = c["state_data"].get("list") or []
    item = next((x for x in lst if x["n"] == number), None)
    if not item:
        send(chat_id, f"❌ В текущем списке нет товара №{number}. "
                      f"Открой список (Поиск/Категории) и выбери номер из него.")
        return
    # актуальный остаток
    cur.execute(
        f"""SELECT g.name, g.price_retail,
                   COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.product_id = %s AND g.is_archived = FALSE
            GROUP BY g.id, g.name, g.price_retail LIMIT 1""",
        (item["id"],))
    row = cur.fetchone()
    if not row:
        send(chat_id, "❌ Товар не найден.")
        return
    name, price, avail = row[0], float(row[1] or 0), int(row[2] or 0)
    items = c["items"]
    found = next((i for i in items if i["id"] == item["id"]), None)
    cur_qty = found["quantity"] if found else 0
    if cur_qty + qty > avail:
        send(chat_id, f"⚠️ В наличии только {avail} шт «{name}».")
        return
    if found:
        found["quantity"] += qty
    else:
        items.append({"id": item["id"], "name": name, "price": price,
                      "quantity": qty, "item_type": "product"})
    save_cart(cur, chat_id, items=items)
    total = sum(i["price"] * i["quantity"] for i in items)
    send(chat_id, f"✅ Добавлено: <b>{name}</b> ×{qty}\n"
                  f"🛒 В корзине: {sum(i['quantity'] for i in items)} шт на {fmt_price(total)}\n\n"
                  f"Добавь ещё номер из списка или открой 🛒 Корзина.")


def render_cart(cur, chat_id):
    c = load_cart(cur, chat_id)
    items = c["items"]
    if not items:
        send(chat_id, "🛒 Корзина пуста.\nНайди железо через 📂 Категории или 🔍 Поиск.")
        return
    lines, total = ["🛒 <b>Корзина</b>", ""], 0
    for i, it in enumerate(items, start=1):
        sub = it["price"] * it["quantity"]
        total += sub
        lines.append(f"{i}. {it['name']}\n    {it['quantity']} × {fmt_price(it['price'])} = {fmt_price(sub)}")
    lines.append("")
    lines.append(f"<b>Итого: {fmt_price(total)}</b>")
    inline = [
        [{"text": "✅ Оформить заказ", "callback_data": "checkout"}],
        [{"text": "🗑 Очистить корзину", "callback_data": "clear"}],
    ]
    send(chat_id, "\n".join(lines), inline=inline)


def menu(cur, chat_id, greeting=False):
    mgr = is_manager(cur, chat_id)
    role = "менеджер" if mgr else "клиент"
    text = ("👋 <b>Склад BeGraphics</b>\n" if greeting else "🏠 <b>Меню</b>\n")
    text += (f"Режим: {role}\n\n"
             "📂 Категории — наличие по разделам\n"
             "🔍 Поиск — найти железо по названию\n"
             "🛒 Корзина — оформить заказ\n\n"
             "Пользуйся кнопками под сообщением 👇")
    send(chat_id, text)


# ─────────────────────────── ОФОРМЛЕНИЕ ЗАКАЗА ───────────────────────────

def gen_display_number(cur, order_id):
    # Сквозная нумерация: номер = внутренний id, заказы из бота — всегда HW
    return "HW" + str(order_id).zfill(5)


def create_order(cur, chat_id, name, phone, username):
    c = load_cart(cur, chat_id)
    items = c["items"]
    if not items:
        return None, "Корзина пуста."
    total = sum(i["price"] * i["quantity"] for i in items)
    mgr = is_manager(cur, chat_id)
    contact = f"tg:https://t.me/{username}" if username else None
    comment = "Заказ из Telegram-бота" + (" (менеджер)" if mgr else "")
    cur.execute(
        f"""INSERT INTO {SCHEMA}.orders (customer_name, customer_phone, customer_email,
            order_type, items, total, comment, status, created_at, updated_at)
            VALUES (%s,%s,%s,'parts',%s,%s,%s,'new',NOW(),NOW()) RETURNING id""",
        (name, phone, contact, json.dumps(items), total, comment))
    order_id = cur.fetchone()[0]
    display_number = gen_display_number(cur, order_id)
    cur.execute(f"UPDATE {SCHEMA}.orders SET display_number=%s WHERE id=%s",
                (display_number, order_id))

    # Резерв НЕ ставим при создании заказа из бота — только после подтверждения
    # предоплаты менеджером (finance: confirm_prepayment -> reserve_parts_order).

    try:
        from tg_notify import notify_managers
        tag = f"\nTelegram: <a href=\"https://t.me/{username}\">@{username}</a>" if username else ""
        notify_managers(
            f"🛒 <b>Новый заказ {display_number}</b> (из бота)\n"
            f"Тип: Железо\nКлиент: {name}\nТелефон: {phone}{tag}\n"
            f"Сумма: {fmt_price(total)}", event_key="bot_order")
    except Exception as e:
        print(f"TG_BOT notify: {e}")

    save_cart(cur, chat_id, state="idle", state_data={}, items=[])
    return display_number, None


# ─────────────────────────── РАЗБОР ВВОДА ───────────────────────────

def parse_pick(text):
    """«2» -> (2,1); «2 x3» / «2*3» / «2 3» -> (2,3). Иначе None."""
    t = text.lower().replace("х", "x").replace("*", " ").replace("x", " ")
    parts = t.split()
    if not parts:
        return None
    if not parts[0].isdigit():
        return None
    num = int(parts[0])
    qty = 1
    if len(parts) >= 2 and parts[1].isdigit():
        qty = max(1, int(parts[1]))
    return num, qty


# ─────────────────────────── ОБРАБОТКА UPDATE ───────────────────────────

# Чат, из которого разрешено заводить задачи командой «+задача».
# Пустой список = разрешено везде.
TASK_CHATS = {"-1002809968150"}


def _handle_add_task(cur, chat_id, text, msg):
    """«+задача [дата] текст» — создаёт задачу в календаре на дату.

    Дата необязательна: без неё — на сегодня. Понимает 20.08, 20.08.2026,
    «завтра». Задача попадает в утреннюю сводку календаря.
    """
    if TASK_CHATS and str(chat_id) not in TASK_CHATS:
        return
    body = text.split(None, 1)[1].strip() if len(text.split(None, 1)) > 1 else ""
    if not body:
        # Голый «/task» без текста. Telegram отправляет команду сразу по тапу
        # в подсказке — дописать текст пользователь не успевает. Поэтому
        # отвечаем с force_reply: у человека открывается поле ответа, он пишет
        # задачу обычным сообщением. ВАЖНО: ответы на сообщения бота приходят
        # ему даже при ВКЛЮЧЁННОМ режиме приватности — это и делает сценарий
        # рабочим в группе без отключения privacy mode у @BotFather.
        tg_call("sendMessage", {
            "chat_id": chat_id,
            "text": ("📝 <b>Что за задача?</b>\n"
                     "Напишите ответом на это сообщение.\n\n"
                     "Можно с датой в начале:\n"
                     "<code>завтра Забрать корпуса</code>\n"
                     "<code>20.08 Отвезти ПК клиенту</code>"),
            "parse_mode": "HTML",
            "reply_markup": {"force_reply": True,
                             "input_field_placeholder": "Текст задачи"},
        })
        return

    from datetime import date

    # Разбор «[дата] текст» вынесен в _parse_task_text — одна точка правды
    # для команды с текстом и для ответа на force_reply.
    day, body, errmsg = _parse_task_text(body)
    if errmsg:
        send(chat_id, f"{errmsg}. Пример: <code>/task 20.08 Отвезти ПК клиенту</code>",
             reply_kb=False)
        return

    # Первая строка — заголовок, остальное — описание.
    parts = body.split("\n", 1)
    title = parts[0].strip()[:255]
    descr = parts[1].strip() if len(parts) > 1 else None
    frm = msg.get("from") or {}
    uname = frm.get("username")
    author = f"@{uname}" if uname else (frm.get("first_name") or "")
    if author:
        descr = ((descr + "\n") if descr else "") + f"Добавил: {author}"

    def q(v):
        return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"

    cur.execute(
        f"INSERT INTO {SCHEMA}.calendar_events "
        f"(event_date, title, description, kind, status, origin_date) "
        f"VALUES ({q(day.isoformat())}, {q(title)}, {q(descr)}, 'task', 'new', "
        f"{q(day.isoformat())}) RETURNING id"
    )
    row = cur.fetchone()
    task_id = row[0] if row else None
    when = "сегодня" if day == date.today() else day.strftime("%d.%m.%Y")
    base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
    link = f"\n🔗 <a href=\"{base}/admin/calendar\">Открыть календарь</a>" if base else ""
    send(chat_id, f"✅ Задача добавлена на <b>{when}</b>\n📋 {title}"
                  f"{f' (#{task_id})' if task_id else ''}{link}", reply_kb=False)


def _parse_task_text(body):
    """Разбирает «[дата] текст» → (дата, текст, ошибка).

    Единая точка разбора для команды /task и для инлайн-режима, чтобы
    подсказка в инлайне и реально созданная задача не разъезжались.
    """
    from datetime import date, timedelta
    import re as _re

    day = date.today()
    body = (body or "").strip()
    low = body.lower()
    if low.startswith("сегодня "):
        body = body[8:].strip()
    elif low.startswith("завтра "):
        day = day + timedelta(days=1)
        body = body[7:].strip()
    elif low.startswith("послезавтра "):
        day = day + timedelta(days=2)
        body = body[12:].strip()
    else:
        m = _re.match(r"^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?\s+(.+)$", body, _re.S)
        if m:
            d, mo, y, rest = m.group(1), m.group(2), m.group(3), m.group(4)
            year = day.year if not y else (int(y) + 2000 if len(y) == 2 else int(y))
            try:
                day = date(year, int(mo), int(d))
                body = rest.strip()
            except ValueError:
                return None, None, "Неверная дата"
    if not body:
        return None, None, "Нужен текст задачи"
    return day, body, None


def handle_message(cur, msg):
    chat_id = msg["chat"]["id"]
    chat_type = msg["chat"].get("type", "private")
    text = (msg.get("text") or "").strip()
    username = msg["chat"].get("username", "")

    # Диагностика: узнать chat_id текущего чата (для настройки рабочего чата).
    # Работает в любом чате, в т.ч. в группах уведомлений.
    if text.startswith("/chatid") or text.startswith("/id"):
        send(chat_id, f"ID этого чата: <code>{chat_id}</code>", reply_kb=False)
        return

    # Добавление задачи в календарь прямо из рабочего чата:
    #   /task Позвонить поставщику     ← ОСНОВНОЙ способ в группах
    #   +задача 20.08 Забрать корпуса  ← работает в личке; в группе только
    #                                    если у @BotFather выключен privacy mode
    # Задача попадёт в утреннюю сводку (schedule action=morning_ping).
    # Проверяем ДО отсечки приватных чатов — команда нужна именно в группе.
    #
    # ВАЖНО про группы: при включённом режиме приватности (по умолчанию у
    # @BotFather) Telegram НЕ показывает боту обычные сообщения группы —
    # «+задача ...» до него просто не долетает. Зато команды со слэшем
    # доходят всегда, поэтому основной вариант — /task (и /задача).
    # Учитываем /task@BeGraphicsPC_Bot — в группах клиент дописывает имя бота.
    _low = text.lower()
    _cmd = _low.split()[0].split("@")[0] if _low else ""
    if _cmd in ("/task", "/задача", "/zadacha") or _low.startswith(("+задача", "+task")):
        _handle_add_task(cur, chat_id, text, msg)
        return

    # Ответ на приглашение «Что за задача?» (force_reply). Такой reply Telegram
    # отдаёт боту даже при включённом privacy mode, поэтому в группе это
    # основной рабочий сценарий: тап по /task → пишем текст ответом.
    _rt = ((msg.get("reply_to_message") or {}).get("text") or "")
    if text and "Что за задача?" in _rt:
        _handle_add_task(cur, chat_id, "/task " + text, msg)
        return

    # МАГАЗИН-БОТ РАБОТАЕТ ТОЛЬКО В ЛИЧНЫХ ЧАТАХ. В группах/каналах
    # (чаты уведомлений) бот НЕ отвечает и НЕ показывает инлайн-меню —
    # только шлёт уведомления через notify_managers/notify_tasks.
    if chat_type != "private":
        return

    c = load_cart(cur, chat_id)
    state = c["state"]
    sd = c["state_data"]

    # Команды и кнопки главного меню — работают всегда
    if text in ("/start", "/menu", "🏠 Меню"):
        save_cart(cur, chat_id, state="idle", state_data={})
        # Разово убираем старую залипшую reply-клавиатуру у поля ввода
        remove_reply_kb(chat_id)
        menu(cur, chat_id, greeting=(text == "/start"))
        return

    if text == "📂 Категории":
        render_categories(cur, chat_id)
        return

    if text == "🔍 Поиск":
        save_cart(cur, chat_id, state="await_search")
        send(chat_id, "🔍 Напиши, что ищешь:\nнапример <i>RTX 4070</i>, <i>проц 7600</i>, <i>видяха</i>")
        return

    if text == "🛒 Корзина":
        render_cart(cur, chat_id)
        return

    # Нажата reply-кнопка категории?
    cat_buttons = sd.get("cat_buttons") or {}
    if text in cat_buttons:
        do_category(cur, chat_id, cat_buttons[text], 0)
        return

    # Ввод имени/телефона при оформлении
    if state == "await_name":
        sd["name"] = text
        save_cart(cur, chat_id, state="await_phone", state_data=sd)
        send(chat_id, "📱 Укажи телефон для связи:")
        return

    if state == "await_phone":
        display_number, err = create_order(cur, chat_id, sd.get("name", "Клиент"), text, username)
        if err:
            send(chat_id, f"❌ {err}")
        else:
            send(chat_id, f"✅ Заказ <b>{display_number}</b> создан!\nМенеджер свяжется с тобой.")
        return

    # Поиск
    if state == "await_search":
        do_search(cur, chat_id, text, 0)
        return

    # Просмотр списка: выбор товара по номеру
    if state == "browsing":
        pick = parse_pick(text)
        if pick:
            add_by_number(cur, chat_id, pick[0], pick[1])
            return
        # иначе считаем это новым поисковым запросом
        do_search(cur, chat_id, text, 0)
        return

    # По умолчанию — пробуем как поиск, если похоже на запрос; иначе меню
    if len(text) >= 2 and not text.startswith("/"):
        do_search(cur, chat_id, text, 0)
    else:
        menu(cur, chat_id)


def handle_callback(cur, cb):
    chat_id = cb["message"]["chat"]["id"]
    chat_type = cb["message"]["chat"].get("type", "private")
    data = cb.get("data", "")
    # В группах/каналах (чаты уведомлений) бот не реагирует на кнопки
    if chat_type != "private":
        return
    tg_call("answerCallbackQuery", {"callback_query_id": cb["id"]})

    # ── Главное меню (inline) ──
    if data == "menu:home":
        save_cart(cur, chat_id, state="idle", state_data={})
        menu(cur, chat_id)
        return
    if data == "menu:categories":
        render_categories(cur, chat_id)
        return
    if data == "menu:search":
        save_cart(cur, chat_id, state="await_search")
        send(chat_id, "🔍 Напиши, что ищешь:\nнапример <i>RTX 4070</i>, <i>проц 7600</i>, <i>видяха</i>")
        return
    if data == "menu:cart":
        render_cart(cur, chat_id)
        return

    # ── Выбор категории по индексу ──
    if data.startswith("cat:"):
        idx = data.split(":", 1)[1]
        c = load_cart(cur, chat_id)
        cat_index = c["state_data"].get("cat_index") or {}
        cat = cat_index.get(idx)
        if cat:
            do_category(cur, chat_id, cat, 0)
        else:
            render_categories(cur, chat_id)
        return

    if data.startswith("more:"):
        offset = int(data.split(":", 1)[1])
        c = load_cart(cur, chat_id)
        sd = c["state_data"]
        if sd.get("src_type") == "search":
            do_search(cur, chat_id, sd.get("src_val", ""), offset)
        elif sd.get("src_type") == "cat":
            do_category(cur, chat_id, sd.get("src_val", ""), offset)
    elif data == "checkout":
        c = load_cart(cur, chat_id)
        if not c["items"]:
            render_cart(cur, chat_id)
            return
        save_cart(cur, chat_id, state="await_name", state_data=c["state_data"])
        send(chat_id, "📝 Оформление заказа.\nКак тебя зовут?")
    elif data == "clear":
        save_cart(cur, chat_id, items=[])
        send(chat_id, "🗑 Корзина очищена.")


ADMIN_ACTIONS = {
    "tg_overview", "tg_chats", "tg_chat_save", "tg_chat_delete",
    "tg_routes", "tg_route_save", "tg_log", "tg_log_clear",
    "tg_test", "tg_chat_detect",
}


def _is_admin(event) -> bool:
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    key = os.environ.get("ADMIN_KEY") or ""
    return bool(key) and headers.get("x-admin-token") == key


def _handle_admin(action, event, params, body):
    """Вкладка «Telegram-бот» в админке: чаты, события, журнал, тест."""
    import admin_api as aa
    conn = get_conn(); cur = conn.cursor()
    try:
        if action == "tg_overview":
            aa.seed_chats_from_env(cur, conn, SCHEMA)
            return _ok({
                "stats": aa.stats(cur, SCHEMA),
                "chats": aa.list_chats(cur, SCHEMA),
                "routes": aa.list_routes(cur, SCHEMA),
                "defaults": aa.env_defaults(),
                "webhook": (tg_call("getWebhookInfo", {}) or {}).get("result"),
            })
        if action == "tg_chats":
            return _ok({"chats": aa.list_chats(cur, SCHEMA)})
        if action == "tg_chat_save":
            data, code = aa.save_chat(cur, conn, SCHEMA, body)
            return _ok(data, code)
        if action == "tg_chat_delete":
            data, code = aa.delete_chat(cur, conn, SCHEMA, body)
            return _ok(data, code)
        if action == "tg_routes":
            return _ok({"routes": aa.list_routes(cur, SCHEMA)})
        if action == "tg_route_save":
            data, code = aa.save_route(cur, conn, SCHEMA, body)
            return _ok(data, code)
        if action == "tg_log":
            return _ok({"log": aa.list_log(cur, SCHEMA, params)})
        if action == "tg_log_clear":
            data, code = aa.clear_log(cur, conn, SCHEMA)
            return _ok(data, code)
        if action == "tg_chat_detect":
            # Подтянуть название чата из Telegram по chat_id
            cid = (body.get("chat_id") or params.get("chat_id") or "").strip()
            if not cid:
                return _ok({"error": "chat_id обязателен"}, 400)
            res = tg_call("getChat", {"chat_id": cid}) or {}
            r = res.get("result") or {}
            if not r:
                return _ok({"ok": False, "error": "Чат не найден. Добавь бота в чат."}, 200)
            return _ok({"ok": True, "title": r.get("title") or r.get("username") or str(cid),
                        "kind": r.get("type") or "group"})
        if action == "tg_test":
            # Тест шлём ТОЛЬКО в явно выбранный чат
            cid = str(body.get("chat_id") or "").strip()
            if not cid:
                return _ok({"error": "Выбери чат для теста"}, 400)
            thread = body.get("thread_id")
            payload = {"chat_id": cid, "parse_mode": "HTML",
                       "text": "🔔 <b>Проверка связи</b>\nСообщение отправлено из админки."}
            if str(thread or "").strip().lstrip("-").isdigit():
                payload["message_thread_id"] = int(thread)
            res = tg_call("sendMessage", payload)
            ok = bool(res and res.get("ok"))
            log_send(cur, conn, "manual_test", cid, ok,
                     None if ok else "Telegram не принял сообщение", "Проверка связи")
            return _ok({"sent": ok})
        return _ok({"error": "unknown action"}, 400)
    finally:
        cur.close(); conn.close()


def _ok(data, code=200):
    return {"statusCode": code, "headers": _cors(), "body": json.dumps(data, ensure_ascii=False)}


def log_send(cur, conn, event_key, chat_id, ok, error=None, preview=None, ms=None):
    """Записать факт отправки в журнал админки."""
    try:
        def q(v):
            return "NULL" if v is None else "'" + str(v)[:300].replace("'", "''") + "'"
        cid = str(chat_id).strip()
        cid_sql = cid if cid.lstrip("-").isdigit() else "NULL"
        cur.execute(
            f"""INSERT INTO {SCHEMA}.tg_send_log
                (event_key, chat_id, status, error, preview, duration_ms)
                VALUES ({q(event_key)}, {cid_sql}, '{'ok' if ok else 'error'}',
                        {q(error)}, {q(preview)}, {int(ms) if ms else 'NULL'})""")
        conn.commit()
    except Exception as e:
        print(f"TG_BOT log_send: {e}")


def handler(event: dict, context) -> dict:
    """Webhook Telegram-бота склада: поиск железа, корзина, заказы.
    Плюс админский API вкладки «Telegram-бот» (action=tg_*)."""
    method = event.get("httpMethod", "POST")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": _cors(), "body": ""}

    params = event.get("queryStringParameters") or {}
    action_any = params.get("action")
    body_any = {}
    if method == "POST":
        try:
            body_any = json.loads(event.get("body") or "{}")
        except Exception:
            body_any = {}
        action_any = body_any.get("action") or action_any
    if action_any in ADMIN_ACTIONS:
        if not _is_admin(event):
            return _ok({"error": "forbidden"}, 403)
        return _handle_admin(action_any, event, params, body_any)

    if method == "GET":
        action = params.get("action")
        if action == "set_webhook":
            res = tg_call("setWebhook", {
                "url": SELF_URL,
                "allowed_updates": ["message", "callback_query"],
                "drop_pending_updates": True,
            })
            return {"statusCode": 200, "headers": _cors(),
                    "body": json.dumps({"ok": True, "result": res})}
        if action == "webhook_info":
            res = tg_call("getWebhookInfo", {})
            return {"statusCode": 200, "headers": _cors(),
                    "body": json.dumps({"ok": True, "result": res})}
        if action == "chat_diag":
            # Проверка КОНКРЕТНОГО чата: getChat отдаёт тип и название, если бот
            # действительно в этом чате. Нужно, чтобы отличить "бот не добавлен"
            # от "ID записан неверно" — по тексту "chat not found" это неразличимо.
            cid = (params.get("chat_id") or "").strip()
            if not cid:
                return _ok({"error": "chat_id required"}, 400)
            info = tg_call("getChat", {"chat_id": cid})
            me = tg_call("getMe", {})
            mr = (me or {}).get("result", {}) or {}
            # can_read_all_group_messages=False (режим приватности ВКЛючён у
            # @BotFather) означает: в группе бот видит только команды со слэшем
            # и ответы на свои сообщения. Обычный текст «+задача ...» до него
            # НЕ доходит — это ключевая причина «команда не работает в группе».
            member = None
            if mr.get("id"):
                member = tg_call("getChatMember", {"chat_id": cid, "user_id": mr["id"]})
            return _ok({"chat_id": cid, "getChat": info,
                        "bot": mr.get("username"),
                        "privacy_mode_on": not mr.get("can_read_all_group_messages", False),
                        "can_read_all_group_messages": mr.get("can_read_all_group_messages"),
                        "member": (member or {}).get("result")})
        if action == "net_diag":
            # Диагностика сетевой связности с Telegram: отдельно DNS и отдельно
            # TCP+TLS по каждому адресу. Нужна, чтобы отличить "нет DNS" от
            # "нет маршрута/блокировка" — по логам это неразличимо.
            diag = {"token_set": bool(os.environ.get("TELEGRAM_BOT_TOKEN"))}
            try:
                infos = _getaddrinfo_orig("api.telegram.org", 443, 0, socket.SOCK_STREAM)
                diag["dns"] = [
                    {"family": "IPv4" if i[0] == socket.AF_INET else "IPv6", "addr": i[4][0]}
                    for i in infos
                ]
            except Exception as e:
                diag["dns_error"] = f"{type(e).__name__}: {e}"
                infos = []
            probes = []
            for i in infos:
                fam, addr = i[0], i[4]
                t0 = time.time()
                s = socket.socket(fam, socket.SOCK_STREAM)
                s.settimeout(3.0)
                try:
                    s.connect(addr)
                    probes.append({"addr": addr[0], "tcp": "ok",
                                   "ms": int((time.time() - t0) * 1000)})
                except Exception as e:
                    probes.append({"addr": addr[0], "tcp": f"{type(e).__name__}: {e}",
                                   "ms": int((time.time() - t0) * 1000)})
                finally:
                    try:
                        s.close()
                    except Exception:
                        pass
            diag["tcp_probes"] = probes
            # Контрольные хосты: отличаем "закрыт весь исходящий трафик" от
            # "недоступен именно Telegram", и проверяем другие IP Telegram
            # (у api.telegram.org несколько DC: 149.154.167.220 и др.).
            controls = []
            for host, ip, port in (
                ("google.com", None, 443),
                ("functions.poehali.dev", None, 443),
                ("telegram-dc4", "149.154.167.220", 443),
                ("telegram-dc5", "91.108.56.130", 443),
            ):
                t0 = time.time()
                try:
                    if ip is None:
                        ip = _getaddrinfo_orig(host, port, socket.AF_INET,
                                               socket.SOCK_STREAM)[0][4][0]
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(3.0)
                    s.connect((ip, port))
                    s.close()
                    controls.append({"host": host, "ip": ip, "tcp": "ok",
                                     "ms": int((time.time() - t0) * 1000)})
                except Exception as e:
                    controls.append({"host": host, "ip": ip,
                                     "tcp": f"{type(e).__name__}: {e}",
                                     "ms": int((time.time() - t0) * 1000)})
            diag["control_probes"] = controls
            return {"statusCode": 200, "headers": _cors(),
                    "body": json.dumps({"ok": True, "diag": diag}, ensure_ascii=False)}
        if action == "test_notify":
            # Раньше этот GET слал сообщение в рабочий чат без подтверждения.
            # Теперь тест — только из админки, с явным выбором чата (tg_test).
            return {"statusCode": 410, "headers": _cors(), "body": json.dumps(
                {"error": "Тест доступен в админке: вкладка «Telegram-бот» — "
                          "там выбирается конкретный чат"}, ensure_ascii=False)}
        if action == "resend_last":
            from tg_notify import notify_managers
            conn = get_conn(); cur = conn.cursor()
            cur.execute(
                f"""SELECT display_number, customer_name, customer_phone,
                           customer_email, total
                    FROM {SCHEMA}.orders WHERE order_type='parts'
                    ORDER BY created_at DESC LIMIT 1""")
            row = cur.fetchone()
            cur.close(); conn.close()
            if not row:
                return {"statusCode": 200, "headers": _cors(),
                        "body": json.dumps({"sent": False, "reason": "no orders"})}
            dn, name, phone, email, total = row
            uname = ""
            if email and email.startswith("tg:https://t.me/"):
                uname = email.rsplit("/", 1)[-1]
            tag = f"\nTelegram: <a href=\"https://t.me/{uname}\">@{uname}</a>" if uname else ""
            ok = notify_managers(
                f"🛒 <b>Заявка {dn}</b> (повтор)\n"
                f"Тип: Железо\nКлиент: {name}\nТелефон: {phone}{tag}\n"
                f"Сумма: {fmt_price(total)}")
            return {"statusCode": 200, "headers": _cors(),
                    "body": json.dumps({"sent": ok, "order": dn})}
        try:
            conn = get_conn(); cur = conn.cursor()
            cur.execute(f"DELETE FROM {SCHEMA}.tg_bot_carts WHERE chat_id >= 100000000 AND chat_id < 200000000")
            conn.commit(); cur.close(); conn.close()
        except Exception as e:
            print(f"TG_BOT cleanup: {e}")
        return {"statusCode": 200, "headers": _cors(), "body": json.dumps({"ok": True, "service": "tg-bot"})}

    conn = get_conn()
    cur = conn.cursor()
    try:
        update = json.loads(event.get("body") or "{}")
        if "message" in update and update["message"].get("text"):
            handle_message(cur, update["message"])
        elif "callback_query" in update:
            handle_callback(cur, update["callback_query"])
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"TG_BOT handler: {e}")
    finally:
        cur.close()
        conn.close()
    return {"statusCode": 200, "headers": _cors(), "body": json.dumps({"ok": True})}


def _cors():
    return {"Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
            "Content-Type": "application/json"}