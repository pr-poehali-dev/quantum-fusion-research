import { useEffect, useState, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { getAdminKey } from "@/pages/admin/constants"
import StressProfilesTab from "@/components/admin/StressProfilesTab"
import MetricPrefsTab from "@/components/admin/MetricPrefsTab"
import StressFoldersPanel, { StressFolder } from "@/components/admin/stress/StressFoldersPanel"
import { openRunReport, type ReportRun } from "@/components/admin/stress/folderReport"
import { testTitle } from "@/components/admin/stress/scoreFormat"
import { MetricPref, CATEGORIES, categoryOf, prefId } from "@/components/admin/metricUtils"

interface RunFile { file_name: string; file_url: string; file_size: number }
interface Metric { key: string; label: string; unit: string; min: number | null; max: number | null; avg: number | null; samples: number }
interface ResultRow {
  id: number
  test_name: string
  command: string
  exit_code: number | null
  duration_sec: number
  planned_sec: number
  timed_out: boolean
  success: boolean
  started_at: string | null
  finished_at: string | null
  files: RunFile[]
  score_text?: string
  ocr_stress_failed?: boolean
}
interface Run {
  id: number
  run_uid: string
  profile_name: string
  machine_name: string
  os_info: string
  note: string
  started_at: string | null
  finished_at: string | null
  total_tests: number
  passed_tests: number
  failed_tests: number
  status: string
  created_at: string
  folder_id?: number | null
  results?: ResultRow[]
  metrics?: Metric[]
  partner_logo_url?: string
  partner_link?: string
  partner_links?: string[]
}

function fmtDate(s: string | null) {
  if (!s) return "—"
  const d = new Date(s)
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
}
function fmtDur(sec: number) {
  if (!sec) return "0 сек"
  if (sec < 60) return `${sec.toFixed(0)} сек`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m} мин ${s} сек`
}
function fmtSize(b: number) {
  if (b < 1024) return `${b} Б`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`
  return `${(b / 1024 / 1024).toFixed(1)} МБ`
}



interface StressTestsTabProps {
  scope?: "admin" | "partner"
  session?: string | null   // для партнёрского режима (ЛК)
}

