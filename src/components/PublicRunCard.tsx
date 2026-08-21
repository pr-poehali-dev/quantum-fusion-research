import { useState } from "react"
import Icon from "@/components/ui/icon"
import { shortScore, statsLine } from "@/components/admin/stress/scoreFormat"

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
