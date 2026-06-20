"""Telegram-бот склада BeGraphics.

Возможности:
- /start — меню (навигация редактирует одно сообщение, без спама)
- 📂 Категории — просмотр наличия по разделам (динамически из warehouse_groups)
- 🔍 Интеллектуальный поиск: синонимы (видяха→видеокарта, проц→процессор...),
  фикс раскладки, многословный AND-поиск, ранжирование, подсказка категорий
- 🛒 Корзина: добавление позиций с количеством, оформление заказа
- Создание заказа железа (order_type=parts) с авторезервом через warehouse_core

Доступ: поиск — всем; оформление заказа доступно всем (клиентам — как клиентский
заказ, менеджерам из tg_bot_managers — помечается «менеджер»).

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
PAGE_SIZE = 8


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
    for attempt in range(2):  # 1 ретрай на случай сетевого подвисания
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
            return None  # 400/403 ретраить бесполезно
        except Exception as e:
            last_err = e
    print(f"TG_BOT {method}: {last_err}")
    return None


def send(chat_id, text, keyboard=None, remove_reply_kb=False):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
               "disable_web_page_preview": True}
    if keyboard is not None:
        payload["reply_markup"] = {"inline_keyboard": keyboard}
    elif remove_reply_kb:
        payload["reply_markup"] = {"remove_keyboard": True}
    return tg_call("sendMessage", payload)


def show(chat_id, text, keyboard=None, message_id=None):
    """Показать экран: если задан message_id — редактируем сообщение,
    иначе отправляем новое. Делает навигацию «в одном окне»."""
    if message_id is not None:
        payload = {"chat_id": chat_id, "message_id": message_id, "text": text,
                   "parse_mode": "HTML", "disable_web_page_preview": True}
        if keyboard is not None:
            payload["reply_markup"] = {"inline_keyboard": keyboard}
        res = tg_call("editMessageText", payload)
        if res is not None:
            return res
        # не вышло отредактировать (напр. сообщение слишком старое) — шлём новое
    return send(chat_id, text, keyboard)


def answer_cb(cb_id, text=None):
    payload = {"callback_query_id": cb_id}
    if text:
        payload["text"] = text
    tg_call("answerCallbackQuery", payload)


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

# Раскладка: если человек печатает русскими буквами в англ. раскладке и наоборот
_LAYOUT_RU2EN = str.maketrans(
    "йцукенгшщзхъфывапролджэячсмитьбю",
    "qwertyuiop[]asdfghjkl;'zxcvbnm,.")
_LAYOUT_EN2RU = str.maketrans(
    "qwertyuiop[]asdfghjkl;'zxcvbnm,.",
    "йцукенгшщзхъфывапролджэячсмитьбю")

# Синонимы/сокращения → к каноничным словам поиска
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
    "бп": "блок питания", "psu": "блок питания", "питalik": "блок питания",
    "кулер": "охлаждение", "куллер": "охлаждение", "вентилятор": "охлаждение",
    "корпус": "корпус", "кейс": "корпус", "case": "корпус",
}


def normalize_query(q):
    """Возвращает список вариантов нормализованного запроса (слова)."""
    q = (q or "").lower().strip()
    variants = set()

    def words_of(s):
        toks = []
        for w in s.replace(",", " ").split():
            w = w.strip(".,!?;:()[]\"'")
            if not w:
                continue
            toks.append(SYNONYMS.get(w, w))
        # синоним может быть из двух слов — разворачиваем
        out = []
        for t in toks:
            out.extend(t.split())
        return out

    variants.add(tuple(words_of(q)))
    # попытка исправить раскладку
    variants.add(tuple(words_of(q.translate(_LAYOUT_EN2RU))))
    variants.add(tuple(words_of(q.translate(_LAYOUT_RU2EN))))
    # убираем пустые
    return [list(v) for v in variants if v]


def _run_search(cur, words, offset, limit):
    """AND-поиск: каждое слово должно встречаться в названии или категории.
    Ранжирование: сначала те, где запрос ближе к началу названия."""
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
               COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail,
               POSITION(%s IN LOWER(g.name)) AS pos
        FROM {SCHEMA}.warehouse_groups g
        LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
        WHERE g.is_archived = FALSE AND g.product_id IS NOT NULL AND {where}
        GROUP BY g.id, g.product_id, g.name, g.price_retail
        HAVING (COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0)) > 0
        ORDER BY (CASE WHEN POSITION(%s IN LOWER(g.name)) = 0 THEN 9999
                       ELSE POSITION(%s IN LOWER(g.name)) END), g.name
        LIMIT %s OFFSET %s"""
    cur.execute(sql, [rank_word] + params + [rank_word, rank_word, limit + 1, offset])
    rows = cur.fetchall()
    has_more = len(rows) > limit
    return [r[:4] for r in rows[:limit]], has_more


