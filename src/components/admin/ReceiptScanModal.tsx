import { useEffect, useRef, useState, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getAdminKey } from "@/pages/admin/types"

interface Store { id: number; name: string }
interface Candidate { group_id: number; name: string; score: number }
interface MatchRow {
  raw_name: string
  article?: string
  qty: number
  price: number
  group_id: number | null
  matched_name: string | null
  confidence: number
  level: string
  candidates: Candidate[]
  store_hint?: string | null
  qty_warn?: boolean        // кол-во подозрительно совпало с упаковкой из названия
  pack_size?: number | null
  // локальные поля приёмки
  warranty_until?: string
  accepted?: boolean
  skip?: boolean
}

// Сжатие фото в браузере перед загрузкой
function fileToCompressedDataUrl(file: File, maxSide = 1800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxSide || height > maxSide) {
          const k = maxSide / Math.max(width, height)
          width = Math.round(width * k); height = Math.round(height * k)
        }
        const canvas = document.createElement("canvas")
        canvas.width = width; canvas.height = height
        const ctx = canvas.getContext("2d")!
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL("image/jpeg", 0.9))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function levelColor(row: MatchRow): { cls: string; label: string } {
  if (row.skip) return { cls: "border-border bg-muted/40", label: "Пропущено" }
  if (row.group_id) return { cls: "border-green-500/40 bg-green-500/5", label: "Совпадение" }
  // group_id == null: жёлтый (есть похожие кандидаты) или красный (совсем нет)
  if (row.level === "fuzzy_mid" || (row.candidates && row.candidates.length > 0))
    return { cls: "border-yellow-500/40 bg-yellow-500/5", label: "Выберите товар" }
  return { cls: "border-red-500/40 bg-red-500/5", label: "Новый товар" }
}

interface StoreMatch { store_id: number | null; store_name: string | null; store_hint: string | null }
// matched может прийти как массив (старый формат) или {store, rows} (новый)
function normMatched(matched: unknown): { store: StoreMatch | null; rows: MatchRow[] } {
  if (Array.isArray(matched)) return { store: null, rows: matched as MatchRow[] }
  const m = (matched || {}) as { store?: StoreMatch; rows?: MatchRow[] }
  return { store: m.store ?? null, rows: m.rows ?? [] }
}

