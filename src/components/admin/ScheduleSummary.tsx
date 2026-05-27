import Icon from "@/components/ui/icon"

interface SummaryItem {
  id: number; name: string; color: string
  work_days: number; day_offs: number; absent_days: number; total_hours: number
}

interface ScheduleSummaryProps {
  summary: SummaryItem[]
  summaryFrom: string
  summaryTo: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onGeneratePDF: () => void
}

export function ScheduleSummary({
  summary, summaryFrom, summaryTo,
  onFromChange, onToChange, onGeneratePDF,
}: ScheduleSummaryProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <h3 className="text-base font-semibold text-foreground">Сводка по сотрудникам</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-foreground/60">
            <span>Период с</span>
            <input type="date" value={summaryFrom} onChange={e => onFromChange(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none" />
            <span>по</span>
            <input type="date" value={summaryTo} onChange={e => onToChange(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none" />
          </div>
          <button
            onClick={onGeneratePDF}
            disabled={summary.length === 0}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            style={{ cursor: summary.length ? "pointer" : "not-allowed" }}
          >
            <Icon name="FileDown" size={15} />
            Скачать PDF-отчёт
          </button>
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
                <div className="rounded-lg bg-yellow-500/10 p-2 text-center">
                  <p className="text-xl font-bold text-yellow-400">{s.total_hours}</p>
                  <p className="text-[10px] text-foreground/50 mt-0.5">Часов работы</p>
                </div>
                <div className="rounded-lg bg-red-500/10 p-2 text-center">
                  <p className="text-xl font-bold text-red-400">{s.absent_days}</p>
                  <p className="text-[10px] text-foreground/50 mt-0.5">Пропущено</p>
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
  )
}
