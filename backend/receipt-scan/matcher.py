"""Матчинг сырых названий с чека к товарам склада (warehouse_groups).

Без внешних зависимостей: нормализация + токенное нечёткое сравнение.
Уровни: 0 — артикул, 1 — память сопоставлений, 2 — нечёткое сравнение.
"""
import re

# Мусорные слова, которые есть в чеках, но мешают сравнению
STOPWORDS = {
    "видеокарта", "видеокарты", "процессор", "материнская", "плата", "оперативная",
    "память", "озу", "накопитель", "ссд", "жесткий", "диск", "блок", "питания",
    "корпус", "кулер", "охлаждение", "вентилятор", "шт", "штук", "pcs", "pci",
    "express", "ret", "oem", "box", "рф", "гар", "новый", "товар", "наименование",
}

# Нормализация единиц
UNIT_FIX = [
    (r"гб", "gb"), (r"тб", "tb"), (r"мгц", "mhz"), (r"ггц", "ghz"),
    (r"вт", "w"),
]


def normalize(s: str) -> str:
    """Канонизируем строку: lower, латинизация единиц, убираем мусор."""
    s = (s or "").lower().strip()
    s = s.replace("ё", "е")
    for a, b in UNIT_FIX:
        s = re.sub(a, b, s)
    # пробел между числом и единицей: 12gb -> 12 gb
    s = re.sub(r"(\d)\s*(gb|tb|mhz|ghz|w)", r"\1\2", s)
    # выкидываем всё кроме букв/цифр/пробелов
    s = re.sub(r"[^a-zа-я0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def tokens(s: str) -> set:
    norm = normalize(s)
    return {t for t in norm.split() if t and t not in STOPWORDS and len(t) > 1}


def token_set_ratio(a: str, b: str) -> float:
    """0..100 — насколько похожи строки по пересечению токенов."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    # вес: пересечение к меньшему множеству (устойчиво к лишним словам)
    base = len(inter) / max(1, min(len(ta), len(tb)))
    # бонус за совпадение «значимых» токенов (цифры/модели: 4070, 5800x, 32gb)
    sig = {t for t in inter if any(ch.isdigit() for ch in t)}
    sig_total = {t for t in (ta | tb) if any(ch.isdigit() for ch in t)}
    sig_score = len(sig) / max(1, len(sig_total)) if sig_total else 1.0
    return round((base * 0.6 + sig_score * 0.4) * 100, 1)


def match_one(raw_name: str, article: str, groups: list, memory: dict) -> dict:
    """Сопоставить одну позицию чека.

    groups: [{id, name, part_number, category, ...}]
    memory: {raw_norm: group_id} — запомненные ручные сопоставления
    Возвращает {group_id, confidence, level, candidates: [{group_id, name, score}]}
    """
    raw_norm = normalize(raw_name)

    # Уровень 0 — артикул
    if article:
        art = normalize(article)
        for g in groups:
            pn = normalize(g.get("part_number") or "")
            if pn and pn == art:
                return {"group_id": g["id"], "confidence": 100.0, "level": "article", "candidates": []}

    # Уровень 1 — память сопоставлений (ручные подтверждения)
    if raw_norm in memory:
        gid = memory[raw_norm]
        g = next((x for x in groups if x["id"] == gid), None)
        if g:
            return {"group_id": gid, "confidence": 99.0, "level": "memory", "candidates": []}

    # Уровень 2 — нечёткое сравнение
    scored = []
    for g in groups:
        score = token_set_ratio(raw_name, g.get("name") or "")
        if score > 0:
            scored.append({"group_id": g["id"], "name": g.get("name"), "score": score})
    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[:5]

    if top and top[0]["score"] >= 90:
        return {"group_id": top[0]["group_id"], "confidence": top[0]["score"], "level": "fuzzy_high", "candidates": top}
    if top and top[0]["score"] >= 55:
        return {"group_id": top[0]["group_id"], "confidence": top[0]["score"], "level": "fuzzy_mid", "candidates": top}
    return {"group_id": None, "confidence": top[0]["score"] if top else 0.0, "level": "none", "candidates": top}