export default function ReceiptScanModal({ stores, draftId, onClose, onAccepted, onCreateProduct }: {
  stores: Store[]
  draftId?: number | null
  onClose: () => void
  onAccepted: () => void
  // вызывается когда нужно создать новый SKU; родитель сохраняет черновик и открывает мастер
  onCreateProduct: (rawName: string, draftId: number) => void
}) {
  const ak = getAdminKey()
  // stage: upload -> scanning -> review
  const [stage, setStage] = useState<"upload" | "scanning" | "review">("upload")
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const [jobId, setJobId] = useState<number | null>(null)
  const [curDraftId, setCurDraftId] = useState<number | null>(draftId || null)
  const [rows, setRows] = useState<MatchRow[]>([])
  const [storeId, setStoreId] = useState<number | null>(stores[0]?.id ?? null)
  const [storeHint, setStoreHint] = useState<string | null>(null)      // что распознала модель ("ДНС")
  const [storeAuto, setStoreAuto] = useState(false)                     // магазин подставлен автоматически
  const [vatMode, setVatMode] = useState<"with" | "without">("with")   // НДС / без НДС
  const [vatPercent, setVatPercent] = useState(20)                      // ставка НДС из настроек
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Поиск товара для ручного матча
  const [searchIdx, setSearchIdx] = useState<number | null>(null)
  const [searchQ, setSearchQ] = useState("")
  const [searchRes, setSearchRes] = useState<{ id: number; name: string }[]>([])

  // Настройка воркера (токен для .bat + статус очереди)
  interface WorkerCfg {
    token_set: boolean; bat_line: string; func_url: string
    queue: { new: number; processing: number; done: number; error: number }
    last_pull_at?: string | null
  }
  const [showWorker, setShowWorker] = useState(false)
  const [workerCfg, setWorkerCfg] = useState<WorkerCfg | null>(null)
  const [copied, setCopied] = useState(false)

  const openWorker = async () => {
    setShowWorker(true)
    const d = await api.receiptScan.workerConfig(ak)
    if (!d?.error) setWorkerCfg(d)
  }
  const copyBat = async () => {
    if (!workerCfg?.bat_line) return
    try { await navigator.clipboard.writeText(workerCfg.bat_line); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }

  // Загрузка существующего черновика (возврат после создания SKU)
  const loadDraft = useCallback(async (id: number) => {
    const d = await api.receiptScan.draftGet(id, ak)
    if (d?.rows) {
      setRows(d.rows)
      setStoreId(d.store_id ?? stores[0]?.id ?? null)
      setCurDraftId(id)
      // переподтянуть свежий матчинг (вдруг создали новый SKU)
      if (d.job_id) {
        const rm = await api.receiptScan.rematch(d.job_id, ak)
        const fresh = normMatched(rm?.matched)
        if (fresh.rows.length) {
          // мержим: сохраняем введённые qty/price/skip, но обновляем group_id если был null
          setRows(prev => prev.map((r, i) => {
            const f = fresh.rows[i]
            if (f && !r.group_id && f.group_id) return { ...r, ...f, qty: r.qty, price: r.price }
            return r
          }))
        }
        if (fresh.store?.store_hint) setStoreHint(fresh.store.store_hint)
      }
      setStage("review")
    }
  }, [ak, stores])

  useEffect(() => {
    if (draftId) loadDraft(draftId)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [draftId, loadDraft])

  // ставка НДС из настроек склада
  useEffect(() => {
    api.warehouse.getSettings().then(s => {
      const v = parseFloat(String(s?.vat_percent ?? "20"))
      if (!isNaN(v)) setVatPercent(v)
    }).catch(() => {})
  }, [])

  // читаем любой файл (Excel/PDF) как data-url без сжатия
  const fileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })

  const pickFile = async (file: File) => {
    setError("")
    setBusy(true)
    try {
      const name = file.name.toLowerCase()
      const isImage = file.type.startsWith("image/")
      let url = ""
      if (isImage) {
        const dataUrl = await fileToCompressedDataUrl(file)
        setImgPreview(dataUrl)
        const up = await api.upload.receipt(dataUrl)
        url = up?.url
      } else {
        // Excel / PDF — грузим как есть, без сжатия
        setImgPreview(null)
        const dataUrl = await fileToDataUrl(file)
        const up = await api.upload.receiptFile(dataUrl, false)
        url = up?.url
      }
      if (!url) { setError("Не удалось загрузить файл"); setBusy(false); return }
      const job = await api.receiptScan.createJob(url, ak)
      if (!job?.job_id) { setError(job?.error || "Ошибка создания задачи"); setBusy(false); return }
      setJobId(job.job_id)
      setStage("scanning")
      startPolling(job.job_id)
    } catch {
      setError("Ошибка обработки файла")
    } finally {
      setBusy(false)
    }
  }

  const startPolling = (jid: number) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const st = await api.receiptScan.jobStatus(jid, ak)
      if (st?.status === "DONE") {
        if (pollRef.current) clearInterval(pollRef.current)
        const m = normMatched(st.matched)
        const matched: MatchRow[] = m.rows.map(r => ({ ...r, warranty_until: "" }))
        setRows(matched)
        // авто-подстановка магазина из чека
        let useStore = storeId
        if (m.store?.store_id) { useStore = m.store.store_id; setStoreId(m.store.store_id); setStoreAuto(true) }
        setStoreHint(m.store?.store_hint ?? null)
        // создаём черновик сразу — чтобы при «новый товар» не потерять прогресс
        const dr = await api.receiptScan.draftSave({ job_id: jid, store_id: useStore, rows: matched }, ak)
        if (dr?.draft_id) setCurDraftId(dr.draft_id)
        setStage("review")
      } else if (st?.status === "ERROR") {
        if (pollRef.current) clearInterval(pollRef.current)
        setError(st.error || "Ошибка распознавания")
        setStage("upload")
      }
    }, 2500)
  }

  const updateRow = (i: number, patch: Partial<MatchRow>) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))

  const saveDraft = async (nextRows?: MatchRow[]) => {
    if (!curDraftId) return
    await api.receiptScan.draftSave({ draft_id: curDraftId, store_id: storeId, rows: nextRows || rows }, ak)
  }

  // Поиск товара для ручного сопоставления — по группам склада (нужен group_id)
  useEffect(() => {
    if (searchIdx === null || searchQ.trim().length < 2) { setSearchRes([]); return }
    const t = setTimeout(async () => {
      const d = await api.warehouse.getGroups({ search: searchQ.trim(), limit: "15", offset: "0" })
      const list = (d?.groups || []).map((g: { id: number; name: string }) => ({ id: g.id, name: g.name }))
      setSearchRes(list)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ, searchIdx])

  const applyManual = (i: number, gid: number, name: string) => {
    updateRow(i, { group_id: gid, matched_name: name, confidence: 100, level: "manual" })
    api.receiptScan.rememberMatch(rows[i].raw_name, gid, ak)
    setSearchIdx(null); setSearchQ(""); setSearchRes([])
  }

  const createNew = async (i: number) => {
    if (!curDraftId) { setError("Черновик не готов"); return }
    await saveDraft()
    onCreateProduct(rows[i].raw_name, curDraftId)
  }

  // Приёмка всех сопоставленных позиций
  const acceptAll = async () => {
    const toAccept = rows.filter(r => !r.skip && r.group_id)
    if (!toAccept.length) { setError("Нет позиций для приёмки"); return }
    if (!storeId) { setError("Выберите магазин"); return }
    const unresolved = rows.filter(r => !r.skip && !r.group_id)
    if (unresolved.length && !confirm(`${unresolved.length} позиц. без товара будут пропущены. Принять остальные?`)) return
    setBusy(true)
    // цена в чеке указана с НДС. Если выбрано «без НДС» — выделяем чистую себестоимость.
    const vatK = vatMode === "without" ? (1 + vatPercent / 100) : 1
    let ok = 0
    for (const r of toAccept) {
      const cost = vatK > 1 ? Math.round((r.price / vatK) * 100) / 100 : r.price
      const res = await api.warehouse.createSupply({
        group_id: r.group_id, store_id: storeId, qty: r.qty,
        cost_price: cost, purchase_date: new Date().toISOString().substring(0, 10),
        warranty_until: r.warranty_until || "",
      })
      if (!res?.error) ok++
    }
    setBusy(false)
    if (curDraftId) await api.receiptScan.draftClose(curDraftId, "DONE", ak)
    alert(`Принято партий: ${ok} из ${toAccept.length}`)
    onAccepted()
    onClose()
  }

  const closeAndSave = async () => {
    await saveDraft()
    onClose()
  }

  // зелёные — товар подставлен; жёлтые — есть похожие, нужен выбор; красные — совсем новые
  const greenCount = rows.filter(r => r.group_id && !r.skip).length
  const yellowCount = rows.filter(r => !r.group_id && !r.skip && (r.level === "fuzzy_mid" || (r.candidates && r.candidates.length > 0))).length
  const redCount = rows.filter(r => !r.group_id && !r.skip && r.level !== "fuzzy_mid" && !(r.candidates && r.candidates.length > 0)).length
  const qtyWarnCount = rows.filter(r => r.qty_warn && !r.skip).length
  // Итоговая сумма счёта: сумма (цена × кол-во) по всем непропущенным позициям
  const invoiceTotal = rows.filter(r => !r.skip)
    .reduce((sum, r) => sum + (Number(r.price) || 0) * (Number(r.qty) || 0), 0)
  const fmtMoney = (n: number) =>
    n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={stage === "review" ? closeAndSave : onClose}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="ScanLine" size={20} className="text-primary" />
            Приёмка по счёту
          </h2>
          <button onClick={stage === "review" ? closeAndSave : onClose} style={{ cursor: "pointer" }}>
            <Icon name="X" size={18} className="text-foreground/40 hover:text-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
          )}

          {/* ШАГ 1: загрузка */}
          {stage === "upload" && (
            <div className="flex flex-col items-center gap-4 py-10">
              <input ref={fileRef} type="file"
                accept="image/*,.pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ cursor: "pointer" }}
                className="flex h-44 w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50">
                <Icon name={busy ? "Loader" : "Upload"} size={40} className={busy ? "animate-spin" : ""} />
                <span className="text-sm font-medium">{busy ? "Загрузка..." : "Выбрать или сфотографировать счёт"}</span>
                <span className="text-xs text-foreground/40">Фото (JPG/PNG), PDF или Excel (XLSX/XLS)</span>
              </button>
              <p className="max-w-md text-center text-xs text-foreground/50">
                Модель распознает позиции и подставит товары со склада. Перед приёмкой можно всё проверить и поправить.
              </p>

              {/* Настройка воркера распознавания */}
              <button onClick={openWorker} style={{ cursor: "pointer" }}
                className="flex items-center gap-1.5 text-xs text-foreground/50 hover:text-primary transition-colors">
                <Icon name="Settings" size={13} /> Настройка воркера распознавания
              </button>

              {showWorker && (
                <div className="w-full max-w-md rounded-xl border border-border bg-muted/30 p-4 text-sm">
                  {!workerCfg ? (
                    <div className="flex items-center gap-2 text-foreground/50">
                      <Icon name="Loader" size={14} className="animate-spin" /> Загрузка...
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 flex items-center gap-2">
                        <Icon name={workerCfg.token_set ? "CheckCircle2" : "AlertCircle"} size={16}
                          className={workerCfg.token_set ? "text-green-500" : "text-amber-500"} />
                        <span className={workerCfg.token_set ? "text-green-500" : "text-amber-500"}>
                          {workerCfg.token_set ? "Токен задан" : "Токен не задан в секретах проекта"}
                        </span>
                      </div>

                      <p className="mb-1 text-xs text-foreground/50">
                        Вставь эту строку в файл <b>start_worker_3b.bat</b> (или 7b):
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 select-all break-all rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs">
                          {workerCfg.bat_line}
                        </code>
                        <Button size="sm" variant="outline" onClick={copyBat} className="shrink-0">
                          <Icon name={copied ? "Check" : "Copy"} size={14} />
                        </Button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-md bg-blue-500/10 px-2 py-1 text-blue-500">В очереди: {workerCfg.queue.new}</span>
                        <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-500">В работе: {workerCfg.queue.processing}</span>
                        <span className="rounded-md bg-green-500/10 px-2 py-1 text-green-500">Готово: {workerCfg.queue.done}</span>
                        {workerCfg.queue.error > 0 && (
                          <span className="rounded-md bg-red-500/10 px-2 py-1 text-red-500">Ошибки: {workerCfg.queue.error}</span>
                        )}
                      </div>
                      {workerCfg.last_pull_at && (
                        <p className="mt-2 text-[11px] text-foreground/40">
                          Воркер последний раз брал задачу: {new Date(workerCfg.last_pull_at).toLocaleString("ru-RU")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ШАГ 2: распознавание */}
          {stage === "scanning" && (
            <div className="flex flex-col items-center gap-4 py-12">
              {imgPreview && <img src={imgPreview} alt="чек" className="max-h-48 rounded-lg border border-border object-contain" />}
              <Icon name="Loader" size={32} className="animate-spin text-primary" />
              <p className="text-sm text-foreground/60">Распознаём счёт... это занимает несколько секунд</p>
              <p className="text-xs text-foreground/40">Задача #{jobId} в очереди модели</p>
            </div>
          )}

          {/* ШАГ 3: сверка */}
          {stage === "review" && (
            <>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                {/* Магазин — с акцентом, если подставлен автоматически */}
                <div className={storeAuto ? "rounded-lg border-2 border-amber-400/60 bg-amber-400/10 p-2" : ""}>
                  <label className="mb-1 flex items-center gap-1 text-xs text-foreground/50">
                    Магазин / площадка
                    {storeAuto && <span className="flex items-center gap-0.5 font-medium text-amber-600"><Icon name="Sparkles" size={11} /> проверьте!</span>}
                  </label>
                  <select value={storeId ?? ""} onChange={e => { setStoreId(Number(e.target.value)); setStoreAuto(false) }}
                    className={`rounded-lg border bg-background px-3 py-2 text-sm ${storeAuto ? "border-amber-400/60" : "border-border"}`} style={{ cursor: "pointer" }}>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {storeHint && (
                    <p className="mt-1 text-[11px] text-foreground/45">в чеке: «{storeHint}»</p>
                  )}
                </div>

                {/* Переключатель НДС */}
                <div>
                  <label className="mb-1 block text-xs text-foreground/50">Цены в счёте</label>
                  <div className="inline-flex overflow-hidden rounded-lg border border-border">
                    <button onClick={() => setVatMode("with")} style={{ cursor: "pointer" }}
                      className={`px-3 py-2 text-sm ${vatMode === "with" ? "bg-primary text-primary-foreground" : "bg-background text-foreground/60 hover:bg-muted"}`}>
                      С НДС
                    </button>
                    <button onClick={() => setVatMode("without")} style={{ cursor: "pointer" }}
                      className={`px-3 py-2 text-sm ${vatMode === "without" ? "bg-primary text-primary-foreground" : "bg-background text-foreground/60 hover:bg-muted"}`}>
                      Без НДС
                    </button>
                  </div>
                  {vatMode === "without" && (
                    <p className="mt-1 text-[11px] text-foreground/45">себестоимость = цена ÷ {(1 + vatPercent / 100).toFixed(2)}</p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 self-end text-xs">
                  <span className="rounded-full bg-green-500/15 px-2.5 py-1 text-green-500">🟢 {greenCount} совпало</span>
                  <span className="rounded-full bg-yellow-500/15 px-2.5 py-1 text-yellow-600">🟡 {yellowCount} выбрать</span>
                  <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-red-400">🔴 {redCount} новых</span>
                  {qtyWarnCount > 0 && (
                    <span className="rounded-full bg-orange-500/15 px-2.5 py-1 text-orange-500">⚠ {qtyWarnCount} проверить кол-во</span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {rows.map((row, i) => {
                  const lc = levelColor(row)
                  return (
                    <div key={i} className={`rounded-xl border p-3 ${lc.cls}`}>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-foreground/40">{lc.label} · из чека:</p>
                          <p className="truncate text-sm font-medium">{row.raw_name}</p>
                          {row.group_id ? (
                            <p className="mt-0.5 flex items-center gap-1 text-sm text-foreground/70">
                              <Icon name="ArrowRight" size={12} className="text-foreground/30" />
                              {row.matched_name}
                              <span className="text-xs text-foreground/40">({Math.round(row.confidence)}%)</span>
                            </p>
                          ) : (row.level === "fuzzy_mid" || (row.candidates && row.candidates.length > 0)) ? (
                            <p className="mt-0.5 text-sm text-yellow-600">
                              есть похожие — выберите нужный ниже ({Math.round(row.confidence)}%)
                            </p>
                          ) : (
                            <p className="mt-0.5 text-sm text-red-400/80">нет товара на складе</p>
                          )}
                          {row.qty_warn && (
                            <p className="mt-1 text-[11px] text-orange-500">
                              ⚠ в названии «{row.pack_size} шт/кор» — проверьте реальное количество к приёмке
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div>
                            <label className={`block text-[10px] ${row.qty_warn ? "text-orange-500 font-medium" : "text-foreground/40"}`}>
                              кол-во {row.qty_warn && "⚠"}
                            </label>
                            <Input type="number" min={1} value={row.qty}
                              className={`h-8 w-16 text-sm ${row.qty_warn ? "border-orange-500 ring-1 ring-orange-500/40" : ""}`}
                              title={row.qty_warn ? `Проверьте! В названии указана упаковка ${row.pack_size} шт — возможно, это не реальное количество` : undefined}
                              onChange={e => updateRow(i, { qty: Math.max(1, parseInt(e.target.value) || 1), qty_warn: false })} />
                          </div>
                          <div>
                            <label className="block text-[10px] text-foreground/40">цена ₽</label>
                            <Input type="number" min={0} value={row.price} className="h-8 w-24 text-sm"
                              onChange={e => updateRow(i, { price: Math.max(0, parseFloat(e.target.value) || 0) })} />
                          </div>
                          <button onClick={() => updateRow(i, { skip: !row.skip })} title={row.skip ? "Вернуть" : "Пропустить"}
                            style={{ cursor: "pointer" }}
                            className={`mt-3 rounded-lg border px-2 py-1.5 ${row.skip ? "border-primary text-primary" : "border-border text-foreground/40 hover:text-foreground"}`}>
                            <Icon name={row.skip ? "Undo2" : "EyeOff"} size={14} />
                          </button>
                        </div>
                      </div>

                      {/* действия для спорных/новых */}
                      {!row.skip && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {/* кандидаты-подсказки */}
                          {row.candidates?.slice(0, 3).map(c => c.group_id !== row.group_id && (
                            <button key={c.group_id} onClick={() => applyManual(i, c.group_id, c.name)} style={{ cursor: "pointer" }}
                              className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors">
                              {c.name} <span className="text-foreground/30">{Math.round(c.score)}%</span>
                            </button>
                          ))}
                          <button onClick={() => { setSearchIdx(searchIdx === i ? null : i); setSearchQ(row.raw_name) }}
                            style={{ cursor: "pointer" }}
                            className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors">
                            <Icon name="Search" size={11} className="mr-1 inline" />Выбрать из существующих
                          </button>
                          {/* Создать новую группу товаров — доступно в любой строке */}
                          <button onClick={() => createNew(i)} style={{ cursor: "pointer" }}
                            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${row.group_id
                              ? "border-border text-foreground/60 hover:border-primary hover:text-primary"
                              : "border-red-400/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"}`}>
                            <Icon name="Plus" size={11} className="mr-1 inline" />Создать новую группу
                          </button>
                        </div>
                      )}

                      {/* инлайн-поиск */}
                      {searchIdx === i && (
                        <div className="mt-2 rounded-lg border border-primary/20 bg-background p-2">
                          <Input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                            placeholder="Поиск товара на складе..." className="h-8 text-sm" />
                          {searchRes.length > 0 && (
                            <div className="mt-1 max-h-40 overflow-auto">
                              {searchRes.map(p => (
                                <button key={p.id} onClick={() => applyManual(i, p.id, p.name)}
                                  style={{ cursor: "pointer" }}
                                  className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                                  {p.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Футер */}
        {stage === "review" && (
          <div className="flex items-center justify-between gap-3 border-t border-border p-4">
            <button onClick={closeAndSave} style={{ cursor: "pointer" }}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:text-foreground transition-colors">
              Сохранить черновик и закрыть
            </button>
            <div className="flex items-center gap-4">
              <div className="text-right leading-tight">
                <div className="text-[11px] uppercase tracking-wide text-foreground/40">Сумма счёта</div>
                <div className="text-base font-semibold tabular-nums text-foreground">{fmtMoney(invoiceTotal)} ₽</div>
              </div>
              <Button onClick={acceptAll} disabled={busy}>
                <Icon name={busy ? "Loader" : "PackageCheck"} size={15} className={`mr-1.5 ${busy ? "animate-spin" : ""}`} />
                {busy ? "Принимаю..." : `Принять (${greenCount + yellowCount})`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}