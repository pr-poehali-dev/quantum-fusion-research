// Экспорт/импорт характеристик товаров в CSV для массового редактирования.
import { SpecAttribute, SpecProduct } from "./types"

const SEP = ";"          // разделитель колонок (Excel-RU дружелюбный)
const MULTI = "|"        // разделитель значений multiselect внутри ячейки

// Экранирование значения для CSV
function esc(v: string): string {
  if (v.includes(SEP) || v.includes("\n") || v.includes('"')) {
    return '"' + v.replace(/"/g, '""') + '"'
  }
  return v
}

// Преобразовать значение характеристики в строку для ячейки
function valToCell(v: unknown): string {
  if (v === undefined || v === null) return ""
  if (Array.isArray(v)) return v.map(String).join(MULTI)
  return String(v)
}

/**
 * Собирает CSV по товарам одной spec-категории.
 * attrs — атрибуты этой категории (колонки), products — товары,
 * valuesByPid — { product_id: { attribute_id: value } }.
 */
export function buildCsv(
  attrs: SpecAttribute[],
  products: SpecProduct[],
  valuesByPid: Record<number, Record<string, unknown>>,
): string {
  const sorted = [...attrs].sort((a, b) => a.sort_order - b.sort_order)
  // Заголовок: служебные + по одной колонке на атрибут (имя + код в скобках)
  const header = ["product_id", "Название", ...sorted.map(a => `${a.name} (${a.code})`)]
  const lines = [header.map(esc).join(SEP)]
  for (const p of products) {
    const vals = valuesByPid[p.product_id] || {}
    const row = [
      String(p.product_id),
      p.name,
      ...sorted.map(a => valToCell(vals[String(a.id)])),
    ]
    lines.push(row.map(esc).join(SEP))
  }
  // BOM для корректной кириллицы в Excel
  return "\ufeff" + lines.join("\r\n")
}

// Разбор одной строки CSV с учётом кавычек
function parseLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      } else cur += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === SEP) { out.push(cur); cur = "" }
      else cur += ch
    }
  }
  out.push(cur)
  return out
}

export interface ImportResult {
  items: { product_id: number; values: Record<string, unknown> }[]
  errors: string[]
}

/**
 * Парсит CSV обратно в массив изменений.
 * Колонки после product_id и Название сопоставляются с атрибутами по коду
 * (из скобок в заголовке) или по имени. multiselect-поля разбиваются по «|».
 */
export function parseCsv(text: string, attrs: SpecAttribute[]): ImportResult {
  const errors: string[] = []
  const clean = text.replace(/^\ufeff/, "")
  const rows = clean.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (rows.length < 2) return { items: [], errors: ["Файл пустой или без данных"] }

  const header = parseLine(rows[0])
  // Сопоставляем колонки (с 3-й) с атрибутами
  const colAttr: (SpecAttribute | null)[] = header.map((h, idx) => {
    if (idx < 2) return null
    const codeMatch = h.match(/\(([^)]+)\)\s*$/)
    const code = codeMatch ? codeMatch[1].trim() : ""
    const byCode = code ? attrs.find(a => a.code === code) : undefined
    if (byCode) return byCode
    const nameOnly = h.replace(/\([^)]*\)\s*$/, "").trim().toLowerCase()
    return attrs.find(a => a.name.toLowerCase() === nameOnly) || null
  })

  const items: { product_id: number; values: Record<string, unknown> }[] = []
  for (let r = 1; r < rows.length; r++) {
    const cells = parseLine(rows[r])
    const pid = parseInt(cells[0])
    if (!pid) { errors.push(`Строка ${r + 1}: нет product_id`); continue }
    const values: Record<string, unknown> = {}
    for (let c = 2; c < cells.length; c++) {
      const attr = colAttr[c]
      if (!attr) continue
      const raw = (cells[c] || "").trim()
      if (attr.field_type === "multiselect") {
        values[String(attr.id)] = raw ? raw.split(MULTI).map(s => s.trim()).filter(Boolean) : []
      } else {
        values[String(attr.id)] = raw
      }
    }
    items.push({ product_id: pid, values })
  }
  return { items, errors }
}

// Скачивание строки как файла
export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
