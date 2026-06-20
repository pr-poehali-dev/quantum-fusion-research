import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"
import {
  SCHEDULE_URL, PALETTE, Employee, Schedule, EventType,
  authH, withAk, getMonthDays, isoDate,
} from "./schedule.types"
import { ScheduleCalendar } from "./ScheduleCalendar"
import { ScheduleStampPanel } from "./ScheduleStampPanel"
import { ScheduleSummary } from "./ScheduleSummary"
import { ScheduleEmployeeModal } from "./ScheduleEmployeeModal"

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
  const [stampSaving, setStampSaving] = useState<string | null>(null)

  // Модалка сотрудника
  const [empModal, setEmpModal] = useState<Partial<Employee> | null>(null)
  const [empSaving, setEmpSaving] = useState(false)

  // Сводка
  const [summaryFrom, setSummaryFrom] = useState(today.toISOString().slice(0, 10).replace(/\d{2}$/, "01"))
  const [summaryTo, setSummaryTo] = useState(today.toISOString().slice(0, 10))
  const [summary, setSummary] = useState<{id:number;name:string;color:string;work_days:number;day_offs:number;absent_days:number;total_hours:number}[]>([])

  const call = useCallback(async (qs: string, opts?: RequestInit) => {
    // Доступ по admin-ключу панели (в заголовке и в query), сессия не обязательна
    const res = await fetch(`${SCHEDULE_URL}?${withAk(qs)}`, { ...opts, headers: authH(sessionId || "") })
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

  // Клик по ячейке — применяем штамп
  const applyStamp = async (date: string) => {
    if (!selectedEmployee) return
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
    await call("action=schedule_delete", {
      method: "POST",
      body: JSON.stringify({ employee_id: empId, work_date: date })
    })
    setSchedules(prev => prev.filter(s => !(s.work_date === date && s.employee_id === empId)))
  }

  const [pinging, setPinging] = useState(false)
  const sendMorningPing = async () => {
    setPinging(true)
    try {
      const d = await call("action=morning_ping", { method: "POST", body: "{}" })
      const sent: string[] = d?.sent || []
      if (sent.length === 0) {
        alert("На сегодня нет задач и заказов к забору — отправлять нечего.")
      } else {
        const map: Record<string, string> = { pickups: "Забор заказов", tasks: "Задачи на сегодня" }
        alert("Сводка отправлена в Telegram: " + sent.map(s => map[s] || s).join(", "))
      }
    } catch {
      alert("Не удалось отправить сводку. Проверь, что бот подключён.")
    }
    setPinging(false)
  }

  const saveEmployee = async () => {
    if (!empModal) return
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

  const generatePDF = () => {
    const fmtDate = (iso: string) => {
      const [y, m, d] = iso.split("-")
      return `${d}.${m}.${y}`
    }
    const rows = summary.map(s => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;font-weight:600">${s.name}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;text-align:center;color:#3b82f6">${s.work_days}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;text-align:center;color:#f59e0b">${s.total_hours} ч</td>
        <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;text-align:center;color:#ef4444">${s.absent_days}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #2a2a2a;text-align:center;color:#22c55e">${s.day_offs}</td>
      </tr>
    `).join("")

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>График работ</title>
    <style>
      body { font-family: Arial, sans-serif; background: #fff; color: #111; margin: 40px; }
      h1 { font-size: 22px; margin-bottom: 4px; }
      .period { color: #666; font-size: 14px; margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th { background: #f3f4f6; padding: 10px 14px; text-align: left; border-bottom: 2px solid #e5e7eb; }
      th:not(:first-child) { text-align: center; }
      .total { margin-top: 20px; font-size: 13px; color: #666; }
    </style>
    </head><body>
    <h1>Отчёт по сотрудникам</h1>
    <div class="period">Период: ${fmtDate(summaryFrom)} — ${fmtDate(summaryTo)}</div>
    <table>
      <thead><tr>
        <th>Сотрудник</th>
        <th>Рабочих дней</th>
        <th>Часов работы</th>
        <th>Пропущено дней</th>
        <th>Выходных</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total">Сформировано: ${new Date().toLocaleString("ru-RU")}</div>
    </body></html>`

    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 400)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">График работ</h2>
        <div className="flex items-center gap-2">
          <button onClick={sendMorningPing} disabled={pinging}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:border-primary disabled:opacity-50"
            style={{ cursor: "pointer" }}
            title="Отправить менеджерам сводку задач и заборов на сегодня в Telegram">
            <Icon name="Send" size={15} /> {pinging ? "Отправка..." : "Отправить сводку сейчас"}
          </button>
          <button onClick={() => setEmpModal({ name: "", color: PALETTE[0], is_active: true })}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            style={{ cursor: "pointer" }}>
            <Icon name="UserPlus" size={15} /> Добавить сотрудника
          </button>
        </div>
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
          <ScheduleCalendar
            year={year} month={month} today={today}
            weeks={weeks} loading={loading}
            employees={employees} schedules={schedules}
            selectedEmployee={selectedEmployee}
            stampSaving={stampSaving} canStamp={canStamp}
            onPrevMonth={prevMonth} onNextMonth={nextMonth} onGoToday={goToday}
            onApplyStamp={applyStamp} onRemoveShift={removeShift}
          />
          <ScheduleStampPanel
            stampType={stampType} stampStart={stampStart} stampEnd={stampEnd}
            canStamp={canStamp} selectedEmployee={selectedEmployee} employees={employees}
            onStampTypeChange={setStampType}
            onStampStartChange={setStampStart}
            onStampEndChange={setStampEnd}
          />
        </div>
      </div>

      {/* ── Сводка ── */}
      <ScheduleSummary
        summary={summary}
        summaryFrom={summaryFrom} summaryTo={summaryTo}
        onFromChange={setSummaryFrom} onToChange={setSummaryTo}
        onGeneratePDF={generatePDF}
      />

      {/* ── Модалка: сотрудник ── */}
      {empModal !== null && (
        <ScheduleEmployeeModal
          empModal={empModal}
          empSaving={empSaving}
          onClose={() => setEmpModal(null)}
          onChange={patch => setEmpModal(m => ({ ...m!, ...patch }))}
          onSave={saveEmployee}
        />
      )}
    </div>
  )
}