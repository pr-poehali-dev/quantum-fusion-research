import { useState } from "react"
import Icon from "@/components/ui/icon"
import { shortScore, statsLine } from "@/components/admin/stress/scoreFormat"
import { CATEGORIES, categoryOf } from "@/components/admin/metricUtils"
import GpuMaintenanceNotice from "@/components/stress/GpuMaintenanceNotice"

// Карточка отчёта о прогоне для публичных страниц: витрина «последний тест»
// и страница /tests/<код>. Показывает то же, что отчёт программы, но без
// датчиков и файлов — это данные владельца ПК.

export interface PublicShot {
  name: string
  url: string
}

export interface PublicRunResult {
  test_name: string
  exit_code: number | null
  duration_sec: number
  timed_out: boolean
  success: boolean
  score_text?: string
  shots?: PublicShot[]      // скриншоты теста, показываются при раскрытии
}

export interface PublicHardware {
  cpu?: string
  motherboard?: string
  ram?: string
  gpu?: string
  disks?: string[]
}

export interface PublicMetric {
  key: string
  label: string
  unit: string
  min: number | null
  max: number | null
  avg: number | null
  samples: number
}

export interface PublicRun {
  profile_name: string
  started_at: string | null
  finished_at: string | null
  total_tests: number
  passed_tests: number
  failed_tests: number
  status: string
  company_name?: string
  hardware?: PublicHardware | null
  results: PublicRunResult[]
  metrics?: PublicMetric[]     // датчики: min / сред / max за прогон
  /** Видеокарта требует обслуживания (перегрев Hot Spot / памяти). */
  gpu_maintenance?: boolean
  gpu_issues?: string[]
}

