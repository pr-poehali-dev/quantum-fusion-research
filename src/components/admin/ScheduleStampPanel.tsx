import { EVENT_TYPES, EventType, Employee } from "./schedule.types"

interface ScheduleStampPanelProps {
  stampType: EventType
  stampStart: string
  stampEnd: string
  canStamp: boolean
  selectedEmployee: number | null
  employees: Employee[]
  onStampTypeChange: (t: EventType) => void
  onStampStartChange: (v: string) => void
  onStampEndChange: (v: string) => void
}

export function ScheduleStampPanel({
  stampType, stampStart, stampEnd,
  canStamp, selectedEmployee, employees,
  onStampTypeChange, onStampStartChange, onStampEndChange,
}: ScheduleStampPanelProps) {
  return (
    <div className="w-full shrink-0 lg:w-52">
      <div className="rounded-xl border border-border bg-card p-4 space-y-4 lg:sticky lg:top-4">
        {/* Тип события */}
        <div>
          <p className="mb-2 text-xs font-semibold text-foreground/60">Тип события</p>
          <div className="space-y-1.5">
            {EVENT_TYPES.map(et => (
              <button key={et.key}
                onClick={() => onStampTypeChange(et.key)}
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
                <input type="time" value={stampStart} onChange={e => onStampStartChange(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-foreground/40">До</label>
                <input type="time" value={stampEnd} onChange={e => onStampEndChange(e.target.value)}
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
  )
}