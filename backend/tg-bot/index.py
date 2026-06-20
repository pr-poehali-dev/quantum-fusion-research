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
import urllib.request
import urllib.parse
import urllib.error
import psycopg2

SCHEMA = "t_p72635010_quantum_fusion_resea"
TG_API = "https://api.telegram.org/bot{token}/{method}"
SELF_URL = "https://functions.poehali.dev/6cf7e69d-a5f1-45db-b94e-43f37dd16961"
PAGE_SIZE = 10

# Постоянная reply-клавиатура (кнопки у поля ввода)
MAIN_KB = {
    "keyboard": [
        [{"text": "📂 Категории"}, {"text": "🔍 Поиск"}],
        [{"text": "🛒 Корзина"}, {"text": "🏠 Меню"}],
    ],
    "resize_keyboard": True,
    "is_persistent": True,
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def tg_call(method: str, payload: dict):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("TG_BOT: нет TELEGRAM_BOT_TOKEN")
        return None
    url = TG_API.format(token=token, method=method)
    data = json.dumps(payload).encode()
    last_err = None
    for _ in range(2):  # 1 ретрай на случай сетевого подвисания
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode()
            except Exception:
                pass
            print(f"TG_BOT {method}: HTTP {e.code} {body}")
            return None
        except Exception as e:
            last_err = e
    print(f"TG_BOT {method}: {last_err}")
    return None


def send(chat_id, text, reply_kb=True, inline=None):
    """Отправить НОВОЕ сообщение. По умолчанию с главной reply-клавиатурой."""
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
               "disable_web_page_preview": True}
    if inline is not None:
        payload["reply_markup"] = {"inline_keyboard": inline}
    elif reply_kb:
        payload["reply_markup"] = MAIN_KB
    return tg_call("sendMessage", payload)


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


def _run_search(cur, words, offset, limit):
    if not words:
        return [], False
    conds, params = [], []
    for w in words:
        conds.append("(LOWER(g.name) LIKE %s OR LOWER(g.category) LIKE %s)")
        params += [f"%{w}%", f"%{w}%"]
    where = " AND ".join(conds)
    rank_word = words[0]
    sql = f"""
        SELECT g.product_id, g.name, g.price_retail,
               COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
        FROM {SCHEMA}.warehouse_groups g
        LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
        WHERE g.is_archived = FALSE AND g.product_id IS NOT NULL AND {where}
        GROUP BY g.id, g.product_id, g.name, g.price_retail
        HAVING (COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0)) > 0
        ORDER BY (CASE WHEN POSITION(%s IN LOWER(g.name)) = 0 THEN 9999
                       ELSE POSITION(%s IN LOWER(g.name)) END), g.name
        LIMIT %s OFFSET %s"""
    cur.execute(sql, params + [rank_word, rank_word, limit + 1, offset])
    rows = cur.fetchall()
    has_more = len(rows) > limit
    return [r[:4] for r in rows[:limit]], has_more


def search_products(cur, query, offset=0):
    for words in normalize_query(query):
        rows, has_more = _run_search(cur, words, offset, PAGE_SIZE)
        if rows:
            return rows, has_more
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

    # reply-клавиатура из категорий + назад к главному меню
    kb_rows = []
    row = []
    for cat, _ in cats:
        row.append({"text": f"{_cat_icon(cat)} {cat}"})
        if len(row) == 2:
            kb_rows.append(row); row = []
    if row:
        kb_rows.append(row)
    kb_rows.append([{"text": "🏠 Меню"}])
    payload = {"chat_id": chat_id, "text": "\n".join(lines), "parse_mode": "HTML",
               "reply_markup": {"keyboard": kb_rows, "resize_keyboard": True, "is_persistent": True}}
    tg_call("sendMessage", payload)

    # запомним точные названия категорий, чтобы распознать нажатие reply-кнопки
    c = load_cart(cur, chat_id)
    sd = c["state_data"]
    sd["cat_buttons"] = {f"{_cat_icon(cat)} {cat}": cat for cat, _ in cats}
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
             "Пользуйся кнопками ниже 👇")
    send(chat_id, text)


# ─────────────────────────── ОФОРМЛЕНИЕ ЗАКАЗА ───────────────────────────

def gen_display_number(cur):
    cur.execute(
        "SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(display_number, '\\D', '', 'g'), '') AS INTEGER)), 0) "
        f"FROM {SCHEMA}.orders WHERE display_number LIKE %s", ("HW%",))
    return "HW" + str((cur.fetchone()[0] or 0) + 1).zfill(5)


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
    display_number = gen_display_number(cur)
    cur.execute(f"UPDATE {SCHEMA}.orders SET display_number=%s WHERE id=%s",
                (display_number, order_id))

    try:
        import warehouse_core as wc
        reserve_lines = [{"product_id": int(it["id"]), "qty": int(it["quantity"]), "slot": "product"}
                         for it in items if it.get("id")]
        if reserve_lines:
            wc.handle_reserve_and_purchase(cur, order_id, reserve_lines)
    except Exception as e:
        print(f"TG_BOT reserve: {e}")

    try:
        from tg_notify import notify_managers
        tag = f"\nTelegram: <a href=\"https://t.me/{username}\">@{username}</a>" if username else ""
        notify_managers(
            f"🛒 <b>Новый заказ {display_number}</b> (из бота)\n"
            f"Тип: Железо\nКлиент: {name}\nТелефон: {phone}{tag}\n"
            f"Сумма: {fmt_price(total)}")
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

def handle_message(cur, msg):
    chat_id = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    username = msg["chat"].get("username", "")
    c = load_cart(cur, chat_id)
    state = c["state"]
    sd = c["state_data"]

    # Команды и кнопки главного меню — работают всегда
    if text in ("/start", "/menu", "🏠 Меню"):
        save_cart(cur, chat_id, state="idle", state_data={})
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
    data = cb.get("data", "")
    tg_call("answerCallbackQuery", {"callback_query_id": cb["id"]})

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


def handler(event: dict, context) -> dict:
    """Webhook Telegram-бота склада: поиск железа, корзина, заказы."""
    method = event.get("httpMethod", "POST")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": _cors(), "body": ""}
    if method == "GET":
        params = event.get("queryStringParameters") or {}
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
            "Access-Control-Allow-Headers": "Content-Type",
            "Content-Type": "application/json"}