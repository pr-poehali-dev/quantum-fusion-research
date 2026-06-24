// Утилиты для метрик HWiNFO/LHM: категория по ключу, человекочитаемые названия.

export interface MetricPref {
  metric_key: string
  label_orig: string
  label_custom: string
  category: string
  visible: boolean
  sort_order: number
}

export const CATEGORIES = [
  { id: "cpu", label: "CPU" },
  { id: "gpu", label: "GPU" },
  { id: "ram", label: "Память" },
  { id: "fan", label: "Вентиляторы" },
  { id: "other", label: "Прочее" },
] as const

// Категория по ключу метрики.
export function categoryOf(key: string): string {
  if (key.startsWith("ram")) return "ram"
  if (key.startsWith("cpu")) return "cpu"
  if (key.startsWith("gpu")) return "gpu"
  if (key === "fan" || key.startsWith("fan")) return "fan"
  return "other"
}

// Уникальный идентификатор метрики (ключ + исходная метка — для вентиляторов).
export function prefId(metricKey: string, labelOrig: string): string {
  return `${metricKey}::${labelOrig}`
}