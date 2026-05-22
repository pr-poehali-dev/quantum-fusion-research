import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"

const SCHEDULE_URL = "https://functions.poehali.dev/10912f60-5fd3-4930-9724-ad4929621f72"

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"]
const MONTHS_GEN = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"]

const PALETTE = [
  "#3b82f6","#22c55e","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#f97316","#ec4899","#14b8a6","#6366f1",
]

type EventType = "work" | "absent" | "dayoff"

const EVENT_TYPES: { key: EventType; label: string; color: string; dot: string }[] = [
  { key: "work",   label: "Рабочий день",  color: "bg-blue-600/20 border-blue-500/40 text-blue-400",   dot: "#3b82f6" },
  { key: "absent", label: "Отсутствовал",  color: "bg-red-600/20 border-red-500/40 text-red-400",      dot: "#ef4444" },
  { key: "dayoff", label: "Выходной",      color: "bg-green-600/20 border-green-500/40 text-green-400", dot: "#22c55e" },
]

interface Employee { id: number; name: string; color: string; is_active: boolean }
interface Schedule {
  id: number; employee_id: number; work_date: string
  time_start: string | null; time_end: string | null
  is_day_off: boolean; event_type?: EventType; note: string | null
}

function authH(sid: string) { return { "Content-Type": "application/json", "X-Session-Id": sid } }