def search_products(cur, query, offset=0):
    """Умный поиск: пробуем варианты нормализации, берём первый непустой.
    Если по всем словам пусто — пробуем по самому длинному слову (fallback)."""
    for words in normalize_query(query):
        rows, has_more = _run_search(cur, words, offset, PAGE_SIZE)
        if rows:
            return rows, has_more
    # fallback: ищем только по самому длинному слову
    all_words = normalize_query(query)
    longest = max((w for ws in all_words for w in ws), key=len, default="")
    if len(longest) >= 3:
        return _run_search(cur, [longest], offset, PAGE_SIZE)
    return [], False


def search_categories(cur, query):
    """Похожие категории по запросу — чтобы предложить клиенту посмотреть раздел."""
    words = normalize_query(query)
    flat = [w for ws in words for w in ws]
    if not flat:
        return []
    conds, params = [], []
    for w in set(flat):
        conds.append("LOWER(g.category) LIKE %s")
        params.append(f"%{w}%")
    cur.execute(
        f"""SELECT g.category, COUNT(DISTINCT g.id)
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.is_archived = FALSE AND g.category <> '' AND ({' OR '.join(conds)})
            GROUP BY g.category
            HAVING SUM(GREATEST(COALESCE(s.qty,0)-COALESCE(s.qty_reserved,0),0)) > 0
            ORDER BY 2 DESC LIMIT 4""",
        params)
    return [r[0] for r in cur.fetchall()]


def fmt_price(v):
    try:
        return f"{float(v):,.0f}".replace(",", " ") + " ₽"
    except Exception:
        return "—"


def render_results(cur, chat_id, query, offset, message_id=None):
    rows, has_more = search_products(cur, query, offset)
    if not rows:
        # ничего не нашли — предложим похожие категории
        cats = search_categories(cur, query)
        kb = [[{"text": f"📂 {c}", "callback_data": f"cat:{c}:0"}] for c in cats]
        kb.append([{"text": "🔍 Новый поиск", "callback_data": "search"},
                   {"text": "📂 Все категории", "callback_data": "cats"}])
        kb.append([{"text": "🏠 Меню", "callback_data": "menu"}])
        hint = "\n\nМожет, посмотришь в этих разделах? 👇" if cats else ""
        show(chat_id, f"По запросу «{query}» ничего не нашёл в наличии.{hint}", kb, message_id)
        return
    kb = []
    for product_id, name, price, avail in rows:
        kb.append([{
            "text": f"{name[:40]} · {fmt_price(price)} · {int(avail)} шт",
            "callback_data": f"p:{product_id}",
        }])
    nav = []
    if offset > 0:
        nav.append({"text": "◀️ Назад", "callback_data": f"pg:{query}:{max(0, offset-PAGE_SIZE)}"})
    if has_more:
        nav.append({"text": "Ещё ▶️", "callback_data": f"pg:{query}:{offset+PAGE_SIZE}"})
    if nav:
        kb.append(nav)
    kb.append([{"text": "🔍 Новый поиск", "callback_data": "search"},
               {"text": "📂 Категории", "callback_data": "cats"}])
    kb.append([{"text": "🏠 Меню", "callback_data": "menu"}])
    show(chat_id, f"🔧 Результаты по «{query}»:\nВыбери товар, чтобы открыть.", kb, message_id)


