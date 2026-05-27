import Icon from "@/components/ui/icon"
import { WEEKDAYS, MONTHS, Employee, Schedule, isoDate, isCurrentMonth, shiftColor } from "./schedule.types"

interface ScheduleCalendarProps {
  year: number
  month: number
  today: Date
  weeks: Date[][]
  loading: boolean
  employees: Employee[]
  schedules: Schedule[]
  selectedEmployee: number | null
  stampSaving: string | null
  canStamp: boolean
  onPrevMonth: () => void
  onNextMonth: () => void
  onGoToday: () => void
  onApplyStamp: (date: string) => void
  onRemoveShift: (e: React.MouseEvent, date: string, empId: number) => void
}

export function ScheduleCalendar({
  year, month, today, weeks, loading,
  employees, schedules,
  selectedEmployee, stampSaving, canStamp,
  onPrevMonth, onNextMonth, onGoToday,
  onApplyStamp, onRemoveShift,
}: ScheduleCalendarProps) {
  const todayIso = isoDate(today)

  const getShifts = (date: string) =>
    schedules.filter(s => s.work_date === date && (!selectedEmployee || s.employee_id === selectedEmployee))

  return (
    <div className="flex-1 min-w-0">
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onPrevMonth} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="ChevronLeft" size={15} />
        </button>
        <button onClick={onNextMonth} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="ChevronRight" size={15} />
        </button>
        <button onClick={onGoToday} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
          Сегодня
        </button>
        <span className="text-base font-medium text-foreground">
          {MONTHS[month - 1]} {year} г.
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
                const isToday = iso === todayIso
                const shifts = getShifts(iso)
                const isWeekend = di >= 5
                const isSaving = stampSaving === iso

                return (
                  <div key={di}
                    onClick={() => inMonth && canStamp && onApplyStamp(iso)}
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
                              onClick={e => onRemoveShift(e, iso, s.employee_id)}
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
  )
}