export function fmtRunDate(s: string | null): string {
  if (!s) return "—"
  const d = new Date(s.replace(" ", "T"))
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

// Строка теста: по клику раскрывается и показывает скриншоты прогона.
function TestRow({ test }: { test: PublicRunResult }) {
  const [open, setOpen] = useState(false)
  const shots = test.shots || []
  const score = shortScore(test.score_text)
  const canOpen = shots.length > 0

  return (
    <div className={`overflow-hidden rounded-xl border ${test.success ? "border-border" : "border-red-500/30 bg-red-500/5"}`}>
      <div
        onClick={canOpen ? () => setOpen(v => !v) : undefined}
        className={`flex flex-wrap items-center gap-2 p-3 ${canOpen ? "transition-colors hover:bg-foreground/5" : ""}`}
        style={{ cursor: canOpen ? "pointer" : "default" }}>
        <Icon name={test.success ? "Check" : "X"} size={15}
          className={test.success ? "text-green-400" : "text-red-400"} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={test.test_name}>
          {test.test_name}{score ? ` — ${score}` : ""}
        </span>
        <span className="text-xs text-foreground/40">
          {statsLine(test.exit_code, test.timed_out, test.duration_sec)}
        </span>
        {canOpen && (
          <span className="flex items-center gap-1 text-xs text-foreground/40">
            <Icon name="Image" size={12} />{shots.length}
            <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} />
          </span>
        )}
      </div>

      {open && (
        <div className="space-y-2 border-t border-border p-3">
          {shots.map((sh, i) => (
            <a key={i} href={sh.url} target="_blank" rel="noopener noreferrer"
              className="block overflow-hidden rounded-lg border border-border"
              title="Открыть скриншот в полном размере">
              <img src={sh.url} alt={sh.name} loading="lazy" className="w-full" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// Датчики прогона: min / сред / max с фильтром по категориям — как в админке.
function Sensors({ metrics }: { metrics: PublicMetric[] }) {
  const [cat, setCat] = useState("all")
  if (metrics.length === 0) return null

  const items = metrics
    .map(m => ({ m, category: categoryOf(m.key) }))
    .filter(x => cat === "all" || x.category === cat)

  return (
    <div className="px-5 pt-4 sm:px-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/40">
          <Icon name="Activity" size={13} />Датчики (min / сред / max)
        </p>
        <div className="flex flex-wrap gap-1">
          {[{ id: "all", label: "Все" }, ...CATEGORIES].map(c => (
            <button key={c.id} onClick={() => setCat(c.id)} style={{ cursor: "pointer" }}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${cat === c.id ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:text-foreground"}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-foreground/40">
          Нет датчиков в этой категории.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((x, i) => (
            <div key={i} className="rounded-xl border border-border bg-background/50 p-3">
              <div className="truncate text-[11px] text-foreground/40" title={x.m.label}>{x.m.label}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl font-bold">{x.m.max ?? "—"}</span>
                <span className="text-xs text-foreground/40">{x.m.unit}</span>
                <span className="ml-1 rounded bg-red-500/15 px-1 py-0.5 text-[9px] text-red-400">max</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-foreground/50">
                <span>мин {x.m.min ?? "—"}</span>
                <span>·</span>
                <span>сред {x.m.avg ?? "—"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PublicRunCard({ run }: { run: PublicRun }) {
  const hw = run.hardware || {}
  const hwRows = ([
    ["Процессор", hw.cpu || ""],
    ["Материнская плата", hw.motherboard || ""],
    ["ОЗУ", hw.ram || ""],
    ["Видеокарта", hw.gpu || ""],
  ] as [string, string][]).filter(([, v]) => v)

  const failed = run.failed_tests > 0

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <p className="text-xs text-foreground/40">
          {fmtRunDate(run.finished_at)}
          {run.company_name ? ` · ${run.company_name}` : ""}
        </p>
        <h3 className="mt-1 text-xl font-semibold">{run.profile_name || "Стресс-тест"}</h3>
      </div>

      {/* Вердикт: ровно как в отчёте программы */}
      <div className="px-5 pt-4 sm:px-6">
        <div className={`flex items-start gap-3 rounded-xl border p-4 ${failed ? "border-red-500/40 bg-red-500/5" : "border-green-500/40 bg-green-500/5"}`}>
          <Icon name={failed ? "X" : "Check"} size={18}
            className={failed ? "mt-0.5 text-red-400" : "mt-0.5 text-green-400"} />
          <div>
            <p className={`font-medium ${failed ? "text-red-400" : "text-green-400"}`}>
              {failed ? "Есть ошибки в тестах" : "Все тесты пройдены"}
            </p>
            <p className="mt-1 text-sm text-foreground/50">
              {failed
                ? "Один или несколько тестов завершились с ошибкой."
                : "Компьютер отработал полную нагрузку без сбоев."}
            </p>
          </div>
        </div>
      </div>

      {/* Конфигурация ПК */}
      {hwRows.length > 0 && (
        <div className="px-5 pt-4 sm:px-6">
          <div className="rounded-xl border border-border bg-background/50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground/40">
              Конфигурация ПК
            </p>
            <dl className="space-y-1.5 text-sm">
              {hwRows.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                  <dt className="shrink-0 text-foreground/40 sm:w-44">{k}</dt>
                  <dd className="min-w-0 break-words text-foreground/80">{v}</dd>
                </div>
              ))}
              {hw.disks && hw.disks.length > 0 && (
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                  <dt className="shrink-0 text-foreground/40 sm:w-44">Диски</dt>
                  <dd className="min-w-0 space-y-0.5 break-words text-foreground/80">
                    {hw.disks.map((d, i) => <p key={i}>{d}</p>)}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}

      {/* Итоги */}
      <div className="grid grid-cols-3 gap-2 px-5 pt-4 sm:px-6">
        {[
          { n: run.total_tests, label: "всего тестов", cls: "text-foreground" },
          { n: run.passed_tests, label: "успешно", cls: "text-green-400" },
          { n: run.failed_tests, label: "с ошибкой", cls: "text-red-400" },
        ].map(x => (
          <div key={x.label} className="rounded-xl border border-border p-3 text-center">
            <p className={`text-2xl font-semibold ${x.cls}`}>{x.n}</p>
            <p className="mt-0.5 text-xs text-foreground/40">{x.label}</p>
          </div>
        ))}
      </div>

      {/* Перегрев видеокарты: тесты могли пройти, но GPU просит обслуживания */}
      {run.gpu_maintenance && (
        <div className="px-5 pt-4 sm:px-6">
          <GpuMaintenanceNotice issues={run.gpu_issues} />
        </div>
      )}

      {/* Датчики за прогон */}
      <Sensors metrics={run.metrics || []} />

      {/* Список тестов */}
      <div className="space-y-2 px-5 py-5 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/40">
          Стресс-тесты
        </p>
        {run.results.map((t, i) => (
          <TestRow key={i} test={t} />
        ))}
      </div>
    </div>
  )
}