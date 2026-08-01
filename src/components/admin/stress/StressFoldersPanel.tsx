import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { openFolderReportPrint, openFolderReportCompact, openFolderReportSuper, downloadFolderCSV, ReportFolder, ReportRun } from "@/components/admin/stress/folderReport"

export interface StressFolder {
  id: number
  name: string
  order_id: number | null
  order_ref: string
  note: string
  created_at: string
  runs_count: number
}

interface RunLite {
  id: number
  machine_name: string
  profile_name: string
  passed_tests: number
  total_tests: number
  failed_tests: number
  created_at: string
  started_at?: string | null
  finished_at?: string | null
  folder_id?: number | null
  folder_sort?: number
}

type SortMode = "manual" | "name" | "date" | "duration"

// Длительность прогона в секундах (для сортировки)
function runDuration(r: RunLite): number {
  if (!r.started_at || !r.finished_at) return 0
  const a = new Date(r.started_at).getTime()
  const b = new Date(r.finished_at).getTime()
  return b > a ? (b - a) / 1000 : 0
}

interface OrderLite { id: number; display_number: string; customer_name?: string; order_type?: string }

interface Props {
  adminKey: string
  session?: string | null
  isPartner?: boolean
  folders: StressFolder[]
  runs: RunLite[]
  onChanged: () => void
  onOpenRun: (id: number) => void
}

