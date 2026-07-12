"""Единая логика валидации промокода и расчёта скидки.

Используется и в backend/promos (validate/акции), и в backend/orders (create).
Никаких сторонних зависимостей — чистый Python + переданный курсор psycopg2.

Позиция корзины (item) — dict как приходит с фронта:
  {id, name, price, quantity, item_type: 'product'|'config'|'assembly',
   assembly: bool, category_id?: int, assembly_fee?: number, components?: [...]}
"""
from datetime import datetime


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def load_promo(cur, schema, code):
    """Читает промокод по коду (без учёта регистра). Возвращает dict или None."""
    cur.execute(
        f"""SELECT id, code, title, description, scope, build_part, category_ids,
                   product_ids, combo_slots, discount_type, discount_value, max_discount,
                   min_order_amount, max_uses, used_count, starts_at, expires_at,
                   is_active, is_public
            FROM {schema}.promos WHERE LOWER(code) = LOWER(%s) LIMIT 1""",
        (code.strip(),),
    )
    r = cur.fetchone()
    if not r:
        return None
    return {
        "id": r[0], "code": r[1], "title": r[2], "description": r[3], "scope": r[4],
        "build_part": r[5], "category_ids": r[6] or [], "product_ids": r[7] or [],
        "combo_slots": r[8] or [], "discount_type": r[9], "discount_value": _num(r[10]),
        "max_discount": _num(r[11]) if r[11] is not None else None,
        "min_order_amount": _num(r[12]), "max_uses": r[13], "used_count": r[14],
        "starts_at": r[15], "expires_at": r[16], "is_active": r[17], "is_public": r[18],
    }


def _item_category_id(cur, schema, item):
    """Определяет category_id позиции-товара (если не пришёл с фронта)."""
    if item.get("category_id"):
        return int(item["category_id"])
    pid = item.get("id")
    if pid and item.get("item_type") == "product":
        cur.execute(f"SELECT category_id FROM {schema}.products WHERE id = %s LIMIT 1", (int(pid),))
        row = cur.fetchone()
        if row and row[0]:
            return int(row[0])
    return None


def _eligible_base(cur, schema, promo, items):
    """Сумма позиций, на которые распространяется скидка (в зависимости от scope)."""
    scope = promo["scope"]
    total = sum(_num(i.get("price")) * int(i.get("quantity", 1) or 1) for i in items)

    if scope in ("cart", "first"):
        return total

    if scope == "category":
        cat_ids = set(int(x) for x in promo["category_ids"])
        prod_ids = set(int(x) for x in promo["product_ids"])
        base = 0.0
        for i in items:
            if i.get("item_type") != "product":
                continue
            pid = int(i["id"]) if i.get("id") else None
            cid = _item_category_id(cur, schema, i)
            if (pid and pid in prod_ids) or (cid and cid in cat_ids):
                base += _num(i.get("price")) * int(i.get("quantity", 1) or 1)
        return base

    if scope == "build":
        part = promo.get("build_part") or "all"
        base = 0.0
        for i in items:
            is_build = i.get("item_type") == "config" or i.get("assembly")
            is_assembly = i.get("item_type") == "assembly"
            if not (is_build or is_assembly):
                continue
            line = _num(i.get("price")) * int(i.get("quantity", 1) or 1)
            fee = _num(i.get("assembly_fee"))
            if part == "assembly":
                base += fee if fee else (line if is_assembly else 0.0)
            elif part == "hardware":
                base += max(line - fee, 0.0) if fee else (0.0 if is_assembly else line)
            else:
                base += line
        return base

    if scope == "combo":
        # Нужны ВСЕ слоты набора. Скидка считается от суммы найденных совпадений.
        slots = promo["combo_slots"] or []
        matched_sum = 0.0
        for slot in slots:
            cat_ids = set(int(x) for x in (slot.get("category_ids") or []))
            prod_ids = set(int(x) for x in (slot.get("product_ids") or []))
            slot_sum = 0.0
            found = False
            for i in items:
                if i.get("item_type") != "product":
                    continue
                pid = int(i["id"]) if i.get("id") else None
                cid = _item_category_id(cur, schema, i)
                if (pid and pid in prod_ids) or (cid and cid in cat_ids):
                    found = True
                    slot_sum += _num(i.get("price")) * int(i.get("quantity", 1) or 1)
            if not found:
                return 0.0  # набор неполный — скидки нет
            matched_sum += slot_sum
        return matched_sum

    return 0.0


def validate_and_calc(cur, schema, code, items, cart_total, user_id=None, customer_phone=None):
    """Проверяет промокод и считает скидку.

    Возвращает dict:
      {ok: True, promo: {...}, discount: float, base: float, new_total: float}
      либо {ok: False, error: '<код>', message: '<текст>'}
    """
    if not code or not str(code).strip():
        return {"ok": False, "error": "empty", "message": "Введите промокод"}

    promo = load_promo(cur, schema, code)
    if not promo:
        return {"ok": False, "error": "not_found", "message": "Промокод не найден"}
    if not promo["is_active"]:
        return {"ok": False, "error": "inactive", "message": "Промокод не активен"}

    now = datetime.now()
    if promo["starts_at"] and now < promo["starts_at"]:
        return {"ok": False, "error": "not_started", "message": "Акция ещё не началась"}
    if promo["expires_at"] and now > promo["expires_at"]:
        return {"ok": False, "error": "expired", "message": "Срок действия промокода истёк"}
    if promo["max_uses"] is not None and promo["used_count"] >= promo["max_uses"]:
        return {"ok": False, "error": "used_up", "message": "Лимит активаций промокода исчерпан"}

    total = _num(cart_total) or sum(
        _num(i.get("price")) * int(i.get("quantity", 1) or 1) for i in items
    )
    if promo["min_order_amount"] and total < promo["min_order_amount"]:
        need = int(promo["min_order_amount"])
        return {"ok": False, "error": "min_amount",
                "message": f"Промокод действует от {need:,} ₽".replace(",", " ")}

    # Только первый заказ
    if promo["scope"] == "first":
        had = False
        if user_id:
            cur.execute(f"SELECT 1 FROM {schema}.orders WHERE user_id = %s LIMIT 1", (user_id,))
            had = cur.fetchone() is not None
        if not had and customer_phone:
            cur.execute(
                f"SELECT 1 FROM {schema}.orders WHERE customer_phone = %s LIMIT 1",
                (customer_phone,),
            )
            had = cur.fetchone() is not None
        if had:
            return {"ok": False, "error": "not_first",
                    "message": "Промокод только для первого заказа"}

    base = _eligible_base(cur, schema, promo, items)
    if base <= 0:
        return {"ok": False, "error": "no_eligible",
                "message": "В корзине нет подходящих для скидки позиций"}

    if promo["discount_type"] == "percent":
        discount = base * promo["discount_value"] / 100.0
    else:
        discount = min(promo["discount_value"], base)

    if promo["max_discount"] is not None and promo["max_discount"] > 0:
        discount = min(discount, promo["max_discount"])
    discount = min(round(discount, 2), total)

    return {
        "ok": True,
        "promo": {"id": promo["id"], "code": promo["code"], "title": promo["title"],
                  "scope": promo["scope"], "discount_type": promo["discount_type"],
                  "discount_value": promo["discount_value"]},
        "discount": discount,
        "base": round(base, 2),
        "new_total": round(total - discount, 2),
    }
