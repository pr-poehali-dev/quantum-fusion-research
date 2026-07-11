// ЧПУ-слаги: транслитерация кириллицы и сборка человекопонятных URL.
// Формат ссылок: /product/{id}-{slug}. id идёт первым — короткая ссылка
// /product/{id} тоже валидна, а parseIdFromSlug всегда достаёт id.

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
}

/** Строка → безопасный slug: транслит кириллицы, только [a-z0-9-]. */
export function slugify(input?: string | null): string {
  if (!input) return ""
  return input
    .toLowerCase()
    .split("")
    .map(ch => (ch in CYR ? CYR[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "")
}

/**
 * Собирает ЧПУ-путь вида "{base}/{id}-{slug}".
 * Если имя пустое — вернёт "{base}/{id}" (короткая ссылка).
 */
export function buildPath(base: string, id: number | string, name?: string | null, slug?: string | null): string {
  const s = slug || slugify(name)
  return s ? `${base}/${id}-${s}` : `${base}/${id}`
}

/**
 * Достаёт числовой id из первого сегмента ЧПУ-пути.
 * "123-rtx-5070" → 123, "123" → 123, "abc" → NaN.
 */
export function parseIdFromSlug(param?: string): number {
  if (!param) return NaN
  const m = String(param).match(/^\d+/)
  return m ? Number(m[0]) : NaN
}
