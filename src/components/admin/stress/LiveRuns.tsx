import { useCallback, useEffect, useState } from "react"
import Icon from "@/components/ui/icon"
import { api, StressAuth } from "@/lib/api"

// Прогоны, которые идут прямо сейчас. Данные берём из отбивок heartbeat,
// которые программа и так шлёт раз в интервал — отдельный опрос не нужен.

interface LiveRun {
  run_uid: string
  machine_name: string
  profile_name: string
  company_name: string
  order_number: string
  started_at: string | null
  heartbeat_at: string | null
  next_heartbeat_at: string | null
  heartbeat_interval_sec: number
  current_test_index: number
  current_test_name: string
  planned_total: number
  completed_count: number
  failed_count: number
  has_errors: boolean
  remaining_sec: number
  current_test_remaining_sec: number
  stale: boolean
  since_heartbeat_sec: number
}

function fmtLeft(sec: number): string {
  if (!sec || sec < 0) return ""
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h > 0) return `${h} ч ${m} мин`
  return `${Math.max(1, m)} мин`
}

function fmtAgo(sec: number): string {
  if (sec < 90) return "только что"
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} мин назад`
  return `${Math.floor(m / 60)} ч ${m % 60} мин назад`
}

interface Props {
  adminKey: string
  auth?: StressAuth
}

export default function LiveRuns({ adminKey, auth }: Props) {
  const [runs, setRuns] = useState<LiveRun[]>([])

  const load = useCallback(() => {
    api.stress.liveRuns(adminKey, auth)
      .then(d => setRuns(d?.runs || []))
      .catch(() => setRuns([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, auth?.session, auth?.allCompanies])

  useEffect(() => {
    load()
    // Отбивка приходит редко (раз в 15 минут), поэтому обновляем раз в минуту:
    // этого хватает, чтобы «осталось» и «на связи» не выглядели застывшими.
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  if (runs.length === 0) return null

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        <h3 className="text-sm font-medium">Идут сейчас ({runs.length})</h3>
      </div>

      {runs.map(r => {
        const total = r.planned_total || 0
        const done = Math.min(r.completed_count, total || r.completed_count)
        const pct = total > 0 ? Math.round((done / total) * 100) : 0
        return (
          <div key={r.run_uid}
            className={`rounded-xl border p-3 ${r.stale ? "border-amber-500/40 bg-amber-500/5" : "border-green-500/30 bg-green-500/5"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">
                {r.machine_name || "Стенд"}
              </span>
              {r.company_name && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                  {r.company_name}
                </span>
              )}
              {r.order_number && (
                <span className="text-xs text-foreground/40">заказ {r.order_number}</span>
              )}
              <span className="ml-auto flex items-center gap-1.5 text-xs">
                {r.stale ? (
                  <span className="flex items-center gap-1 text-amber-400">
                    <Icon name="TriangleAlert" size={12} />нет связи
                  </span>
                ) : (
                  <span className="text-foreground/40">
                    отбивка {fmtAgo(r.since_heartbeat_sec)}
                  </span>
                )}
              </span>
            </div>

            <p className="mt-1 truncate text-xs text-foreground/50">
              {r.profile_name}
              {r.current_test_name ? ` · ${r.current_test_name}` : ""}
              {total > 0 ? ` · тест ${Math.max(1, r.current_test_index)} из ${total}` : ""}
            </p>

            {total > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
                <div className={`h-full rounded-full ${r.has_errors ? "bg-red-400" : "bg-green-500"}`}
                  style={{ width: `${Math.max(3, pct)}%` }} />
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/40">
              {r.remaining_sec > 0 && (
                <span className="flex items-center gap-1">
                  <Icon name="Clock" size={11} />осталось ~{fmtLeft(r.remaining_sec)}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Icon name="Check" size={11} />{done} готово
              </span>
              {r.failed_count > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <Icon name="X" size={11} />{r.failed_count} с ошибкой
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
