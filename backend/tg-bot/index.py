"""Telegram-бот склада BeGraphics.

Возможности:
- /start — меню
- Поиск железа из наличия по названию (цена, остаток)
- Корзина: добавление позиций с количеством, оформление заказа
- Создание заказа железа (order_type=parts) с авторезервом через warehouse_core

Доступ: поиск — всем; оформление заказа доступно всем (клиентам — как клиентский
заказ, менеджерам из tg_bot_managers — помечается «менеджер»).

Webhook: Telegram шлёт POST с update. Токен — TELEGRAM_BOT_TOKEN.
"""
import os
import json
import urllib.request
import urllib.parse
import psycopg2

SCHEMA = "t_p72635010_quantum_fusion_resea"
TG_API = "https://api.telegram.org/bot{token}/{method}"
PAGE_SIZE = 8


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def tg_call(method: str, payload: dict):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("TG_BOT: нет TELEGRAM_BOT_TOKEN")
        return None
    try:
        url = TG_API.format(token=token, method=method)
        data = json.dumps(payload).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"TG_BOT {method}: {e}")
        return None


def send(chat_id, text, keyboard=None):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
               "disable_web_page_preview": True}
    if keyboard is not None:
        payload["reply_markup"] = {"inline_keyboard": keyboard}
    return tg_call("sendMessage", payload)


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


# ─────────────────────────── ПОИСК ЖЕЛЕЗА ───────────────────────────

def search_products(cur, query, offset=0):
    like = f"%{query.lower()}%"
    cur.execute(
        f"""SELECT g.product_id, g.name, g.price_retail,
                   COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.is_archived = FALSE
              AND g.product_id IS NOT NULL
              AND LOWER(g.name) LIKE %s
            GROUP BY g.id, g.product_id, g.name, g.price_retail
            HAVING (COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0)) > 0
            ORDER BY g.name
            LIMIT %s OFFSET %s""",
        (like, PAGE_SIZE + 1, offset))
    rows = cur.fetchall()
    has_more = len(rows) > PAGE_SIZE
    return rows[:PAGE_SIZE], has_more


def fmt_price(v):
    try:
        return f"{float(v):,.0f}".replace(",", " ") + " ₽"
    except Exception:
        return "—"


def render_results(cur, chat_id, query, offset):
    rows, has_more = search_products(cur, query, offset)
    if not rows:
        send(chat_id, f"По запросу «{query}» ничего не найдено в наличии.",
             [[{"text": "🔍 Новый поиск", "callback_data": "search"}],
              [{"text": "🏠 Меню", "callback_data": "menu"}]])
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
               {"text": "🏠 Меню", "callback_data": "menu"}])
    send(chat_id, f"🔧 Результаты по «{query}»:\nВыбери товар, чтобы добавить в корзину.", kb)


def product_card(cur, chat_id, product_id):
    cur.execute(
        f"""SELECT g.product_id, g.name, g.price_retail,
                   COALESCE(SUM(s.qty),0) - COALESCE(SUM(s.qty_reserved),0) AS avail
            FROM {SCHEMA}.warehouse_groups g
            LEFT JOIN {SCHEMA}.warehouse_supplies s ON s.group_id = g.id
            WHERE g.product_id = %s AND g.is_archived = FALSE
            GROUP BY g.id, g.product_id, g.name, g.price_retail
            LIMIT 1""",
        (product_id,))
    row = cur.fetchone()
    if not row:
        send(chat_id, "Товар не найден.", [[{"text": "🏠 Меню", "callback_data": "menu"}]])
        return
    pid, name, price, avail = row
    avail = int(avail or 0)
    text = (f"<b>{name}</b>\n"
            f"Цена: {fmt_price(price)}\n"
            f"В наличии: {avail} шт")
    kb = [[
        {"text": "➕ 1 шт", "callback_data": f"add:{pid}:1"},
        {"text": "➕ 2 шт", "callback_data": f"add:{pid}:2"},
        {"text": "➕ 5 шт", "callback_data": f"add:{pid}:5"},
    ], [
        {"text": "🛒 Корзина", "callback_data": "cart"},
        {"text": "🔍 Поиск", "callback_data": "search"},
    ]]
    send(chat_id, text, kb)


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


def render_cart(cur, chat_id):
    c = load_cart(cur, chat_id)
    items = c["items"]
    if not items:
        send(chat_id, "🛒 Корзина пуста.",
             [[{"text": "🔍 Найти железо", "callback_data": "search"}],
              [{"text": "🏠 Меню", "callback_data": "menu"}]])
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
    send(chat_id, "\n".join(lines), kb)


def menu(cur, chat_id, greeting=False):
    mgr = is_manager(cur, chat_id)
    role = "менеджер" if mgr else "клиент"
    text = ("👋 <b>Склад BeGraphics</b>\n" if greeting else "🏠 <b>Меню</b>\n")
    text += f"Режим: {role}\n\nЧто делаем?"
    kb = [
        [{"text": "🔍 Найти железо", "callback_data": "search"}],
        [{"text": "🛒 Корзина", "callback_data": "cart"}],
    ]
    send(chat_id, text, kb)


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
    username = cb["from"].get("username", "")
    data = cb.get("data", "")
    answer_cb(cb["id"])

    if data == "menu":
        save_cart(cur, chat_id, state="idle", state_data={})
        menu(cur, chat_id)
    elif data == "search":
        save_cart(cur, chat_id, state="await_search")
        send(chat_id, "🔍 Введи название железа (например: <i>RTX 4070</i>):")
    elif data.startswith("pg:"):
        _, query, off = data.split(":", 2)
        render_results(cur, chat_id, query, int(off))
    elif data.startswith("p:"):
        product_card(cur, chat_id, int(data[2:]))
    elif data.startswith("add:"):
        _, pid, qty = data.split(":")
        ok, m = add_to_cart(cur, chat_id, int(pid), int(qty))
        answer_cb(cb["id"], m)
        render_cart(cur, chat_id)
    elif data == "cart":
        render_cart(cur, chat_id)
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
        render_cart(cur, chat_id)
    elif data.startswith("del:"):
        pid = int(data[4:])
        c = load_cart(cur, chat_id)
        items = [it for it in c["items"] if it["id"] != pid]
        save_cart(cur, chat_id, items=items)
        render_cart(cur, chat_id)
    elif data == "clear":
        save_cart(cur, chat_id, items=[])
        render_cart(cur, chat_id)
    elif data == "checkout":
        c = load_cart(cur, chat_id)
        if not c["items"]:
            render_cart(cur, chat_id)
            return
        save_cart(cur, chat_id, state="await_name", state_data={})
        send(chat_id, "📝 Оформление заказа.\nКак тебя зовут?")


def handler(event: dict, context) -> dict:
    """Webhook Telegram-бота склада: поиск железа, корзина, заказы."""
    method = event.get("httpMethod", "POST")
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": _cors(), "body": ""}
    if method == "GET":
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