# ─────────────────────────── КАТЕГОРИИ ───────────────────────────

def render_categories(cur, chat_id, message_id=None):
    cur.execute(
        f"""SELECT g.category,
                   SUM(GREATEST(COALESCE(s.qty,0)-COALESCE(s.qty_reserved,0),0)) AS avail
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.is_archived = FALSE AND g.product_id IS NOT NULL AND g.category <> ''
            GROUP BY g.category
            HAVING SUM(GREATEST(COALESCE(s.qty,0)-COALESCE(s.qty_reserved,0),0)) > 0
            ORDER BY 2 DESC""")
    cats = cur.fetchall()
    if not cats:
        show(chat_id, "Пока нет позиций в наличии.",
             [[{"text": "🏠 Меню", "callback_data": "menu"}]], message_id)
        return
    kb = []
    for cat, avail in cats:
        kb.append([{"text": f"{_cat_icon(cat)} {cat} · {int(avail)} шт",
                    "callback_data": f"cat:{cat}:0"}])
    kb.append([{"text": "🔍 Поиск", "callback_data": "search"},
               {"text": "🏠 Меню", "callback_data": "menu"}])
    show(chat_id, "📂 <b>Категории в наличии</b>\nВыбери раздел:", kb, message_id)


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


def render_category(cur, chat_id, category, offset, message_id=None):
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
    rows = rows[:PAGE_SIZE]
    if not rows:
        render_categories(cur, chat_id, message_id)
        return
    kb = []
    for product_id, name, price, avail in rows:
        kb.append([{"text": f"{name[:40]} · {fmt_price(price)} · {int(avail)} шт",
                    "callback_data": f"p:{product_id}"}])
    nav = []
    if offset > 0:
        nav.append({"text": "◀️ Назад", "callback_data": f"cat:{category}:{max(0, offset-PAGE_SIZE)}"})
    if has_more:
        nav.append({"text": "Ещё ▶️", "callback_data": f"cat:{category}:{offset+PAGE_SIZE}"})
    if nav:
        kb.append(nav)
    kb.append([{"text": "📂 Категории", "callback_data": "cats"},
               {"text": "🏠 Меню", "callback_data": "menu"}])
    show(chat_id, f"{_cat_icon(category)} <b>{category}</b>\nВыбери товар:", kb, message_id)


def product_card(cur, chat_id, product_id, message_id=None):
    cur.execute(
        f"""SELECT g.product_id, g.name, g.price_retail, g.category,
                   COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.product_id = %s AND g.is_archived = FALSE
            GROUP BY g.id, g.product_id, g.name, g.price_retail, g.category
            LIMIT 1""",
        (product_id,))
    row = cur.fetchone()
    if not row:
        show(chat_id, "Товар не найден.", [[{"text": "🏠 Меню", "callback_data": "menu"}]], message_id)
        return
    pid, name, price, category, avail = row
    avail = int(avail or 0)
    text = (f"{_cat_icon(category)} <b>{name}</b>\n"
            f"Категория: {category or '—'}\n"
            f"Цена: {fmt_price(price)}\n"
            f"В наличии: {avail} шт")
    kb = [[
        {"text": "➕ 1 шт", "callback_data": f"add:{pid}:1"},
        {"text": "➕ 2 шт", "callback_data": f"add:{pid}:2"},
        {"text": "➕ 5 шт", "callback_data": f"add:{pid}:5"},
    ], [
        {"text": "🛒 Корзина", "callback_data": "cart"},
        {"text": "🔍 Поиск", "callback_data": "search"},
    ], [
        {"text": "📂 Категории", "callback_data": "cats"},
        {"text": "🏠 Меню", "callback_data": "menu"},
    ]]
    show(chat_id, text, kb, message_id)


# ─────────────────────────── КОРЗИНА ───────────────────────────

