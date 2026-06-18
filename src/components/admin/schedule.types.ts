export const SCHEDULE_URL = "https://functions.poehali.dev/10912f60-5fd3-4930-9724-ad4929621f72"

export const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
export const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"]
export const MONTHS_GEN = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"]

export const PALETTE = [
  "#3b82f6","#22c55e","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#f97316","#ec4899","#14b8a6","#6366f1",
]

export type EventType = "work" | "absent" | "dayoff"

export const EVENT_TYPES: { key: EventType; label: string; color: string; dot: string }[] = [
  { key: "work",   label: "Рабочий день",  color: "bg-blue-600/20 border-blue-500/40 text-blue-400",   dot: "#3b82f6" },
  { key: "absent", label: "Отсутствовал",  color: "bg-red-600/20 border-red-500/40 text-red-400",      dot: "#ef4444" },
  { key: "dayoff", label: "Выходной",      color: "bg-green-600/20 border-green-500/40 text-green-400", dot: "#22c55e" },
]

export interface Employee { id: number; name: string; color: string; is_active: boolean; assembler_percent?: number }
export interface Schedule {
  id: number; employee_id: number; work_date: string
  time_start: string | null; time_end: string | null
  is_day_off: boolean; event_type?: EventType; note: string | null
}

// Пароль входа в админ-панель (совпадает с ADMIN_PASSWORD на фронте).
// Передаём в заголовке, чтобы расписание/календарь работали и без user-сессии.
export const SCHEDULE_ADMIN_KEY = "begraphics2024"

export function authH(sid: string) {
  return { "Content-Type": "application/json", "X-Session-Id": sid || "", "X-Admin-Key": SCHEDULE_ADMIN_KEY }
}

// Добавляет admin-ключ в query-строку (на случай фильтрации кастомных заголовков облаком)
export function withAk(qs: string) {
  return qs + (qs.includes("?") || qs.includes("=") ? "&" : "") + "ak=" + encodeURIComponent(SCHEDULE_ADMIN_KEY)
}

export function getMonthDays(year: number, month: number) {
  const days: Date[] = []
  const firstDay = new Date(year, month - 1, 1)
  let startDow = firstDay.getDay()
  startDow = startDow === 0 ? 6 : startDow - 1
  for (let i = 0; i < startDow; i++) days.push(new Date(year, month - 1, -startDow + i + 1))
  const daysInMonth = new Date(year, month, 0).getDate()
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month - 1, i))
  while (days.length % 7 !== 0) days.push(new Date(year, month, days.length - daysInMonth - startDow + 1))
  return days
}

export function isoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function isCurrentMonth(d: Date, year: number, month: number) {
  return d.getFullYear() === year && d.getMonth() === month - 1
}

export function shiftColor(s: Schedule, emp: Employee) {
  const t = (s.event_type || (s.is_day_off ? "dayoff" : "work")) as EventType
  if (t === "absent") return "#ef4444"
  if (t === "dayoff") return "#22c55e"
  return emp.color
}