export default function StressTestsTab({ scope = "admin", session }: StressTestsTabProps = {}) {
  const adminKey = getAdminKey()
  const isPartner = scope === "partner"
  // Авторизация запросов к stress: партнёр — по сессии, админ — по adminKey
  const auth = isPartner ? { session } : undefined
  const [view, setView] = useState<"runs" | "folders" | "profiles" | "metrics">("runs")
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Run | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [prefs, setPrefs] = useState<MetricPref[]>([])
  const [catFilter, setCatFilter] = useState<string>("all")
  const [highlightMetric, setHighlightMetric] = useState<string | null>(null)

  // Папки прогонов + выбор нескольких прогонов чекбоксами
  const [folders, setFolders] = useState<StressFolder[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  // Фильтр списка по папке: null = все, 0 = «Без папки», иначе id папки
  const [folderFilter, setFolderFilter] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.stress.list(adminKey, auth)
      .then(d => setRuns(d.runs || []))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, session])

  const loadFolders = useCallback(() => {
    api.stress.foldersList(adminKey, auth).then(d => setFolders(d.folders || [])).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, session])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadFolders() }, [loadFolders])
  useEffect(() => {
    // Настройки отображения метрик — только для админа (партнёру не нужны)
    if (isPartner) return
    api.stress.metricPrefsList(adminKey).then(d => setPrefs(d.prefs || []))
  }, [adminKey, view, isPartner])

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  const clearSelection = () => { setSelectedIds(new Set()); setSelectMode(false) }

  // Назначить выбранные прогоны в папку (или отвязать при folderId=null)
  const assignToFolder = async (folderId: number | null) => {
    const ids = [...selectedIds]
    if (!ids.length) return
    await api.stress.runsAssignFolder(ids, folderId, adminKey, auth)
    clearSelection()
    load(); loadFolders()
  }

  const openRun = (id: number) => {
    setDetailLoading(true)
    api.stress.get(id, adminKey, auth)
      .then(d => setSelected(d.run || null))
      .finally(() => setDetailLoading(false))
  }

  const removeRun = (id: number) => {
    if (!confirm("Удалить этот прогон со всеми результатами?")) return
    api.stress.deleteRun(id, adminKey, auth).then(() => {
      setSelected(null)
      load()
    })
  }

  return (
    <div>
      {/* Переключатель Прогоны / Профили */}
      <div className="mb-5 inline-flex rounded-xl border border-border bg-card p-1">
        <button onClick={() => setView("runs")}
          className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${view === "runs" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
          style={{ cursor: "pointer" }}>
          <Icon name="Activity" size={15} /> Результаты
        </button>
        <button onClick={() => setView("folders")}
          className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${view === "folders" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
          style={{ cursor: "pointer" }}>
          <Icon name="Folder" size={15} /> Папки
        </button>
        {!isPartner && (
          <>
            <button onClick={() => setView("profiles")}
              className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${view === "profiles" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}>
              <Icon name="ListChecks" size={15} /> Профили тестов
            </button>
            <button onClick={() => setView("metrics")}
              className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${view === "metrics" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}>
              <Icon name="SlidersHorizontal" size={15} /> Метрики
            </button>
          </>
        )}
      </div>

      {view === "metrics" ? <MetricPrefsTab highlight={highlightMetric} onHighlightDone={() => setHighlightMetric(null)} />
       : view === "profiles" ? <StressProfilesTab />
       : view === "folders" ? (
         <StressFoldersPanel
           adminKey={adminKey} session={session} isPartner={isPartner}
           folders={folders} runs={runs}
           onChanged={() => { loadFolders(); load() }}
           onOpenRun={openRun}
         />
       ) : (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* Список прогонов */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Прогоны стресс-тестов</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => { setSelectMode(m => !m); setSelectedIds(new Set()) }}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${selectMode ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}>
              <Icon name="CheckSquare" size={13} /> {selectMode ? "Готово" : "Выбрать"}
            </button>
            <button onClick={load} className="flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="RefreshCw" size={14} /> Обновить
            </button>
          </div>
        </div>

        {/* Фильтр по папкам */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button onClick={() => setFolderFilter(null)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${folderFilter === null ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>Все</button>
          <button onClick={() => setFolderFilter(0)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${folderFilter === 0 ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>Без папки</button>
          {folders.map(f => (
            <button key={f.id} onClick={() => setFolderFilter(f.id)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${folderFilter === f.id ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}>
              <Icon name="Folder" size={11} /> {f.name} <span className="opacity-60">{f.runs_count}</span>
            </button>
          ))}
        </div>

        {/* Панель действий над выбранными */}
        {selectMode && selectedIds.size > 0 && (
          <div className="mb-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <p className="mb-2 text-xs font-medium text-foreground">Выбрано: {selectedIds.size}</p>
            <div className="flex flex-wrap items-center gap-2">
              <select defaultValue="" onChange={e => { const v = e.target.value; if (v !== "") { assignToFolder(v === "none" ? null : Number(v)); e.target.value = "" } }}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground" style={{ cursor: "pointer" }}>
                <option value="" disabled>В папку…</option>
                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                <option value="none">— Убрать из папки</option>
              </select>
              <button onClick={clearSelection} className="text-xs text-foreground/50 hover:text-foreground" style={{ cursor: "pointer" }}>Сбросить</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
        ) : runs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-foreground/40">
            <Icon name="Activity" size={28} className="mx-auto mb-2 text-foreground/20" />
            Пока нет ни одного прогона.<br />Запустите тесты в приложении на ПК.
          </div>
        ) : (
          <div className="space-y-2">
            {runs
              .filter(r => folderFilter === null ? true : folderFilter === 0 ? !r.folder_id : r.folder_id === folderFilter)
              .map(r => {
              const checked = selectedIds.has(r.id)
              return (
              <div key={r.id}
                onClick={() => selectMode ? toggleSelect(r.id) : openRun(r.id)}
                className={`flex w-full items-start gap-2 rounded-xl border p-3 text-left transition-colors ${(selectMode ? checked : selected?.id === r.id) ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
                style={{ cursor: "pointer" }}>
                {selectMode && (
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {checked && <Icon name="Check" size={11} />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{r.machine_name || r.profile_name || `Прогон #${r.id}`}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${r.failed_tests > 0 ? "bg-red-500/15 text-red-400" : "bg-green-500/15 text-green-400"}`}>
                      {r.passed_tests}/{r.total_tests}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-foreground/40">
                    <Icon name="Clock" size={11} /> {fmtDate(r.created_at)}
                    {r.profile_name && <><span>·</span><span className="truncate">{r.profile_name}</span></>}
                    {r.folder_id && <><span>·</span><Icon name="Folder" size={10} /><span className="truncate">{folders.find(f => f.id === r.folder_id)?.name || "папка"}</span></>}
                  </div>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Детали прогона */}
      <div>
        {detailLoading ? (
          <div className="flex justify-center py-20"><div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
        ) : !selected ? (
          <div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-foreground/40">
            Выберите прогон слева, чтобы посмотреть результаты
          </div>
        ) : (
          <div>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{selected.machine_name || `Прогон #${selected.id}`}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/50">
                  {selected.profile_name && <span><Icon name="ListChecks" size={12} className="mr-1 inline" />{selected.profile_name}</span>}
                  {selected.os_info && <span><Icon name="Cpu" size={12} className="mr-1 inline" />{selected.os_info}</span>}
                  <span><Icon name="Calendar" size={12} className="mr-1 inline" />{fmtDate(selected.started_at)} → {fmtDate(selected.finished_at)}</span>
                </div>
                {selected.note && <p className="mt-2 max-w-xl rounded-lg bg-muted/50 p-2 text-xs text-foreground/60">{selected.note}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => openRunReport(selected as unknown as ReportRun, "compact")} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }} title="Компактный отчёт (PDF)">
                  <Icon name="FileText" size={13} /> Отчёт
                </button>
                <button onClick={() => openRunReport(selected as unknown as ReportRun, "detailed")} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }} title="Подробный отчёт (PDF)">
                  <Icon name="FileBarChart2" size={13} /> Подробный
                </button>
                {!isPartner && (
                  <button onClick={() => removeRun(selected.id)} className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Trash2" size={13} /> Удалить
                  </button>
                )}
              </div>
            </div>

            {/* Сводка */}
            <div className="mb-5 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-border bg-card p-3 text-center">
                <div className="text-2xl font-bold text-foreground">{selected.total_tests}</div>
                <div className="text-xs text-foreground/40">всего тестов</div>
              </div>
              <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-center">
                <div className="text-2xl font-bold text-green-400">{selected.passed_tests}</div>
                <div className="text-xs text-foreground/40">успешно</div>
              </div>
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-center">
                <div className="text-2xl font-bold text-red-400">{selected.failed_tests}</div>
                <div className="text-xs text-foreground/40">с ошибкой</div>
              </div>
            </div>

            {/* Метрики (датчики) с применением настроек из вкладки «Метрики».
                RAM-температуры (SPD) идут сюда же, в категорию «Память». */}
            {(() => {
              const prefMap = new Map(prefs.map(p => [prefId(p.metric_key, p.label_orig), p]))
              const items = (selected.metrics || [])
                .map(m => {
                  const pr = prefMap.get(prefId(m.key, m.label))
                  return {
                    m,
                    visible: pr ? pr.visible : true,
                    label: pr && pr.label_custom ? pr.label_custom : m.label,
                    category: pr ? pr.category : categoryOf(m.key),
                    order: pr ? pr.sort_order : 999,
                  }
                })
                .filter(x => x.visible)
                .filter(x => catFilter === "all" || x.category === catFilter)
                .sort((a, b) => a.order - b.order)
              if ((selected.metrics || []).length === 0) return null
              return (
                <div className="mb-5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground/40">
                      <Icon name="Activity" size={13} /> Датчики (min / сред / max)
                    </div>
                    {/* Фильтр по категориям */}
                    <div className="flex flex-wrap gap-1">
                      {[{ id: "all", label: "Все" }, ...CATEGORIES].map(c => (
                        <button key={c.id} onClick={() => setCatFilter(c.id)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${catFilter === c.id ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:text-foreground"}`}
                          style={{ cursor: "pointer" }}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {items.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-foreground/40">Нет метрик в этой категории.</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {items.map((x, i) => (
                        <div key={i}
                          onDoubleClick={() => { setHighlightMetric(prefId(x.m.key, x.m.label)); setView("metrics") }}
                          title="Двойной клик — настроить эту метрику"
                          className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50" style={{ cursor: "pointer" }}>
                          <div className="truncate text-[11px] text-foreground/40" title={x.label}>{x.label}</div>
                          <div className="mt-1 flex items-baseline gap-1">
                            <span className="text-xl font-bold text-foreground">{x.m.max ?? "—"}</span>
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
            })()}

            {/* Таблица результатов */}
            <div className="space-y-2">
              {(selected.results || []).map(t => (
                <div key={t.id} className={`rounded-xl border p-3 ${t.success ? "border-border bg-card" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon name={t.success ? "CircleCheck" : "CircleX"} size={16} className={t.success ? "text-green-400" : "text-red-400"} />
                      <span className="text-sm font-medium text-foreground">{testTitle(t.test_name || "Без названия", t.score_text)}</span>
                      {t.timed_out && <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] text-orange-400">таймаут</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-foreground/50">
                      <span>код: <b className={t.exit_code === 0 ? "text-green-400" : "text-foreground/70"}>{t.exit_code ?? "—"}</b></span>
                      <span>{fmtDur(t.duration_sec)}</span>
                    </div>
                  </div>
                  {t.command && <div className="mt-1.5 truncate font-mono text-[11px] text-foreground/40">{t.command}</div>}
                  {t.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {t.files.map((f, i) => (
                        <a key={i} href={f.file_url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
                          <Icon name="FileText" size={12} /> {f.file_name} <span className="text-foreground/30">{fmtSize(f.file_size)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
      )}
    </div>
  )
}