export default function StressFoldersPanel({ adminKey, session, isPartner = false, folders, runs, onChanged, onOpenRun }: Props) {
  const auth = isPartner ? { session } : undefined
  const [orders, setOrders] = useState<OrderLite[]>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftOrderId, setDraftOrderId] = useState("")
  const [busy, setBusy] = useState(false)
  const [reportBusy, setReportBusy] = useState<number | null>(null)
  // Режим сортировки прогонов внутри каждой папки
  const [sortMode, setSortMode] = useState<Record<number, SortMode>>({})
  // Локальный порядок прогонов (id) по папкам — для drag&drop и «ручного» режима
  const [orderMap, setOrderMap] = useState<Record<number, number[]>>({})
  const [dragId, setDragId] = useState<number | null>(null)

  // Чистая сортировка списка по режиму (без обращения к стейту)
  const sortRuns = (folderRuns: RunLite[], mode: SortMode, saved?: number[]): RunLite[] => {
    if (mode === "manual") {
      const base = [...folderRuns].sort((a, b) => (a.folder_sort ?? 0) - (b.folder_sort ?? 0))
      if (!saved) return base
      const byId = new Map(folderRuns.map(r => [r.id, r]))
      const out: RunLite[] = []
      for (const id of saved) { const r = byId.get(id); if (r) out.push(r) }
      for (const r of base) if (!saved.includes(r.id)) out.push(r)  // новые — в конец
      return out
    }
    const arr = [...folderRuns]
    if (mode === "name") arr.sort((a, b) => (a.machine_name || a.profile_name || "").localeCompare(b.machine_name || b.profile_name || "", "ru", { numeric: true, sensitivity: "base" }))
    else if (mode === "date") arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    else if (mode === "duration") arr.sort((a, b) => runDuration(b) - runDuration(a))
    return arr
  }

  // Упорядоченный список прогонов папки согласно ТЕКУЩЕМУ стейту
  const orderedRuns = (fid: number, folderRuns: RunLite[]): RunLite[] =>
    sortRuns(folderRuns, sortMode[fid] || "manual", orderMap[fid])

  // Сохранить текущий порядок папки на бэкенд (folder_sort = позиция)
  const persistOrder = async (fid: number, ids: number[]) => {
    await api.stress.folderReorder(fid, ids, adminKey, auth)
    onChanged()
  }

  // Применить выбранный режим сортировки: сразу считаем новый порядок по mode,
  // фиксируем его как ручной и сохраняем на бэке.
  const applySort = async (fid: number, folderRuns: RunLite[], mode: SortMode) => {
    if (mode === "manual") { setSortMode(m => ({ ...m, [fid]: "manual" })); return }
    const ids = sortRuns(folderRuns, mode).map(r => r.id)
    setOrderMap(m => ({ ...m, [fid]: ids }))
    setSortMode(m => ({ ...m, [fid]: "manual" }))
    await persistOrder(fid, ids)
  }

  // Drag&drop: бросили dragId на targetId — переставляем и сохраняем
  const onDrop = async (fid: number, folderRuns: RunLite[], targetId: number) => {
    if (dragId == null || dragId === targetId) { setDragId(null); return }
    const cur = orderedRuns(fid, folderRuns).map(r => r.id)
    const from = cur.indexOf(dragId)
    const to = cur.indexOf(targetId)
    if (from < 0 || to < 0) { setDragId(null); return }
    cur.splice(from, 1)
    cur.splice(to, 0, dragId)
    setDragId(null)
    setSortMode(m => ({ ...m, [fid]: "manual" }))
    setOrderMap(m => ({ ...m, [fid]: cur }))
    await persistOrder(fid, cur)
  }

  // Список реальных заказов для привязки папки (только в админке)
  useEffect(() => {
    if (isPartner) return
    api.orders.getAll().then(d => setOrders(d.orders || [])).catch(() => {})
  }, [isPartner])

  const createFolder = async () => {
    setBusy(true)
    const res = await api.stress.folderSave({ name: "Новая папка" }, adminKey, auth)
    setBusy(false)
    if (res.id) { onChanged(); startEdit({ id: res.id, name: "Новая папка", order_id: null, order_ref: "", note: "", created_at: "", runs_count: 0 }) }
  }

  const startEdit = (f: StressFolder) => {
    setEditId(f.id)
    setDraftName(f.name)
    setDraftOrderId(f.order_id ? String(f.order_id) : "")
  }

  const saveEdit = async () => {
    if (editId == null) return
    const order = orders.find(o => o.id === Number(draftOrderId))
    setBusy(true)
    await api.stress.folderSave({
      id: editId,
      name: draftName.trim() || "Без названия",
      order_id: draftOrderId ? Number(draftOrderId) : null,
      order_ref: order ? order.display_number : "",
    }, adminKey, auth)
    setBusy(false)
    setEditId(null)
    onChanged()
  }

  const removeFolder = async (f: StressFolder) => {
    if (!confirm(`Удалить папку «${f.name}»?\nПрогоны не удалятся — просто выйдут из папки.`)) return
    setBusy(true)
    await api.stress.folderDelete(f.id, adminKey, auth)
    setBusy(false)
    onChanged()
  }

  const buildReport = async (f: StressFolder, mode: "super" | "compact" | "detailed" | "csv") => {
    setReportBusy(f.id)
    const res = await api.stress.folderReport(f.id, adminKey, auth).catch(() => null)
    setReportBusy(null)
    if (!res?.folder) { alert("Не удалось получить данные папки"); return }
    const folder = res.folder as ReportFolder
    const rrs = (res.runs || []) as ReportRun[]
    if (mode === "super") {
      if (!(await openFolderReportSuper(folder, rrs))) alert("Разрешите всплывающие окна для печати")
    } else if (mode === "compact") {
      if (!(await openFolderReportCompact(folder, rrs))) alert("Разрешите всплывающие окна для печати")
    } else if (mode === "detailed") {
      if (!(await openFolderReportPrint(folder, rrs))) alert("Разрешите всплывающие окна для печати")
    } else {
      downloadFolderCSV(folder, rrs)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Папки прогонов</h2>
        <button onClick={createFolder} disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" style={{ cursor: "pointer" }}>
          <Icon name="FolderPlus" size={15} /> Новая папка
        </button>
      </div>

      {folders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-foreground/40">
          <Icon name="Folder" size={28} className="mx-auto mb-2 text-foreground/20" />
          Папок пока нет. Создайте папку и добавьте в неё прогоны из вкладки «Результаты» (режим «Выбрать»).
        </div>
      ) : (
        <div className="space-y-3">
          {folders.map(f => {
            const folderRuns = runs.filter(r => r.folder_id === f.id)
            const editing = editId === f.id
            return (
              <div key={f.id} className="rounded-xl border border-border bg-card p-4">
                {editing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs text-foreground/50">Название папки</label>
                      <input value={draftName} onChange={e => setDraftName(e.target.value)} autoFocus
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                    </div>
                    {!isPartner && (
                      <div>
                        <label className="mb-1 block text-xs text-foreground/50">Привязка к заказу (номинально)</label>
                        <select value={draftOrderId} onChange={e => setDraftOrderId(e.target.value)}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                          <option value="">— не привязано —</option>
                          {orders.map(o => (
                            <option key={o.id} value={o.id}>{o.display_number}{o.customer_name ? ` · ${o.customer_name}` : ""}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={saveEdit} disabled={busy}
                        className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" style={{ cursor: "pointer" }}>Сохранить</button>
                      <button onClick={() => setEditId(null)}
                        className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>Отмена</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon name="Folder" size={16} className="text-primary" />
                          <span className="truncate font-medium text-foreground">{f.name}</span>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground/50">{f.runs_count} прогонов</span>
                        </div>
                        {f.order_ref && (
                          <div className="mt-1 flex items-center gap-1 text-xs text-foreground/50">
                            <Icon name="Link" size={11} /> Заказ: <span className="font-mono">{f.order_ref}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => startEdit(f)} title="Редактировать"
                          className="rounded-lg border border-border p-1.5 text-foreground/50 hover:text-foreground" style={{ cursor: "pointer" }}>
                          <Icon name="Pencil" size={13} />
                        </button>
                        <button onClick={() => removeFolder(f)} title="Удалить папку"
                          className="rounded-lg border border-red-500/30 p-1.5 text-red-400 hover:bg-red-500/10" style={{ cursor: "pointer" }}>
                          <Icon name="Trash2" size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Отчёт по папке */}
                    <div className="mt-3 border-t border-border/50 pt-3">
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/40">Отчёт по папке</p>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => buildReport(f, "super")} disabled={reportBusy === f.id || f.runs_count === 0}
                          title="Только тесты с баллами, без датчиков и скриншотов. Тесты отсортированы по названию"
                          className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-40" style={{ cursor: "pointer" }}>
                          <Icon name={reportBusy === f.id ? "Loader" : "AlignJustify"} size={13} className={reportBusy === f.id ? "animate-spin" : ""} /> Суперкомпактный (PDF)
                        </button>
                        <button onClick={() => buildReport(f, "compact")} disabled={reportBusy === f.id || f.runs_count === 0}
                          title="Каждый прогон на отдельной странице: сводка, датчики и бенчмарки"
                          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground disabled:opacity-40" style={{ cursor: "pointer" }}>
                          <Icon name={reportBusy === f.id ? "Loader" : "LayoutList"} size={13} className={reportBusy === f.id ? "animate-spin" : ""} /> Компактный (PDF)
                        </button>
                        <button onClick={() => buildReport(f, "detailed")} disabled={reportBusy === f.id || f.runs_count === 0}
                          title="Все прогоны подряд одной таблицей датчиков"
                          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground disabled:opacity-40" style={{ cursor: "pointer" }}>
                          <Icon name="Printer" size={13} /> Подробный (PDF)
                        </button>
                        <button onClick={() => buildReport(f, "csv")} disabled={reportBusy === f.id || f.runs_count === 0}
                          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground disabled:opacity-40" style={{ cursor: "pointer" }}>
                          <Icon name="FileDown" size={13} /> Экспорт CSV
                        </button>
                      </div>
                    </div>

                    {/* Список прогонов в папке — с сортировкой и drag&drop.
                        Порядок здесь = порядок страниц в отчёте. */}
                    {folderRuns.length > 0 && (
                      <div className="mt-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-[11px] text-foreground/40">
                            Порядок = порядок в отчёте. Тяни за <Icon name="GripVertical" size={11} className="inline" /> чтобы переставить.
                          </p>
                          <select
                            value="__ph"
                            disabled={reportBusy === f.id}
                            onChange={e => { const v = e.target.value; if (v !== "__ph") applySort(f.id, folderRuns, v as SortMode) }}
                            className="shrink-0 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground/70 focus:border-primary focus:outline-none"
                            style={{ cursor: "pointer" }} title="Упорядочить прогоны">
                            <option value="__ph">Сортировать…</option>
                            <option value="name">По названию</option>
                            <option value="date">По дате (новые сверху)</option>
                            <option value="duration">По длительности</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          {orderedRuns(f.id, folderRuns).map((r, idx) => (
                            <div key={r.id}
                              draggable
                              onDragStart={() => setDragId(r.id)}
                              onDragOver={e => e.preventDefault()}
                              onDrop={() => onDrop(f.id, folderRuns, r.id)}
                              onDragEnd={() => setDragId(null)}
                              className={`flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5 text-xs transition-colors ${dragId === r.id ? "border-primary opacity-50" : "border-border/60 hover:border-primary/40"}`}>
                              <Icon name="GripVertical" size={13} className="shrink-0 cursor-grab text-foreground/30" />
                              <span className="w-5 shrink-0 text-center text-[10px] text-foreground/30">{idx + 1}</span>
                              <button onClick={() => onOpenRun(r.id)}
                                className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left" style={{ cursor: "pointer" }}>
                                <span className="truncate text-foreground/80">{r.machine_name || r.profile_name || `Прогон #${r.id}`}</span>
                                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r.failed_tests > 0 ? "bg-red-500/15 text-red-400" : "bg-green-500/15 text-green-400"}`}>{r.passed_tests}/{r.total_tests}</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}