def add_to_cart(cur, chat_id, product_id, qty):
    cur.execute(
        f"""SELECT g.name, g.price_retail,
                   COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.product_id = %s AND g.is_archived = FALSE
            GROUP BY g.id, g.name, g.price_retail LIMIT 1""",
        (product_id,))
    row = cur.fetchone()
    if not row:
        return False, "Товар не найден."
    name, price, avail = row[0], float(row[1] or 0), int(row[2] or 0)
    c = load_cart(cur, chat_id)
    items = c["items"]
    found = next((i for i in items if i["id"] == product_id), None)
    cur_qty = found["quantity"] if found else 0
    if cur_qty + qty > avail:
        return False, f"В наличии только {avail} шт «{name}»."
    if found:
        found["quantity"] += qty
    else:
        items.append({"id": product_id, "name": name, "price": price,
                      "quantity": qty, "item_type": "product"})
    save_cart(cur, chat_id, items=items)
    return True, f"Добавлено: {name} ×{qty}"


def render_cart(cur, chat_id, message_id=None):
    c = load_cart(cur, chat_id)
    items = c["items"]
    if not items:
        show(chat_id, "🛒 Корзина пуста.",
             [[{"text": "🔍 Найти железо", "callback_data": "search"}],
              [{"text": "📂 Категории", "callback_data": "cats"}],
              [{"text": "🏠 Меню", "callback_data": "menu"}]], message_id)
        return
    lines, total = ["🛒 <b>Корзина</b>:"], 0
    kb = []
    for it in items:
        sub = it["price"] * it["quantity"]
        total += sub
        lines.append(f"• {it['name']} — {it['quantity']} × {fmt_price(it['price'])} = {fmt_price(sub)}")
        kb.append([{"text": f"➖ {it['name'][:30]}", "callback_data": f"dec:{it['id']}"},
                   {"text": "❌", "callback_data": f"del:{it['id']}"}])
    lines.append(f"\n<b>Итого: {fmt_price(total)}</b>")
    kb.append([{"text": "✅ Оформить заказ", "callback_data": "checkout"}])
    kb.append([{"text": "🗑 Очистить", "callback_data": "clear"},
               {"text": "🔍 Поиск", "callback_data": "search"}])
    kb.append([{"text": "🏠 Меню", "callback_data": "menu"}])
    show(chat_id, "\n".join(lines), kb, message_id)


def menu(cur, chat_id, greeting=False, message_id=None):
    mgr = is_manager(cur, chat_id)
    role = "менеджер" if mgr else "клиент"
    text = ("👋 <b>Склад BeGraphics</b>\n" if greeting else "🏠 <b>Меню</b>\n")
    text += f"Режим: {role}\n\nЧто делаем?"
    kb = [
        [{"text": "📂 Категории", "callback_data": "cats"}],
        [{"text": "🔍 Найти железо", "callback_data": "search"}],
        [{"text": "🛒 Корзина", "callback_data": "cart"}],
    ]
    show(chat_id, text, kb, message_id)


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

    # Авторезерв железа через ядро склада
    try:
        import warehouse_core as wc
        reserve_lines = [{"product_id": int(it["id"]), "qty": int(it["quantity"]), "slot": "product"}
                         for it in items if it.get("id")]
        if reserve_lines:
            wc.handle_reserve_and_purchase(cur, order_id, reserve_lines)
    except Exception as e:
        print(f"TG_BOT reserve: {e}")

    # Уведомление менеджерам
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


# ─────────────────────────── ОБРАБОТКА UPDATE ───────────────────────────

