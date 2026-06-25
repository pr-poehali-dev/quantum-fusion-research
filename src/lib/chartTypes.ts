// Типы и утилиты для графиков в статьях.
// Конфиг графика хранится в Tiptap-ноде (data-chart-config="<json>") и
// рендерится через recharts. Поддерживаются два типа: линейный и столбчатый.

export type ChartType = "line" | "bar"

// Одна серия (линия на линейном графике или цвет столбца в группе).
export interface ChartSeries {
  id: string
  name: string      // подпись в легенде ("Arctic LF III PRO")
  color: string     // hex цвет
  hidden?: boolean  // скрыта по умолчанию
}

// Точка по оси категорий (X). values: { [seriesId]: число | null }
export interface ChartPoint {
  x: string                              // подпись по оси X ("32", "Время (Сек)")
  values: Record<string, number | null>
}

export interface ChartConfig {
  type: ChartType
  title?: string
  xLabel?: string       // подпись оси X
  yLabel?: string       // подпись оси Y
  series: ChartSeries[]
  points: ChartPoint[]
  // Для столбчатого: показывать значение над столбцом
  showValues?: boolean
  // Линейный: показывать точки на линиях
  showDots?: boolean
}

// Палитра по умолчанию для новых серий
export const CHART_COLORS = [
  "#ef4444", "#3b82f6", "#22d3ee", "#a3a3a3", "#f97316",
  "#22c55e", "#a855f7", "#84cc16", "#eab308", "#737373",
  "#ec4899", "#14b8a6", "#6366f1", "#f43f5e", "#0ea5e9",
]

export function nextColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function emptyChartConfig(type: ChartType = "line"): ChartConfig {
  return {
    type,
    title: "",
    xLabel: "",
    yLabel: "",
    series: [
      { id: uid(), name: "Серия 1", color: nextColor(0) },
      { id: uid(), name: "Серия 2", color: nextColor(1) },
    ],
    points: [
      { x: "1", values: {} },
      { x: "2", values: {} },
      { x: "3", values: {} },
    ],
    showValues: type === "bar",
    showDots: true,
  }
}

export function parseChartConfig(raw: string | null): ChartConfig | null {
  if (!raw) return null
  try {
    const c = JSON.parse(raw)
    if (!c || (c.type !== "line" && c.type !== "bar")) return null
    return {
      type: c.type,
      title: c.title || "",
      xLabel: c.xLabel || "",
      yLabel: c.yLabel || "",
      series: Array.isArray(c.series) ? c.series : [],
      points: Array.isArray(c.points) ? c.points : [],
      showValues: !!c.showValues,
      showDots: c.showDots !== false,
    }
  } catch {
    return null
  }
}
