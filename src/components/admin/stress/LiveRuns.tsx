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

function fmtTime(s: string | null): string {
  if (!s) return ""
  const d = new Date(s.replace(" ", "T"))
  if (isNaN(d.getTime())) return ""
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  })
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

const HIDDEN_KEY = "stress_live_hidden"

function readHidden(): string[] {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]") } catch { return [] }
}

export default function LiveRuns({ adminKey, auth }: Props) {
  const [runs, setRuns] = useState<LiveRun[]>([])

  // Прогоны без связи можно убрать из списка вручную: стенд мог просто
  // выключиться, и висеть в «идут сейчас» ему незачем. Скрытие помним
  // между заходами; вернулась связь — карточка снова появится.
  const [hidden, setHidden] = useState<string[]>(readHidden)

  const hide = (uid: string) => {
    const next = Array.from(new Set([...hidden, uid]))
    setHidden(next)
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(next.slice(-200)))
  }

  const load = useCallback(() => {
    api.stress.liveRuns(adminKey, auth)
      .then(d => setRuns(d?.runs || []))
      .catch(() => setRuns([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, auth?.session, auth?.allCompanies])

  useEffect(() => {
    load()
    // Данные меняются не чаще отбивки, но обновлять надо: так уходят
    // завершившиеся прогоны и вовремя появляется пометка «нет связи».
    const t = setInterval(load, 60_000)
    // Возврат на вкладку — сразу свежие данные, а не через минуту.
    const onFocus = () => load()
    window.addEventListener("focus", onFocus)
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus) }
  }, [load])

  const visible = runs.filter(r => !(r.stale && hidden.includes(r.run_uid)))
  const hiddenCount = runs.length - visible.length

  if (visible.length === 0 && hiddenCount === 0) return null

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        <h3 className="text-sm font-medium">Идут сейчас ({visible.length})</h3>
        {hiddenCount > 0 && (
          <button onClick={() => { setHidden([]); localStorage.removeItem(HIDDEN_KEY) }}
            style={{ cursor: "pointer" }}
            className="ml-auto text-xs text-foreground/40 hover:text-foreground transition-colors">
            Показать скрытые ({hiddenCount})
          </button>
        )}
      </div>

      {visible.map(r => {
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

            {/* Пока связи нет, данные ниже — с последней отбивки: показываем
                это прямо, чтобы «осталось ~» не выглядело настоящим. */}
            {r.stale && (
              <div className="mt-1 flex flex-wrap items-start gap-2">
                <p className="min-w-0 flex-1 text-xs text-amber-400">
                  Стенд не выходит на связь. Данные ниже — на момент последней
                  отбивки{r.heartbeat_at ? ` (${fmtTime(r.heartbeat_at)})` : ""}.
                </p>
                <button onClick={() => hide(r.run_uid)} style={{ cursor: "pointer" }}
                  title="Убрать из списка идущих сейчас"
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] text-amber-400 hover:bg-amber-500/10 transition-colors">
                  <Icon name="EyeOff" size={11} />Скрыть
                </button>
              </div>
            )}

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
              {r.remaining_sec > 0 && !r.stale && (
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
