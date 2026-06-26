// Раскладочный поиск: если забыл переключить язык, ищем так, как будто
// текст набран в другой раскладке. Работает в обе стороны:
//   "1stplayer" ⇄ "1ыездфнук",  "тпвз" ⇄ "ngdp".
//
// Используется во всех поисковиках (сайт + админка): фронтовая фильтрация
// через matchesSearch(), а на бэкенде есть аналогичный хелпер.

// Соответствие клавиш QWERTY (en) → ЙЦУКЕН (ru), одна позиция клавиши.
const EN_TO_RU: Record<string, string> = {
  q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ", p: "з",
  "[": "х", "]": "ъ", a: "ф", s: "ы", d: "в", f: "а", g: "п", h: "р", j: "о",
  k: "л", l: "д", ";": "ж", "'": "э", z: "я", x: "ч", c: "с", v: "м", b: "и",
  n: "т", m: "ь", ",": "б", ".": "ю", "`": "ё",
}

// Обратное соответствие ru → en
const RU_TO_EN: Record<string, string> = Object.entries(EN_TO_RU)
  .reduce((acc, [en, ru]) => { acc[ru] = en; return acc }, {} as Record<string, string>)

// Переводит строку из одной раскладки в другую (посимвольно, регистр сохраняем
// для букв через toLowerCase-сопоставление). Неизвестные символы — без изменений.
export function switchLayout(str: string): string {
  let out = ""
  for (const ch of str) {
    const lower = ch.toLowerCase()
    const mapped = EN_TO_RU[lower] ?? RU_TO_EN[lower]
    if (mapped === undefined) { out += ch; continue }
    // сохраняем регистр
    out += ch === lower ? mapped : mapped.toUpperCase()
  }
  return out
}

// Возвращает варианты запроса для поиска: сам запрос + его «перевёрнутая»
// раскладка (если отличается). Все в нижнем регистре, обрезанные.
export function searchVariants(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const alt = switchLayout(q)
  return alt && alt !== q ? [q, alt] : [q]
}

// Проверяет, содержит ли text запрос query с учётом раскладки (в обе стороны).
export function matchesSearch(text: string | null | undefined, query: string): boolean {
  const q = (query || "").trim()
  if (!q) return true
  const hay = (text || "").toLowerCase()
  return searchVariants(q).some(v => hay.includes(v))
}
