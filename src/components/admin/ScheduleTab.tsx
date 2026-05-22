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

interface Employee { id: number; name: string; color: string; is_active: boolean }
interface Schedule { id: number; employee_id: number; work_date: string; time_start: string | null; time_end: string | null; is_day_off: boolean; note: string | null }

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
function isCurrentMonth(d: Date, year: number, month: number) { return d.getFullYear() === year && d.getMonth() === month - 1 }

export default function ScheduleTab() {
  const { sessionId } = useAuth()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // Модалка смены
  const [modal, setModal] = useState<{ date: string; empId: number } | null>(null)
  const [modalStart, setModalStart] = useState("10:00")
  const [modalEnd, setModalEnd] = useState("21:00")
  const [modalDayOff, setModalDayOff] = useState(false)
  const [modalNote, setModalNote] = useState("")
  const [saving, setSaving] = useState(false)

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

  const openModal = (date: string, empId: number) => {
    const existing = schedules.find(s => s.work_date === date && s.employee_id === empId)
    setModal({ date, empId })
    setModalStart(existing?.time_start || "10:00")
    setModalEnd(existing?.time_end || "21:00")
    setModalDayOff(existing?.is_day_off || false)
    setModalNote(existing?.note || "")
  }

  const saveShift = async () => {
    if (!modal || !sessionId) return
    setSaving(true)
    await call("action=schedule_set", {
      method: "POST",
      body: JSON.stringify({
        employee_id: modal.empId, work_date: modal.date,
        time_start: modalDayOff ? null : modalStart,
        time_end: modalDayOff ? null : modalEnd,
        is_day_off: modalDayOff, note: modalNote || null,
      })
    })
    await loadSchedules()
    setSaving(false)
    setModal(null)
  }

  const deleteShift = async () => {
    if (!modal || !sessionId) return
    setSaving(true)
    await call("action=schedule_delete", {
      method: "POST",
      body: JSON.stringify({ employee_id: modal.empId, work_date: modal.date })
    })
    await loadSchedules()
    setSaving(false)
    setModal(null)
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

        {/* ── Календарь ── */}
        <div className="flex-1 min-w-0">
          {/* Навигация */}
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

          {/* Сетка */}
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Дни недели */}
            <div className="grid grid-cols-7 border-b border-border bg-muted/40">
              {WEEKDAYS.map(d => (
                <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wide text-foreground/50">{d}</div>
              ))}
            </div>

            {/* Недели */}
            {loading ? (
              <div className="h-64 flex items-center justify-center text-foreground/40">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 border-b border-border/50 last:border-0" style={{ minHeight: "80px" }}>
                  {week.map((day, di) => {
                    const iso = isoDate(day)
                    const inMonth = isCurrentMonth(day, year, month)
                    const isToday = iso === isoDate(today)
                    const shifts = getShifts(iso)
                    const dow = di // 0=пн, 5=сб, 6=вс
                    const isWeekend = dow >= 5

                    return (
                      <div key={di} className={`border-r border-border/30 last:border-0 p-1 ${!inMonth ? "bg-muted/20" : ""} ${isWeekend && inMonth ? "bg-muted/10" : ""}`}
                        style={{ minHeight: "80px" }}>
                        {/* Число */}
                        <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ml-auto
                          ${isToday ? "bg-primary text-primary-foreground" : ""}
                          ${!inMonth ? "text-foreground/25" : isWeekend ? "text-foreground/50" : "text-foreground/70"}`}>
                          {day.getDate()}
                        </div>

                        {/* Смены */}
                        <div className="space-y-0.5">
                          {shifts.map(s => {
                            const emp = employees.find(e => e.id === s.employee_id)
                            if (!emp) return null
                            const label = s.is_day_off
                              ? emp.name
                              : s.time_start && s.time_end
                                ? `${emp.name} (${s.time_start}-${s.time_end})`
                                : emp.name
                            return (
                              <button key={s.id}
                                onClick={() => openModal(iso, s.employee_id)}
                                className="w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium text-white leading-tight hover:opacity-80 transition-opacity"
                                style={{ backgroundColor: s.is_day_off ? "#22c55e" : emp.color, cursor: "pointer" }}
                                title={label}>
                                {label}
                              </button>
                            )
                          })}
                          {/* Кнопка добавить смену — при наведении */}
                          {inMonth && (
                            <div className="grid grid-cols-2 gap-0.5 mt-0.5">
                              {(selectedEmployee
                                ? employees.filter(e => e.id === selectedEmployee && e.is_active)
                                : employees.filter(e => e.is_active && !shifts.find(s => s.employee_id === e.id))
                              ).slice(0, 4).map(e => (
                                <button key={e.id}
                                  onClick={() => openModal(iso, e.id)}
                                  className="rounded px-1 py-0.5 text-[9px] text-foreground/30 hover:text-foreground hover:bg-muted transition-colors truncate"
                                  style={{ cursor: "pointer" }}
                                  title={`Добавить ${e.name}`}>
                                  + {e.name.split(" ")[0]}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
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

      {/* ── Модалка: смена ── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            {(() => {
              const emp = employees.find(e => e.id === modal.empId)
              const d = new Date(modal.date + "T00:00:00")
              return (
                <>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
                      style={{ backgroundColor: emp?.color }}>
                      {emp?.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{emp?.name}</p>
                      <p className="text-xs text-foreground/50">
                        {d.getDate()} {MONTHS_GEN[d.getMonth()]} {d.getFullYear()}
                      </p>
                    </div>
                    <button onClick={() => setModal(null)} className="ml-auto text-foreground/30 hover:text-foreground" style={{ cursor: "pointer" }}>
                      <Icon name="X" size={18} />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div onClick={() => setModalDayOff(v => !v)}
                        className={`relative h-6 w-11 rounded-full transition-colors ${modalDayOff ? "bg-green-500" : "bg-muted"}`}
                        style={{ cursor: "pointer" }}>
                        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${modalDayOff ? "left-6" : "left-1"}`} />
                      </div>
                      <span className="text-sm text-foreground/70">Выходной день</span>
                    </label>

                    {!modalDayOff && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-foreground/50">Начало</label>
                          <input type="time" value={modalStart} onChange={e => setModalStart(e.target.value)}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-foreground/50">Конец</label>
                          <input type="time" value={modalEnd} onChange={e => setModalEnd(e.target.value)}
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-xs text-foreground/50">Заметка (необязательно)</label>
                      <input type="text" value={modalNote} onChange={e => setModalNote(e.target.value)}
                        placeholder="Напр.: удалённо"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button onClick={saveShift} disabled={saving}
                        className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        style={{ cursor: "pointer" }}>
                        {saving ? "Сохранение..." : "Сохранить"}
                      </button>
                      <button onClick={deleteShift} disabled={saving}
                        className="rounded-lg border border-border px-4 py-2.5 text-sm text-foreground/50 hover:border-red-400 hover:text-red-400 transition-colors disabled:opacity-50"
                        style={{ cursor: "pointer" }}>
                        <Icon name="Trash2" size={15} />
                      </button>
                    </div>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

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
