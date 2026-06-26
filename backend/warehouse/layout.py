"""Раскладочный поиск: альтернативная раскладка для поисковых запросов.

Если пользователь забыл переключить язык, ищем так, как будто текст набран
в другой раскладке. Работает в обе стороны: "1stplayer" <-> "1ыездфнук".
"""

# QWERTY (en) -> ЙЦУКЕН (ru) по позиции клавиши
_EN_TO_RU = {
    'q': 'й', 'w': 'ц', 'e': 'у', 'r': 'к', 't': 'е', 'y': 'н', 'u': 'г',
    'i': 'ш', 'o': 'щ', 'p': 'з', '[': 'х', ']': 'ъ', 'a': 'ф', 's': 'ы',
    'd': 'в', 'f': 'а', 'g': 'п', 'h': 'р', 'j': 'о', 'k': 'л', 'l': 'д',
    ';': 'ж', "'": 'э', 'z': 'я', 'x': 'ч', 'c': 'с', 'v': 'м', 'b': 'и',
    'n': 'т', 'm': 'ь', ',': 'б', '.': 'ю', '`': 'ё',
}
_RU_TO_EN = {ru: en for en, ru in _EN_TO_RU.items()}


def switch_layout(s: str) -> str:
    """Переводит строку из одной раскладки в другую (посимвольно)."""
    out = []
    for ch in s:
        low = ch.lower()
        mapped = _EN_TO_RU.get(low) or _RU_TO_EN.get(low)
        if mapped is None:
            out.append(ch)
        else:
            out.append(mapped if ch == low else mapped.upper())
    return "".join(out)


def search_variants(query: str):
    """Возвращает уникальные варианты запроса: сам + перевёрнутая раскладка."""
    q = (query or "").strip().lower()
    if not q:
        return []
    alt = switch_layout(q)
    return [q, alt] if alt and alt != q else [q]
