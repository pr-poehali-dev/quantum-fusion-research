// Форматтеры складского модуля (вынесено из WarehouseTab.tsx).

export const fmt = (n: number) =>
  n ? n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽" : "—"

export const fmtNum = (n: number) => (n ? n.toLocaleString("ru-RU") : "0")
