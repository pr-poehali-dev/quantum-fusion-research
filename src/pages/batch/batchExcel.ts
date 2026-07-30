// Экспорт/импорт содержимого массовой сборки (партии) в Excel (.xlsx)
// для удобного вбивания серийных номеров вручную.
//
// Логика: одна строка = один ПК партии. Колонки:
//   ID (техн., скрытый ключ unit.id), Вариант, № ПК, Серийник ПК,
//   далее по колонке на каждую комплектующую (заголовок = название слота).
// При импорте сопоставляем строки по колонке ID (unit.id) — надёжно даже
// если менеджер переставил строки. Пустые ячейки серийников игнорируются
// только если стали пустыми намеренно (перезаписываем значением из файла).
import * as XLSX from "xlsx"

// Минимальные типы, чтобы не тянуть весь модуль страницы
export interface BatchComp { slot: string; name: string }
export interface BatchUnit {
  id: number
  unit_no: number
  serial_number: string | null
  comp_serials?: Record<string, string>
}
export interface BatchGroup {
  id: number
  label: string
  components: BatchComp[]
  units: BatchUnit[]
}

// Технические заголовки фиксированных колонок
const COL_ID = "ID"
const COL_VARIANT = "Вариант"
const COL_UNIT = "№ ПК"
const COL_PC_SERIAL = "Серийник ПК"

// Результат разбора файла: что применить к каждому ПК
export interface ImportedUnit {
  unit_id: number
  serial_number: string
  comp_serials: Record<string, string>
}

// Заголовок колонки комплектующего: "Метка (Название)". Название помогает
// сборщику понять что именно, но при импорте мы опираемся на карту слотов.
function compHeader(slotLabel: string, name: string): string {
  return name ? `${slotLabel} — ${name}` : slotLabel
}

// Собираем таблицу и скачиваем .xlsx
export function exportBatchToExcel(
  groups: BatchGroup[],
  slotLabel: (slot: string) => string,
  fileName: string,
): void {
  // Уникальный набор колонок-комплектующих по всем вариантам:
  // ключ = slot, чтобы у одинаковых слотов из разных вариантов была одна колонка.
  const slotOrder: string[] = []
  const slotHeaderBySlot: Record<string, string> = {}
  for (const g of groups) {
    for (const c of g.components) {
      if (!c.name) continue
      if (!slotOrder.includes(c.slot)) {
        slotOrder.push(c.slot)
        slotHeaderBySlot[c.slot] = compHeader(slotLabel(c.slot), c.name)
      }
    }
  }

  const headers = [COL_ID, COL_VARIANT, COL_UNIT, COL_PC_SERIAL, ...slotOrder.map(s => slotHeaderBySlot[s])]
  const rows: (string | number)[][] = [headers]

  for (const g of groups) {
    for (const u of g.units) {
      const row: (string | number)[] = [
        u.id,
        g.label,
        u.unit_no,
        u.serial_number || "",
      ]
      for (const slot of slotOrder) {
        row.push(u.comp_serials?.[slot] || "")
      }
      rows.push(row)
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  // Ширины колонок для читаемости
  ws["!cols"] = headers.map((h, i) => ({ wch: i === 0 ? 6 : Math.max(12, Math.min(40, h.length + 4)) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Серийники")
  XLSX.writeFile(wb, fileName)
}

// Карта: заголовок колонки -> slot (для обратного разбора при импорте).
// Строим по актуальным группам, чтобы понять какие колонки к какому слоту.
function buildHeaderToSlot(groups: BatchGroup[], slotLabel: (slot: string) => string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const g of groups) {
    for (const c of g.components) {
      if (!c.name) continue
      map[compHeader(slotLabel(c.slot), c.name)] = c.slot
    }
  }
  return map
}

// Разбираем загруженный .xlsx и возвращаем изменения по ПК.
// unitIds — множество валидных id из текущей партии (для отсева чужих строк).
export async function parseBatchExcel(
  file: File,
  groups: BatchGroup[],
  slotLabel: (slot: string) => string,
): Promise<ImportedUnit[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error("Файл пустой или не читается")
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })

  const headerToSlot = buildHeaderToSlot(groups, slotLabel)
  const validIds = new Set(groups.flatMap(g => g.units.map(u => u.id)))
  const result: ImportedUnit[] = []

  for (const r of rows) {
    const rawId = r[COL_ID]
    const unitId = Number(rawId)
    if (!unitId || !validIds.has(unitId)) continue

    const comp_serials: Record<string, string> = {}
    for (const [header, slot] of Object.entries(headerToSlot)) {
      if (header in r) comp_serials[slot] = String(r[header] ?? "").trim()
    }
    result.push({
      unit_id: unitId,
      serial_number: String(r[COL_PC_SERIAL] ?? "").trim(),
      comp_serials,
    })
  }
  return result
}
