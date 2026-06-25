// Разделение материнских плат (и связанных характеристик) на платформы AMD / Intel.
// Платформа определяется АВТОМАТИЧЕСКИ по сокету: AM4/AM5/sTR5/sWRX8/AM3 → amd,
// LGA1700/LGA1851/LGA1200/LGA1851... → intel.
// Атрибут applies_to у характеристики говорит, к какой платформе она относится:
//   "all" — для обеих, "amd" — только AMD, "intel" — только Intel, "hidden" — скрыта.
// Сделано по образцу coolingFilter.ts (воздух/СЖО).

export interface PlatformAttrLike {
  id: number
  code: string
  applies_to?: string
}

export const SOCKET_CODE = "socket"

// Сокет → платформа
export function platformFromSocket(value: unknown): "amd" | "intel" | null {
  const v = String(Array.isArray(value) ? value[0] : value ?? "").trim().toUpperCase()
  if (!v) return null
  if (v.startsWith("AM") || v.startsWith("STR") || v.startsWith("SWRX") || v.startsWith("SP")) return "amd"
  if (v.startsWith("LGA")) return "intel"
  return null
}

// Платформа по любому значению (сокет или название чипсета — на всякий случай)
export function platformFromChipset(value: unknown): "amd" | "intel" | null {
  const v = String(Array.isArray(value) ? value[0] : value ?? "").trim().toUpperCase()
  if (!v) return null
  // Intel-чипсеты начинаются с Z/H + 3 цифры (Z790, B760 неоднозначен), AMD — X/B/A + 3 цифры (X870, B650)
  // Надёжнее по префиксам известных линеек:
  const amd = ["X870", "X670", "X570", "B850", "B650", "B550", "B840", "A620", "A520", "A320"]
  const intel = ["Z890", "Z790", "Z690", "B860", "B760", "B660", "H810", "H770", "H610"]
  if (amd.some(p => v.startsWith(p))) return "amd"
  if (intel.some(p => v.startsWith(p))) return "intel"
  return null
}

// Видим ли атрибут при выбранной платформе.
// platform=null — платформа не выбрана: показываем "all", скрываем amd/intel/hidden.
export function attrVisibleForPlatform(attr: PlatformAttrLike, platform: "amd" | "intel" | null): boolean {
  const applies = attr.applies_to || "all"
  if (applies === "hidden") return false
  if (applies === "all") return true
  if (platform === null) return false
  return applies === platform
}

// Отфильтровать список атрибутов под значения товара (по его сокету).
export function filterAttrsByPlatform<T extends PlatformAttrLike>(
  attrs: T[],
  values: Record<string, string | string[]> | undefined,
): T[] {
  const hasTyped = attrs.some(a => a.applies_to === "amd" || a.applies_to === "intel")
  if (!hasTyped) return attrs.filter(a => (a.applies_to || "all") !== "hidden")
  const socketAttr = attrs.find(a => a.code === SOCKET_CODE)
  const platform = socketAttr && values ? platformFromSocket(values[String(socketAttr.id)]) : null
  return attrs.filter(a => attrVisibleForPlatform(a, platform))
}