def handle_message(cur, msg):
    chat_id = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    username = msg["chat"].get("username", "")
    c = load_cart(cur, chat_id)
    state = c["state"]

    if text in ("/start", "/menu"):
        save_cart(cur, chat_id, state="idle", state_data={})
        # Убираем старую reply-клавиатуру прежнего бота
        send(chat_id, "Обновляю меню…", remove_reply_kb=True)
        menu(cur, chat_id, greeting=(text == "/start"))
        return

    if state == "await_search":
        save_cart(cur, chat_id, state="idle")
        render_results(cur, chat_id, text, 0)
        return

    if state == "await_name":
        sd = c["state_data"]; sd["name"] = text
        save_cart(cur, chat_id, state="await_phone", state_data=sd)
        send(chat_id, "📱 Укажи телефон для связи:")
        return

    if state == "await_phone":
        sd = c["state_data"]
        display_number, err = create_order(cur, chat_id, sd.get("name", "Клиент"), text, username)
        if err:
            send(chat_id, f"❌ {err}", [[{"text": "🏠 Меню", "callback_data": "menu"}]])
        else:
            send(chat_id, f"✅ Заказ <b>{display_number}</b> создан!\nМенеджер свяжется с тобой.",
                 [[{"text": "🏠 Меню", "callback_data": "menu"}]])
        return

    # любое другое сообщение — меню
    menu(cur, chat_id)


def handle_callback(cur, cb):
    chat_id = cb["message"]["chat"]["id"]
    mid = cb["message"]["message_id"]
    data = cb.get("data", "")
    answer_cb(cb["id"])

    if data == "menu":
        save_cart(cur, chat_id, state="idle", state_data={})
        menu(cur, chat_id, message_id=mid)
    elif data == "cats":
        save_cart(cur, chat_id, state="idle")
        render_categories(cur, chat_id, message_id=mid)
    elif data.startswith("cat:"):
        _, category, off = data.split(":", 2)
        render_category(cur, chat_id, category, int(off), message_id=mid)
    elif data == "search":
        save_cart(cur, chat_id, state="await_search")
        show(chat_id, "🔍 Напиши, что ищешь (например: <i>RTX 4070</i>, <i>проц 7600</i>, <i>видяха</i>):",
             [[{"text": "📂 Категории", "callback_data": "cats"}],
              [{"text": "🏠 Меню", "callback_data": "menu"}]], mid)
    elif data.startswith("pg:"):
        _, query, off = data.split(":", 2)
        render_results(cur, chat_id, query, int(off), message_id=mid)
    elif data.startswith("p:"):
        product_card(cur, chat_id, int(data[2:]), message_id=mid)
    elif data.startswith("add:"):
        _, pid, qty = data.split(":")
        ok, m = add_to_cart(cur, chat_id, int(pid), int(qty))
        answer_cb(cb["id"], m)
        render_cart(cur, chat_id, message_id=mid)
    elif data == "cart":
        render_cart(cur, chat_id, message_id=mid)
    elif data.startswith("dec:"):
        pid = int(data[4:])
        c = load_cart(cur, chat_id)
        items = []
        for it in c["items"]:
            if it["id"] == pid:
                it["quantity"] -= 1
                if it["quantity"] <= 0:
                    continue
            items.append(it)
        save_cart(cur, chat_id, items=items)
        render_cart(cur, chat_id, message_id=mid)
    elif data.startswith("del:"):
        pid = int(data[4:])
        c = load_cart(cur, chat_id)
        items = [it for it in c["items"] if it["id"] != pid]
        save_cart(cur, chat_id, items=items)
        render_cart(cur, chat_id, message_id=mid)
    elif data == "clear":
        save_cart(cur, chat_id, items=[])
        render_cart(cur, chat_id, message_id=mid)
    elif data == "checkout":
        c = load_cart(cur, chat_id)
        if not c["items"]:
            render_cart(cur, chat_id, message_id=mid)
            return
        save_cart(cur, chat_id, state="await_name", state_data={})
        show(chat_id, "📝 Оформление заказа.\nКак тебя зовут?", None, mid)


def handler(event: dict, context) -> dict:
    """Webhook Telegram-бота склада: поиск железа, корзина, заказы."""
    method = event.get("httpMethod", "POST")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": _cors(), "body": ""}
    if method == "GET":
        params = event.get("queryStringParameters") or {}
        action = params.get("action")
        # Установка webhook на самого себя (токен берётся из секрета)
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