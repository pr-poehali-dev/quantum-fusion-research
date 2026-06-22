// Общая логика проверки совместимости деталей по правилам spec_links.
// Используется и в окне выбора, и в самом конфигураторе (предупреждения у строк).

export interface SpecLinkRule {
  id: number
  name?: string
  from_attribute_id: number
  to_attribute_id: number
  rule: string
  note?: string
  is_active: boolean
}
export interface SchemaAttribute { id: number; category_id: number; code: string; name: string }

// selectedSpec = { [specCategoryId]: { [attributeId]: value } }
export type SelectedSpec = Record<number, Record<string, string | string[]>>

// Проверка одного правила связи между значениями двух деталей.
export function ruleHolds(rule: string, fromVal: unknown, toVal: unknown): boolean {
  const norm = (v: unknown) => Array.isArray(v) ? v.map(x => String(x).trim().toLowerCase()) : String(v ?? "").trim().toLowerCase()
  const num = (v: unknown) => parseFloat(String(v).replace(",", "."))
  switch (rule) {
    case "eq":
      return norm(fromVal) === norm(toVal)
    case "lte":
      return num(fromVal) <= num(toVal)
    case "gte":
      return num(fromVal) >= num(toVal)
    case "contains": {
      const arr = Array.isArray(toVal) ? toVal.map(x => String(x).trim().toLowerCase())
        : Array.isArray(fromVal) ? fromVal.map(x => String(x).trim().toLowerCase()) : []
      const needle = Array.isArray(toVal) ? String(fromVal).trim().toLowerCase() : String(toVal).trim().toLowerCase()
      return arr.includes(needle)
    }
    default:
      return true
  }
}

const isEmpty = (v: unknown) => v === undefined || v === null
  || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "")

// Какой спек-категории принадлежит атрибут.
function attrCategory(attrs: SchemaAttribute[]): Record<number, number> {
  const m: Record<number, number> = {}
  attrs.forEach(a => { m[a.id] = a.category_id })
  return m
}

export interface CompatIssue {
  fromCat: number
  toCat: number
  message: string
}

// Возвращает все нарушения совместимости между уже выбранными деталями.
// Каждое нарушение привязано к паре spec-категорий.
export function findCompatIssues(
  links: SpecLinkRule[],
  attrs: SchemaAttribute[],
  selectedSpec: SelectedSpec,
): CompatIssue[] {
  const attrCat = attrCategory(attrs)
  const issues: CompatIssue[] = []

  for (const link of links) {
    if (!link.is_active) continue
    const fromCat = attrCat[link.from_attribute_id]
    const toCat = attrCat[link.to_attribute_id]
    if (fromCat === undefined || toCat === undefined) continue

    const fromVals = selectedSpec[fromCat]
    const toVals = selectedSpec[toCat]
    // Проверяем только когда ОБЕ детали выбраны
    if (!fromVals || !toVals) continue

    const fromVal = fromVals[String(link.from_attribute_id)]
    const toVal = toVals[String(link.to_attribute_id)]

    if (link.rule === "eq" || link.rule === "contains") {
      // обе стороны должны иметь данные, иначе не блокируем
      if (isEmpty(fromVal) || isEmpty(toVal)) continue
    } else {
      if (isEmpty(fromVal) || isEmpty(toVal)) continue
    }

    if (!ruleHolds(link.rule, fromVal, toVal)) {
      const fromAttr = attrs.find(a => a.id === link.from_attribute_id)
      const message = link.note || `Не подходит по «${fromAttr?.name || "характеристике"}»`
      issues.push({ fromCat, toCat, message })
    }
  }
  return issues
}
