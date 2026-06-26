// Шаблоны блочной сборки названия товара по категориям склада.
// Бренд берётся из отдельного шага мастера и всегда идёт первым в названии.
// Каждый блок — это слайд: пользователь вводит/выбирает значение, оно
// (опционально) сохраняется в характеристику товара (attr code) и
// подставляется в итоговое название по правилам ниже.

export type BlockInput = "text" | "select"

export interface NameBlock {
  // Уникальный ключ блока внутри шаблона (для state)
  key: string
  // Подпись блока на слайде
  label: string
  // Подсказка-плейсхолдер / пример
  hint?: string
  // Тип ввода
  input: BlockInput
  // Варианты для select (если есть готовый список)
  options?: string[]
  // code характеристики (spec_attributes.code) для сохранения значения.
  // Если undefined — значение участвует только в имени, в хар-ки не пишется.
  attrCode?: string
  // Суффикс, добавляемый к значению в ИМЕНИ (например "W", "Gb", "mhz").
  nameSuffix?: string
  // Не включать значение в итоговое имя (только сохранить в хар-ку).
  excludeFromName?: boolean
  // Обязательный для перехода далее
  required?: boolean
  // Блок-«подсказка моделей»: предлагать ранее введённые значения этого attrCode
  suggest?: boolean
}

export interface CategoryTemplate {
  // slug категории каталога (categories.slug) и spec_categories.product_category_slug
  slug: string
  blocks: NameBlock[]
}

// ─── Шаблоны по категориям ────────────────────────────────────────────────────
// Итоговое имя: "{Бренд} {блок1} {блок2} ..." (пустые блоки пропускаются).
export const NAME_TEMPLATES: CategoryTemplate[] = [
  // 🎮 Видеокарта → Gigabyte RTX 5070 Ti 16Gb Gaming OC
  {
    slug: "gpu",
    blocks: [
      { key: "model", label: "Модель GPU", hint: "RTX 5070 Ti", input: "text", attrCode: "model", required: true, suggest: true },
      { key: "vram", label: "Видеопамять", hint: "16", input: "text", attrCode: "vram_gb", nameSuffix: "Gb", required: true },
      { key: "edition", label: "Исполнение", hint: "Gaming OC", input: "text" },
    ],
  },
  // ⚡ Блок питания → 1stPlayer NGDP 1000W Gold ATX3.1 Black
  {
    slug: "psu",
    blocks: [
      { key: "series", label: "Серия", hint: "NGDP", input: "text" },
      { key: "watt", label: "Мощность", input: "select", attrCode: "watt", required: true,
        options: ["500 Вт","550 Вт","600 Вт","650 Вт","700 Вт","750 Вт","800 Вт","850 Вт","1000 Вт","1200 Вт","1300 Вт","1600 Вт","2000 Вт","2800 Вт"] },
      { key: "cert", label: "Сертификат 80+", input: "select", attrCode: "80plus", required: true,
        options: ["-","White","Bronze","Silver","Gold","Platinum","Titanium"] },
      { key: "std", label: "Стандарт", input: "select", attrCode: "atx_standard",
        options: ["ATX 3.1","ATX 3.0","ATX 2.x","-"] },
      { key: "color", label: "Цвет", input: "select", attrCode: "color",
        options: ["Чёрный","Белый","Серебристый","RGB"] },
    ],
  },
  // 🧠 Процессор → AMD Ryzen 7 9800X3D BOX
  {
    slug: "cpu",
    blocks: [
      { key: "lineup", label: "Линейка", hint: "Ryzen 7 / Core i7", input: "text", attrCode: "lineup", required: true, suggest: true },
      { key: "model", label: "Модель", hint: "9800X3D", input: "text", attrCode: "model", required: true, suggest: true },
      { key: "edition", label: "Исполнение", input: "select", attrCode: "edition", required: true,
        options: ["BOX","OEM"] },
    ],
  },
  // 🔲 Материнка → ASUS B650 TUF Gaming PLUS WIFI (чипсет с буквой по форм-фактору)
  {
    slug: "motherboard",
    blocks: [
      { key: "chipset", label: "Чипсет", input: "select", attrCode: "chipset", required: true,
        options: ["X870E","X870","X670E","X670","B850","B650","B840","A620","A520",
                  "Z890","Z790","B860","B760","H810","Z690","B660"] },
      { key: "series", label: "Серия", hint: "TUF Gaming", input: "text" },
      { key: "model", label: "Модель", hint: "PLUS WIFI", input: "text", attrCode: "model", suggest: true },
      { key: "form", label: "Форм-фактор", input: "select", attrCode: "form_factor", required: true,
        options: ["ATX","mATX","Mini-ITX","E-ATX"], excludeFromName: true },
    ],
  },
  // 🧩 ОЗУ → Kingston Fury DDR5 2x16Gb 6000mhz CL30
  {
    slug: "ram",
    blocks: [
      { key: "series", label: "Серия", hint: "Fury", input: "text" },
      { key: "mem_type", label: "Тип памяти", input: "select", attrCode: "mem_type", required: true,
        options: ["DDR5","DDR4"] },
      { key: "modules", label: "Кол-во планок", input: "select", attrCode: "modules", required: true,
        options: ["1","2","4"], excludeFromName: true },
      { key: "module_cap", label: "Объём 1 планки", input: "select", attrCode: "module_capacity_gb", required: true,
        options: ["8","16","24","32","48"], excludeFromName: true },
      { key: "freq", label: "Частота", hint: "6000", input: "text", attrCode: "freq", nameSuffix: "mhz", required: true },
      { key: "cl", label: "Тайминг CL", input: "select", attrCode: "cl-timing", required: true,
        options: ["CL26","CL28","CL30","CL32","CL34","CL36","CL38","CL40","CL42","CL44","CL46","CL48","CL50","CL52"] },
    ],
  },
  // 💾 Накопитель → Samsung 990 Pro 1Tb
  {
    slug: "storage",
    blocks: [
      { key: "model", label: "Модель", hint: "990 Pro", input: "text", attrCode: "model", required: true, suggest: true },
      { key: "cap", label: "Объём", input: "select", attrCode: "capacity_gb", required: true,
        options: ["128 Gb","256 Gb","512 Gb","1 Tb","2 Tb","4 Tb","8 Tb"] },
      { key: "iface", label: "Тип / интерфейс", input: "select", attrCode: "interface", required: true,
        options: ["M.2 NVMe","M.2 SATA","SSD SATA","HDD SATA"], excludeFromName: true },
    ],
  },
  // 📦 Корпус → Lian Li O11 Dynamic Black
  {
    slug: "case",
    blocks: [
      { key: "model", label: "Модель", hint: "O11 Dynamic", input: "text", attrCode: "model", required: true, suggest: true },
      { key: "form", label: "Форм-фактор", input: "select", attrCode: "mb_form_factors", required: true,
        options: ["ATX","mATX","Mini-ITX","E-ATX"], excludeFromName: true },
      { key: "color", label: "Цвет", input: "select", attrCode: "color",
        options: ["Чёрный","Белый","Серый","Серебристый","RGB"] },
    ],
  },
  // ❄️ Охлаждение → DeepCool AK620 Воздушное / DeepCool LS720 СЖО 360 Black
  {
    slug: "cooling",
    blocks: [
      { key: "type", label: "Тип охлаждения", input: "select", attrCode: "cooler_type", required: true,
        options: ["Воздушное","СЖО"] },
      { key: "model", label: "Модель", hint: "AK620 / LS720", input: "text", attrCode: "model", required: true, suggest: true },
      // Размер радиатора — только для СЖО (ветвление по type)
      { key: "rad", label: "Размер радиатора (СЖО)", input: "select", attrCode: "rad_size",
        options: ["240","280","360","420"] },
      { key: "color", label: "Цвет", input: "select", attrCode: "color",
        options: ["Чёрный","Белый","Серебристый","RGB"] },
    ],
  },
]

