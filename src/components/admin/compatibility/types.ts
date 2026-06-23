// Типы data-driven конструктора характеристик совместимости

export type FieldType = "select" | "multiselect" | "number" | "bool" | "text"
export type LinkRule = "eq" | "lte" | "gte" | "contains"

export interface SpecCategory {
  id: number
  code: string
  name: string
  icon: string | null
  color: string | null
  product_category_slug: string | null
  sort_order: number
}

export interface SpecAttribute {
  id: number
  category_id: number
  code: string
  name: string
  field_type: FieldType
  options: string[]
  unit: string | null
  affects_compat: boolean
  is_required: boolean
  sort_order: number
  applies_to?: "all" | "air" | "liquid"
}

export interface SpecLink {
  id: number
  name: string | null
  from_attribute_id: number
  to_attribute_id: number
  rule: LinkRule
  note: string | null
  is_active: boolean
}

export interface SpecSchema {
  categories: SpecCategory[]
  attributes: SpecAttribute[]
  links: SpecLink[]
}

export interface SpecProduct {
  product_id: number
  name: string
  category: string | null
  category_slug: string | null
  image_url: string | null
  spec_category_id: number | null
  spec_category_code: string | null
  spec_category_name: string | null
  required_total: number
  required_done: number
  ready: boolean
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  select: "Выбор из списка",
  multiselect: "Несколько из списка",
  number: "Число",
  bool: "Да / Нет",
  text: "Текст",
}

export const RULE_LABELS: Record<LinkRule, string> = {
  eq: "должно совпадать (=)",
  lte: "не больше (≤)",
  gte: "не меньше (≥)",
  contains: "входит в список",
}

export const RULE_SYMBOL: Record<LinkRule, string> = {
  eq: "=", lte: "≤", gte: "≥", contains: "∈",
}

// Доступные lucide-иконки для категорий
export const CATEGORY_ICONS = [
  "Cpu", "CircuitBoard", "MemoryStick", "Gpu", "HardDrive",
  "Plug", "Box", "Fan", "Package", "Wrench", "Cable", "Monitor",
  "Keyboard", "Mouse", "Headphones", "Settings",
]

export const CATEGORY_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#8b5cf6", "#06b6d4", "#ec4899", "#64748b",
]