import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"
import {
  SCHEDULE_URL, Employee, authH, withAk, getMonthDays, isoDate, isCurrentMonth,
  WEEKDAYS, MONTHS,
} from "./schedule.types"

interface EventEmployee { id: number; name: string; color: string }
interface CalEvent {
  id: number
  event_date: string
  title: string
  description: string
  employees: EventEmployee[]
  kind: "event"
}
interface Pickup {
  event_date: string
  store_id: number | null
  store_name: string
  store_code: string
  orders_count: number
  kind: "pickup"
}
interface Handout {
  event_date: string
  order_number: string
  order_id: number
  customer_name: string
  kind: "handout"
}

const EMPTY_FORM = { id: null as number | null, event_date: "", title: "", description: "", employee_ids: [] as number[] }

export default function CalendarTab() {
  const { sessionId } = useAuth()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [events, setEvents] = useState<CalEvent[]>([])
  const [pickups, setPickups] = useState<Pickup[]>([])
  const [handouts, setHandouts] = useState<Handout[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const call = useCallback(async (qs: string, opts?: RequestInit) => {
    const res = await fetch(`${SCHEDULE_URL}?${withAk(qs)}`, { ...opts, headers: authH(sessionId || "") })
    return res.json()
  }, [sessionId])

  const load = useCallback(async () => {
    setLoading(true)
    const [d, e] = await Promise.all([
      call(`action=events&year=${year}&month=${month}`),
      call("action=employees"),
    ])
    setEvents(d.events || [])
    setPickups(d.pickups || [])
    setHandouts(d.handouts || [])
    setEmployees((e.employees || []).filter((x: Employee) => x.is_active))
    setLoading(false)
  }, [call, year, month])

  useEffect(() => { load() }, [load])

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1) }

  const days = getMonthDays(year, month)
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  const todayIso = isoDate(today)

  const eventsByDay = (iso: string) => events.filter(e => e.event_date === iso)
  const pickupsByDay = (iso: string) => pickups.filter(p => p.event_date === iso)
  const handoutsByDay = (iso: string) => handouts.filter(h => h.event_date === iso)
  const dayCount = (iso: string) => eventsByDay(iso).length + pickupsByDay(iso).length + handoutsByDay(iso).length

  const openCreate = (iso: string) => {
    setForm({ ...EMPTY_FORM, event_date: iso })
    setModalOpen(true)
  }
  const openEdit = (ev: CalEvent) => {
    setForm({ id: ev.id, event_date: ev.event_date, title: ev.title, description: ev.description || "", employee_ids: ev.employees.map(e => e.id) })
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.title.trim() || !form.event_date) return
    setSaving(true)
    const action = form.id ? "event_update" : "event_create"
    await call(`action=${action}`, {
      method: "POST",
      body: JSON.stringify({
        id: form.id, event_date: form.event_date, title: form.title.trim(),
        description: form.description.trim(), employee_ids: form.employee_ids,
      }),
    })
    setSaving(false)
    setModalOpen(false)
    setForm(EMPTY_FORM)
    load()
  }

  const removeEvent = async (id: number) => {
    if (!confirm("Удалить событие?")) return
    await call("action=event_delete", { method: "POST", body: JSON.stringify({ id }) })
    load()
  }

  const toggleEmp = (id: number) => setForm(f => ({
    ...f, employee_ids: f.employee_ids.includes(id) ? f.employee_ids.filter(x => x !== id) : [...f.employee_ids, id],
  }))

  const selDayEvents = selectedDay ? eventsByDay(selectedDay) : []
  const selDayPickups = selectedDay ? pickupsByDay(selectedDay) : []
  const selDayHandouts = selectedDay ? handoutsByDay(selectedDay) : []

  return (
    <div>
      {/* Шапка с навигацией по месяцам */}
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-light text-foreground">Календарь событий</h2>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg border border-border p-2 text-foreground/60 hover:text-foreground hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ChevronLeft" size={16} />
          </button>
          <span className="min-w-[150px] text-center text-sm font-medium text-foreground">{MONTHS[month - 1]} {year}</span>
          <button onClick={nextMonth} className="rounded-lg border border-border p-2 text-foreground/60 hover:text-foreground hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ChevronRight" size={16} />
          </button>
        </div>
      </div>

      {/* Сетка месяца */}
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
            <div key={wi} className="grid grid-cols-7 border-b border-border/50 last:border-0" style={{ minHeight: "92px" }}>
              {week.map((day, di) => {
                const iso = isoDate(day)
                const inMonth = isCurrentMonth(day, year, month)
                const isToday = iso === todayIso
                const cnt = dayCount(iso)
                const dayEvents = eventsByDay(iso)
                const dayPickups = pickupsByDay(iso)
                const dayHandouts = handoutsByDay(iso)
                return (
                  <div
                    key={di}
                    onClick={() => { setSelectedDay(iso) }}
                    className={`border-r border-border/50 last:border-0 p-1.5 cursor-pointer transition-colors hover:bg-muted/30 ${inMonth ? "" : "opacity-40"} ${selectedDay === iso ? "bg-primary/5" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" : "text-foreground/60"}`}>{day.getDate()}</span>
                      {cnt > 0 && (
                        <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary" title="Событий в этот день">{cnt}</span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {dayPickups.map((p, i) => (
                        <div key={`p${i}`} className="truncate rounded bg-orange-400/15 px-1 py-0.5 text-[10px] font-medium text-orange-400" title={`Забрать ${p.orders_count} заказ(ов) из ${p.store_name}`}>
                          📦 {p.store_code} · {p.orders_count}
                        </div>
                      ))}
                      {dayHandouts.map((h, i) => (
                        <div key={`h${i}`} className="truncate rounded bg-green-500/15 px-1 py-0.5 text-[10px] font-medium text-green-400" title={`Выдача ПК заказ #${h.order_number}`}>
                          🚀 Выдача #{h.order_number}
                        </div>
                      ))}
                      {dayEvents.slice(0, 2).map(e => (
                        <div key={e.id} className="truncate rounded bg-blue-500/15 px-1 py-0.5 text-[10px] font-medium text-blue-400" title={e.title}>
                          {e.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[10px] text-foreground/40">+{dayEvents.length - 2} ещё</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* Панель выбранного дня */}
      {selectedDay && (
        <div className="mt-5 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">
              {new Date(selectedDay).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
            </h3>
            <button onClick={() => openCreate(selectedDay)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="Plus" size={14} />Событие
            </button>
          </div>

          {selDayPickups.length === 0 && selDayEvents.length === 0 && selDayHandouts.length === 0 && (
            <p className="py-4 text-center text-sm text-foreground/40">На этот день ничего не запланировано</p>
          )}

          {/* Заборы железок */}
          {selDayPickups.map((p, i) => (
            <div key={`pk${i}`} className="mb-2 flex items-center gap-3 rounded-lg border border-orange-400/30 bg-orange-400/5 px-3 py-2">
              <Icon name="PackageCheck" size={16} className="text-orange-400 shrink-0" />
              <span className="text-sm text-foreground">Забрать <b>{p.orders_count}</b> заказ(ов) из <b>{p.store_name}</b></span>
            </div>
          ))}

          {/* Выдачи ПК */}
          {selDayHandouts.map((h, i) => (
            <a key={`ho${i}`} href={`/admin/order/${h.order_id}`}
              className="mb-2 flex items-center gap-3 rounded-lg border border-green-400/30 bg-green-400/5 px-3 py-2 hover:border-green-400/60 transition-colors">
              <Icon name="Rocket" size={16} className="text-green-400 shrink-0" />
              <span className="text-sm text-foreground">Выдача ПК — заказ <b>#{h.order_number}</b>{h.customer_name && <span className="text-foreground/60"> · {h.customer_name}</span>}</span>
            </a>
          ))}

          {/* События */}
          {selDayEvents.map(e => (
            <div key={e.id} className="mb-2 flex items-start gap-3 rounded-lg border border-border bg-background px-3 py-2">
              <Icon name="CalendarCheck" size={16} className="text-blue-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{e.title}</p>
                {e.description && <p className="text-xs text-foreground/50 mt-0.5">{e.description}</p>}
                {e.employees.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {e.employees.map(emp => (
                      <span key={emp.id} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground/70">
                        <span className="h-2 w-2 rounded-full" style={{ background: emp.color }} />{emp.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEdit(e)} className="text-foreground/40 hover:text-primary transition-colors" style={{ cursor: "pointer" }}><Icon name="Pencil" size={14} /></button>
                <button onClick={() => removeEvent(e.id)} className="text-foreground/40 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}><Icon name="Trash2" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Модалка создания/редактирования события */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-16" style={{ cursor: "auto" }} onClick={() => setModalOpen(false)}>
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <button onClick={() => setModalOpen(false)} className="absolute right-4 top-4 text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}><Icon name="X" size={18} /></button>
            <h3 className="mb-5 text-lg font-medium text-foreground">{form.id ? "Редактировать событие" : "Новое событие"}</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Дата *</label>
                <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Название *</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Название события"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Описание</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Детали задачи"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none resize-none" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-foreground/50">Ответственные</label>
                <div className="flex flex-wrap gap-1.5">
                  {employees.length === 0 && <span className="text-xs text-foreground/40">Нет сотрудников (добавьте в Расписании)</span>}
                  {employees.map(emp => {
                    const on = form.employee_ids.includes(emp.id)
                    return (
                      <button key={emp.id} onClick={() => toggleEmp(emp.id)}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                        style={{ cursor: "pointer" }}>
                        <span className="h-2 w-2 rounded-full" style={{ background: emp.color }} />{emp.name}
                        {on && <Icon name="Check" size={12} />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Отмена</button>
              <button onClick={save} disabled={saving || !form.title.trim() || !form.event_date}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50" style={{ cursor: "pointer" }}>
                {saving && <Icon name="Loader" size={14} className="animate-spin" />}Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}