export const templateForSlug = (slug: string | null): CategoryTemplate | null =>
  slug ? NAME_TEMPLATES.find(t => t.slug === slug) || null : null

// Цвет в названии — короткий латинский вариант для красоты
const COLOR_NAME: Record<string, string> = {
  "Чёрный": "Black", "Белый": "White", "Серый": "Gray",
  "Серебристый": "Silver", "Серый/Чёрный": "Gray", "RGB": "RGB",
}

// Применить спецправила к одному блоку при сборке ИМЕНИ.
// values — текущие значения блоков по key.
export function blockNamePart(block: NameBlock, values: Record<string, string>): string {
  let v = (values[block.key] || "").trim()
  if (!v || v === "-") return ""
  if (block.excludeFromName) return ""

  // Цвет → латиница
  if (block.key === "color") v = COLOR_NAME[v] || v

  // Мощность БП "1000 Вт" → "1000W"
  if (block.attrCode === "watt") v = v.replace(/\s*Вт\s*/i, "W")

  // Стандарт БП "ATX 3.1" → "ATX3.1"
  if (block.attrCode === "atx_standard") v = v.replace(/\s+/g, "")

  // Чипсет: буква по форм-фактору (mATX→m, Mini-ITX→i)
  if (block.key === "chipset") {
    const ff = (values["form"] || "").toLowerCase()
    if (ff === "matx") v = v + "m"
    else if (ff === "mini-itx") v = v + "i"
  }

  return block.nameSuffix ? `${v}${block.nameSuffix}` : v
}

// Особая сборка для ОЗУ-планок: "2x16Gb"
export function ramModulesPart(values: Record<string, string>): string {
  const n = (values["modules"] || "").trim()
  const cap = (values["module_cap"] || "").trim()
  if (!n || !cap) return ""
  return `${n}x${cap}Gb`
}

// Собрать итоговое название: "{Бренд} {части блоков}".
export function buildName(brand: string, tpl: CategoryTemplate | null, values: Record<string, string>): string {
  const parts: string[] = []
  if (brand.trim()) parts.push(brand.trim())
  if (!tpl) { if (values["__manual__"]?.trim()) parts.push(values["__manual__"].trim()); return parts.join(" ") }

  for (const b of tpl.blocks) {
    // ОЗУ: после блока module_cap вставляем собранное "2x16Gb" (вместо отдельных)
    if (tpl.slug === "ram" && b.key === "module_cap") {
      const ram = ramModulesPart(values)
      if (ram) parts.push(ram)
      continue
    }
    if (tpl.slug === "ram" && b.key === "modules") continue
    const p = blockNamePart(b, values)
    if (p) parts.push(p)
  }
  return parts.join(" ").replace(/\s+/g, " ").trim()
}

// Видимость блока (ветвления). Размер радиатора СЖО — только при type=СЖО.
export function blockVisible(tpl: CategoryTemplate, block: NameBlock, values: Record<string, string>): boolean {
  if (tpl.slug === "cooling" && block.key === "rad") {
    return (values["type"] || "") === "СЖО"
  }
  return true
}