function getMonthDays(year: number, month: number) {
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

function isoDate(d: Date) { return d.toISOString().slice(0, 10) }
function isCurrentMonth(d: Date, year: number, month: number) {
  return d.getFullYear() === year && d.getMonth() === month - 1
}

function shiftColor(s: Schedule, emp: Employee) {
  const t = (s.event_type || (s.is_day_off ? "dayoff" : "work")) as EventType
  if (t === "absent") return "#ef4444"
  if (t === "dayoff") return "#22c55e"
  return emp.color
}

export default function ScheduleTab() {
  const { sessionId } = useAuth()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // Штамп — панель внизу
  const [stampType, setStampType] = useState<EventType>("work")
  const [stampStart, setStampStart] = useState("10:00")
  const [stampEnd, setStampEnd] = useState("21:00")
  const [stampSaving, setStampSaving] = useState<string | null>(null) // ISO дата которую сохраняем

  // Модалка сотрудника
  const [empModal, setEmpModal] = useState<Partial<Employee> | null>(null)
  const [empSaving, setEmpSaving] = useState(false)

  // Сводка
  const [summaryFrom, setSummaryFrom] = useState(today.toISOString().slice(0, 10).replace(/\d{2}$/, "01"))
  const [summaryTo, setSummaryTo] = useState(today.toISOString().slice(0, 10))
  const [summary, setSummary] = useState<{id:number;name:string;color:string;work_days:number;day_offs:number}[]>([])

  const call = useCallback(async (qs: string, opts?: RequestInit) => {
    if (!sessionId) return {}
    const res = await fetch(`${SCHEDULE_URL}?${qs}`, { ...opts, headers: authH(sessionId) })
    return res.json()
  }, [sessionId])

  const loadEmployees = useCallback(async () => {
    const d = await call("action=employees")
    setEmployees(d.employees || [])
  }, [call])

  const loadSchedules = useCallback(async () => {
    setLoading(true)
    const d = await call(`action=schedules&year=${year}&month=${month}`)
    setSchedules(d.schedules || [])
    setLoading(false)
  }, [call, year, month])

  const loadSummary = useCallback(async () => {
    const d = await call(`action=summary&date_from=${summaryFrom}&date_to=${summaryTo}`)
    setSummary(d.summary || [])
  }, [call, summaryFrom, summaryTo])

  useEffect(() => { loadEmployees() }, [loadEmployees])
  useEffect(() => { loadSchedules() }, [loadSchedules])
  useEffect(() => { loadSummary() }, [loadSummary])

  const prevMonth = () => { if (month === 1) { setYear(y => y-1); setMonth(12) } else setMonth(m => m-1) }
  const nextMonth = () => { if (month === 12) { setYear(y => y+1); setMonth(1) } else setMonth(m => m+1) }
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()+1) }

  const getShifts = (date: string) =>
    schedules.filter(s => s.work_date === date && (!selectedEmployee || s.employee_id === selectedEmployee))

  // Клик по ячейке — применяем штамп
  const applyStamp = async (date: string) => {
    if (!selectedEmployee || !sessionId) return
    setStampSaving(date)
    const isDayOff = stampType !== "work"
    await call("action=schedule_set", {
      method: "POST",
      body: JSON.stringify({
        employee_id: selectedEmployee,
        work_date: date,
        time_start: stampType === "work" ? stampStart : null,
        time_end: stampType === "work" ? stampEnd : null,
        is_day_off: isDayOff,
        note: stampType === "absent" ? "Отсутствовал" : null,
      })
    })
    // Оптимистично обновляем локально
    setSchedules(prev => {
      const filtered = prev.filter(s => !(s.work_date === date && s.employee_id === selectedEmployee))
      return [...filtered, {
        id: Date.now(), employee_id: selectedEmployee, work_date: date,
        time_start: stampType === "work" ? stampStart : null,
        time_end: stampType === "work" ? stampEnd : null,
        is_day_off: isDayOff,
        event_type: stampType,
        note: stampType === "absent" ? "Отсутствовал" : null,
      }]
    })
    setStampSaving(null)
  }

  // Клик на существующую смену — удаляем
  const removeShift = async (e: React.MouseEvent, date: string, empId: number) => {
    e.stopPropagation()
    if (!sessionId) return
    await call("action=schedule_delete", {
      method: "POST",
      body: JSON.stringify({ employee_id: empId, work_date: date })
    })
    setSchedules(prev => prev.filter(s => !(s.work_date === date && s.employee_id === empId)))
  }

  const saveEmployee = async () => {
    if (!empModal || !sessionId) return
    setEmpSaving(true)
    if (empModal.id) {
      await call("action=employee_update", { method: "POST", body: JSON.stringify(empModal) })
    } else {
      await call("action=employee_create", { method: "POST", body: JSON.stringify(empModal) })
    }
    await loadEmployees()
    setEmpSaving(false)
    setEmpModal(null)
  }

  const days = getMonthDays(year, month)
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  const canStamp = !!selectedEmployee

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">График работ</h2>
        <button onClick={() => setEmpModal({ name: "", color: PALETTE[0], is_active: true })}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          style={{ cursor: "pointer" }}>
          <Icon name="UserPlus" size={15} /> Добавить сотрудника
        </button>
      </div>

      <div className="flex gap-6">
        {/* ── Список сотрудников ── */}
        <div className="w-44 shrink-0">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground/50">Сотрудники</p>
          <div className="space-y-1.5">
            <button onClick={() => setSelectedEmployee(null)}
              className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${selectedEmployee === null ? "bg-primary/15 text-primary font-medium" : "text-foreground/60 hover:bg-muted"}`}
              style={{ cursor: "pointer" }}>
              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs shrink-0">
                <Icon name="Users" size={12} />
              </div>
              Все
            </button>
            {employees.filter(e => e.is_active).map(e => (
              <button key={e.id}
                onClick={() => setSelectedEmployee(selectedEmployee === e.id ? null : e.id)}
                onDoubleClick={() => setEmpModal(e)}
                className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${selectedEmployee === e.id ? "bg-primary/15 text-primary font-medium" : "text-foreground/70 hover:bg-muted"}`}
                style={{ cursor: "pointer" }}>
                <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ backgroundColor: e.color }}>
                  {e.name[0]?.toUpperCase()}
                </div>
                <span className="truncate">{e.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Календарь + штамп ── */}
        <div className="flex flex-1 gap-4 min-w-0">

          {/* Календарь */}
          <div className="flex-1 min-w-0">
            <div className="mb-4 flex items-center gap-3">
              <button onClick={prevMonth} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="ChevronLeft" size={15} />
              </button>
              <button onClick={nextMonth} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="ChevronRight" size={15} />
              </button>
              <button onClick={goToday} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                Сегодня
              </button>
              <span className="text-base font-medium text-foreground">
                {MONTHS[month-1]} {year} г.
              </span>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-7 border-b border-border bg-muted/40">
                {WEEKDAYS.map(d => (
                  <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wide text-foreground/50">{d}</div>
                ))}
              </div>

              {loading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : (
                weeks.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 border-b border-border/50 last:border-0" style={{ minHeight: "72px" }}>
                    {week.map((day, di) => {
                      const iso = isoDate(day)
                      const inMonth = isCurrentMonth(day, year, month)
                      const isToday = iso === isoDate(today)
                      const shifts = getShifts(iso)
                      const isWeekend = di >= 5
                      const isSaving = stampSaving === iso

                      return (
                        <div key={di}
                          onClick={() => inMonth && canStamp && applyStamp(iso)}
                          className={`border-r border-border/30 last:border-0 p-1 transition-colors
                            ${!inMonth ? "bg-muted/20" : ""}
                            ${isWeekend && inMonth ? "bg-muted/10" : ""}
                            ${inMonth && canStamp ? "cursor-pointer hover:bg-primary/5" : ""}
                            ${isSaving ? "opacity-60" : ""}
                          `}
                          style={{ minHeight: "72px" }}>
                          <div className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium ml-auto
                            ${isToday ? "bg-primary text-primary-foreground" : ""}
                            ${!inMonth ? "text-foreground/25" : isWeekend ? "text-foreground/40" : "text-foreground/60"}`}>
                            {day.getDate()}
                          </div>

                          <div className="space-y-0.5">
                            {shifts.map(s => {
                              const emp = employees.find(e => e.id === s.employee_id)
                              if (!emp) return null
                              const bg = shiftColor(s, emp)
                              const label = s.is_day_off
                                ? (s.event_type === "absent" ? `${emp.name}` : emp.name)
                                : s.time_start && s.time_end
                                  ? `${emp.name} (${s.time_start}-${s.time_end})`
                                  : emp.name
                              return (
                                <div key={s.id} className="group relative flex items-center">
                                  <div className="w-full truncate rounded px-1 py-0.5 text-[10px] font-medium text-white leading-tight"
                                    style={{ backgroundColor: bg }}
                                    title={label}>
                                    {label}
                                  </div>
                                  <button
                                    onClick={e => removeShift(e, iso, s.employee_id)}
                                    className="absolute right-0 hidden group-hover:flex h-4 w-4 items-center justify-center rounded bg-black/40 text-white hover:bg-black/70"
                                    style={{ cursor: "pointer" }}>
                                    <Icon name="X" size={8} />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Панель штампа ── */}
          <div className="w-52 shrink-0">
            <div className="rounded-xl border border-border bg-card p-4 space-y-4 sticky top-4">
              {/* Тип события */}
              <div>
                <p className="mb-2 text-xs font-semibold text-foreground/60">Тип события</p>
                <div className="space-y-1.5">
                  {EVENT_TYPES.map(et => (
                    <button key={et.key}
                      onClick={() => setStampType(et.key)}
                      className={`w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${stampType === et.key ? et.color : "border-border text-foreground/50 hover:border-border hover:text-foreground/70"}`}
                      style={{ cursor: "pointer" }}>
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: et.dot }} />
                      {et.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Время — только для рабочего дня */}
              {stampType === "work" && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-foreground/60">Время работы</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] text-foreground/40">С</label>
                      <input type="time" value={stampStart} onChange={e => setStampStart(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] text-foreground/40">До</label>
                      <input type="time" value={stampEnd} onChange={e => setStampEnd(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none" />
                    </div>
                  </div>
                </div>
              )}

              {/* Подсказка */}
              <div className={`rounded-lg px-3 py-2.5 text-xs leading-snug ${canStamp ? "bg-primary/10 text-primary" : "bg-muted/50 text-foreground/40"}`}>
                {canStamp
                  ? `Выбран: ${employees.find(e => e.id === selectedEmployee)?.name}. Кликайте по дням в календаре`
                  : "Выберите сотрудника и тип события, затем кликните по дням в календаре"}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Сводка ── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <h3 className="text-base font-semibold text-foreground">Сводка по сотрудникам</h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-foreground/60">
              <span>Период с</span>
              <input type="date" value={summaryFrom} onChange={e => setSummaryFrom(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none" />
              <span>по</span>
              <input type="date" value={summaryTo} onChange={e => setSummaryTo(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none" />
            </div>
          </div>
        </div>
        {summary.length === 0 ? (
          <p className="text-sm text-foreground/40 text-center py-4">Нет данных</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {summary.map(s => (
              <div key={s.id} className="rounded-xl border border-border bg-background p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                    style={{ backgroundColor: s.color }}>
                    {s.name[0]?.toUpperCase()}
                  </div>
                  <span className="font-semibold text-foreground text-sm">{s.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-primary/10 p-2 text-center">
                    <p className="text-xl font-bold text-primary">{s.work_days}</p>
                    <p className="text-[10px] text-foreground/50 mt-0.5">Рабочих дней</p>
                  </div>
                  <div className="rounded-lg bg-green-500/10 p-2 text-center">
                    <p className="text-xl font-bold text-green-400">{s.day_offs}</p>
                    <p className="text-[10px] text-foreground/50 mt-0.5">Выходных</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Модалка: сотрудник ── */}
      {empModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setEmpModal(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-foreground">{empModal.id ? "Редактировать" : "Новый сотрудник"}</h3>
              <button onClick={() => setEmpModal(null)} className="text-foreground/30 hover:text-foreground" style={{ cursor: "pointer" }}>
                <Icon name="X" size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Имя</label>
                <input type="text" value={empModal.name || ""}
                  onChange={e => setEmpModal(m => ({ ...m!, name: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="Например: Александр" />
              </div>
              <div>
                <label className="mb-2 block text-xs text-foreground/50">Цвет</label>
                <div className="flex flex-wrap gap-2">
                  {PALETTE.map(c => (
                    <button key={c} onClick={() => setEmpModal(m => ({ ...m!, color: c }))}
                      className={`h-8 w-8 rounded-full transition-all ${empModal.color === c ? "ring-2 ring-offset-2 ring-primary ring-offset-card scale-110" : ""}`}
                      style={{ backgroundColor: c, cursor: "pointer" }} />
                  ))}
                </div>
              </div>
              {empModal.id && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={empModal.is_active !== false}
                    onChange={e => setEmpModal(m => ({ ...m!, is_active: e.target.checked }))} />
                  <span className="text-sm text-foreground/70">Активен</span>
                </label>
              )}
              <button onClick={saveEmployee} disabled={empSaving || !empModal.name?.trim()}
                className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                style={{ cursor: "pointer" }}>
                {empSaving ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
