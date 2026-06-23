// Управляющий тип охлаждения. Категория "cooling" содержит характеристики и для
// воздушного, и для жидкостного (СЖО) охлаждения. Атрибут applies_to говорит,
// к какому подтипу относится характеристика: "all" | "air" | "liquid".
// Управляющий атрибут — cooler_type (значения "Воздушное" / "СЖО").

export interface AttrLike {
  id: number
  code: string
  applies_to?: string
}

export const COOLER_TYPE_CODE = "cooler_type"

// Значение cooler_type → подтип applies_to
export function coolerKindFromValue(value: unknown): "air" | "liquid" | null {
  const v = String(Array.isArray(value) ? value[0] : value ?? "").trim().toLowerCase()
  if (!v) return null
  if (v.includes("сжо") || v.includes("liquid") || v.includes("жидк") || v.includes("aio")) return "liquid"
  if (v.includes("возд") || v.includes("air") || v.includes("башн") || v.includes("tower")) return "air"
  return null
}

// Видим ли атрибут при выбранном подтипе охлаждения.
// kind=null — тип ещё не выбран: показываем "all" + управляющий cooler_type.
export function attrVisibleForKind(attr: AttrLike, kind: "air" | "liquid" | null): boolean {
  const applies = attr.applies_to || "all"
  if (applies === "all") return true
  if (kind === null) return false
  return applies === kind
}

// Отфильтровать список атрибутов под значения товара (по его cooler_type).
// values: { [attribute_id]: value }. Нужен code атрибута cooler_type, чтобы найти значение.
export function filterAttrsByValues<T extends AttrLike>(
  attrs: T[],
  values: Record<string, string | string[]> | undefined,
): T[] {
  // есть ли вообще управляемые атрибуты (air/liquid)?
  const hasTyped = attrs.some(a => a.applies_to === "air" || a.applies_to === "liquid")
  if (!hasTyped) return attrs
  const typeAttr = attrs.find(a => a.code === COOLER_TYPE_CODE)
  const kind = typeAttr && values ? coolerKindFromValue(values[String(typeAttr.id)]) : null
  return attrs.filter(a => attrVisibleForKind(a, kind))
}
