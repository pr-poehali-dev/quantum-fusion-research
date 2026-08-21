import { useEffect, useRef, useState, useCallback } from "react"
import { api } from "@/lib/api"
import { getAdminKey } from "@/pages/admin/constants"
import {
  BatchItem, MatchRow, Store, WorkerCfg,
  fileToCompressedDataUrl, normMatched,
} from "./types"

// Вся логика приёмки по счёту: загрузка файлов, опрос воркера, черновики,
// ручное сопоставление и приёмка партий. Вынесено из ReceiptScanModal 1:1.
export function useReceiptScan({ stores, draftId, onClose, onAccepted, onCreateProduct }: {
  stores: Store[]
  draftId?: number | null
  onClose: () => void
  onAccepted: () => void
  onCreateProduct: (rawName: string, draftId: number) => void
}) {
  const ak = getAdminKey()
  // stage: upload -> scanning -> review -> batch (очередь из нескольких файлов)
  const [stage, setStage] = useState<"upload" | "scanning" | "review" | "batch">("upload")
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // Очередь пакетной загрузки (2-20 файлов)
  const [batch, setBatch] = useState<BatchItem[]>([])
  const batchPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const batchDoneJobs = useRef<Set<number>>(new Set())  // защита от двойного сохранения черновика
  // последовательная обработка пачки: храним файлы и индекс следующего к отправке
  const batchFilesRef = useRef<{ item: BatchItem; file: File }[]>([])
  const batchNextRef = useRef(0)
  const batchStepRef = useRef(0)  // шаг бэкоффа опроса (10→15→20с)
  const batchRef = useRef<BatchItem[]>([])  // актуальный batch для опроса (без пересоздания таймера)
  const [jobId, setJobId] = useState<number | null>(null)
  const [curDraftId, setCurDraftId] = useState<number | null>(draftId || null)
  const [rows, setRows] = useState<MatchRow[]>([])
  const [storeId, setStoreId] = useState<number | null>(stores[0]?.id ?? null)
  const [storeHint, setStoreHint] = useState<string | null>(null)      // что распознала модель ("ДНС")
  const [storeAuto, setStoreAuto] = useState(false)                     // магазин подставлен автоматически
  const [vatMode, setVatMode] = useState<"with" | "without">("with")   // товар с НДС / без НДС
  const [vatPercent, setVatPercent] = useState(20)                      // ставка НДС из настроек
  const [purchaseDiscount, setPurchaseDiscount] = useState(0)           // скидка закупки для НДС-товаров, %
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Поиск товара для ручного матча
  const [searchIdx, setSearchIdx] = useState<number | null>(null)
  const [searchQ, setSearchQ] = useState("")
  const [searchRes, setSearchRes] = useState<{ id: number; name: string }[]>([])

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
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
      if (batchPollRef.current) clearTimeout(batchPollRef.current)
    }
  }, [draftId, loadDraft])

  // ставка НДС и скидка закупки из настроек склада
  useEffect(() => {
    api.warehouse.getSettings().then(s => {
      const v = parseFloat(String(s?.vat_percent ?? "20"))
      if (!isNaN(v)) setVatPercent(v)
      const d = parseFloat(String(s?.purchase_discount_percent ?? "0"))
      if (!isNaN(d)) setPurchaseDiscount(d)
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

  // Опрос статуса: первые 10с не спрашиваем — счёт всё равно ещё генерируется.
  // Дальше опрашиваем каждые 10с, при затяжном распознавании — реже. Шаги (мс):
  const POLL_STEPS = [10000, 10000, 10000, 15000, 20000]
  const startPolling = (jid: number) => {
    if (pollRef.current) clearTimeout(pollRef.current)
    let step = 0
    const tick = async () => {
      // вкладка свёрнута — воркер всё равно работает, не дёргаем сервер впустую
      if (document.hidden) {
        pollRef.current = setTimeout(tick, 3000)
        return
      }
      const st = await api.receiptScan.jobStatus(jid, ak)
      if (st?.status === "DONE") {
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
        return
      }
      if (st?.status === "ERROR") {
        setError(st.error || "Ошибка распознавания")
        setStage("upload")
        return
      }
      const delay = POLL_STEPS[Math.min(step, POLL_STEPS.length - 1)]
      step++
      pollRef.current = setTimeout(tick, delay)
    }
    pollRef.current = setTimeout(tick, POLL_STEPS[0])
  }

  // ── ПАКЕТНАЯ загрузка (2-20 файлов) ───────────────────────────────
  const MAX_BATCH = 20

  const patchBatch = (id: string, patch: Partial<BatchItem>) =>
    setBatch(prev => {
      const next = prev.map(b => b.id === id ? { ...b, ...patch } : b)
      batchRef.current = next
      return next
    })

  // загрузка одного файла очереди -> создание job (без открытия review)
  const uploadBatchItem = async (item: BatchItem, file: File) => {
    try {
      patchBatch(item.id, { status: "uploading", progress: 15 })
      const isImage = file.type.startsWith("image/")
      let url = ""
      if (isImage) {
        const dataUrl = await fileToCompressedDataUrl(file)
        const up = await api.upload.receipt(dataUrl)
        url = up?.url
      } else {
        const dataUrl = await fileToDataUrl(file)
        const up = await api.upload.receiptFile(dataUrl, false)
        url = up?.url
      }
      if (!url) { patchBatch(item.id, { status: "error", error: "не загрузился", progress: 100 }); return }
      patchBatch(item.id, { progress: 45 })
      const job = await api.receiptScan.createJob(url, ak)
      if (!job?.job_id) { patchBatch(item.id, { status: "error", error: job?.error || "ошибка задачи", progress: 100 }); return }
      patchBatch(item.id, { status: "queued", jobId: job.job_id, progress: 55 })
    } catch {
      patchBatch(item.id, { status: "error", error: "ошибка файла", progress: 100 })
    }
  }

  // отправить на обработку СЛЕДУЮЩИЙ счёт из очереди (по одному за раз)
  const uploadNextBatch = async () => {
    const idx = batchNextRef.current
    const list = batchFilesRef.current
    if (idx >= list.length) return        // вся пачка отправлена
    batchNextRef.current = idx + 1
    batchStepRef.current = 0              // сбрасываем бэкофф для нового счёта
    const { item, file } = list[idx]
    await uploadBatchItem(item, file)
  }

  // запуск пакетной обработки: счета обрабатываем ПО ОЧЕРЕДИ —
  // следующий отправляется только после готовности предыдущего.
  const startBatch = async (files: File[]) => {
    setError("")
    const items: BatchItem[] = files.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      name: f.name, size: f.size, progress: 0, status: "pending",
    }))
    setBatch(items)
    batchRef.current = items
    setStage("batch")
    batchFilesRef.current = items.map((it, i) => ({ item: it, file: files[i] }))
    batchNextRef.current = 0
    batchStepRef.current = 0
    // отправляем только первый — остальные подхватятся по мере готовности
    await uploadNextBatch()
  }

  // Опрос статусов в batch: счета идут ПО ОЧЕРЕДИ, поэтому активна максимум
  // одна задача. Бэкофф 10→15→20с. После готовности/ошибки — отправляем следующий.
  const BATCH_POLL_STEPS = [10000, 10000, 15000, 20000]
  useEffect(() => {
    if (stage !== "batch") return
    if (batchPollRef.current) clearTimeout(batchPollRef.current)
    let stopped = false

    const schedule = () => {
      const delay = BATCH_POLL_STEPS[Math.min(batchStepRef.current, BATCH_POLL_STEPS.length - 1)]
      batchStepRef.current++
      batchPollRef.current = setTimeout(tick, delay)
    }

    const tick = async () => {
      if (stopped) return
      // вкладка свёрнута — не опрашиваем, воркер продолжит сам
      if (document.hidden) { schedule(); return }
      const active = batchRef.current.filter(b => (b.status === "queued" || b.status === "processing") && b.jobId)
      if (!active.length) {
        // активных нет: если ещё остались неотправленные — отправляем следующий
        if (batchNextRef.current < batchFilesRef.current.length) { await uploadNextBatch(); schedule() }
        return  // всё обработано — таймер не перезапускаем
      }
      // один запрос статуса (по сути на одну активную задачу)
      const res = await api.receiptScan.jobsStatus(active.map(b => b.jobId!), ak)
      const byId = new Map<number, { status: string; matched: unknown; error?: string }>(
        (res?.jobs || []).map((j: { job_id: number; status: string; matched: unknown; error?: string }) => [j.job_id, j])
      )
      let finishedOne = false
      for (const b of active) {
        const st = byId.get(b.jobId!)
        if (!st) continue
        if (st.status === "PROCESSING") {
          patchBatch(b.id, { status: "processing", progress: 75 })
        } else if (st.status === "DONE") {
          if (batchDoneJobs.current.has(b.jobId!)) continue  // уже сохранён — не дублируем
          batchDoneJobs.current.add(b.jobId!)
          const m = normMatched(st.matched)
          const matched: MatchRow[] = m.rows.map(r => ({ ...r, warranty_until: "" }))
          const useStore = m.store?.store_id ?? storeId
          // любой результат воркера складываем в черновик
          const dr = await api.receiptScan.draftSave({ job_id: b.jobId, store_id: useStore, rows: matched }, ak)
          patchBatch(b.id, { status: "done", progress: 100, itemsCount: matched.length, draftId: dr?.draft_id })
          finishedOne = true
        } else if (st.status === "ERROR") {
          patchBatch(b.id, { status: "error", progress: 100, error: st.error || "ошибка распознавания" })
          finishedOne = true
        }
      }
      // текущий счёт завершился — запускаем следующий из очереди
      if (finishedOne && batchNextRef.current < batchFilesRef.current.length) {
        await uploadNextBatch()
      }
      schedule()
    }

    batchStepRef.current = 0
    schedule()
    return () => { stopped = true; if (batchPollRef.current) clearTimeout(batchPollRef.current) }
  }, [stage, ak, storeId])

  // общий вход выбора файлов: 1 файл -> обычный поток, 2+ -> очередь
  const handleFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList).slice(0, MAX_BATCH)
    if (!files.length) return
    if (files.length === 1) { pickFile(files[0]); return }
    startBatch(files)
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
    // Товар с НДС: сохраняем цену из счёта как price_with_vat, а заход (cost_price)
    // бэкенд посчитает сам = цена × (1 − скидка закупки). При клике на заход
    // в складе покажем именно цену из счёта.
    // Товар без НДС: заход = цена из счёта как есть, скидка не применяется.
    const hasVat = vatMode === "with"
    let ok = 0
    for (const r of toAccept) {
      const res = await api.warehouse.createSupply({
        group_id: r.group_id, store_id: storeId, qty: r.qty,
        has_vat: hasVat,
        price_with_vat: r.price,
        purchase_date: new Date().toISOString().substring(0, 10),
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
  const batchDone = batch.filter(b => b.status === "done" || b.status === "error").length
  // Итоговая сумма счёта: сумма (цена × кол-во) по всем непропущенным позициям
  const invoiceTotal = rows.filter(r => !r.skip)
    .reduce((sum, r) => sum + (Number(r.price) || 0) * (Number(r.qty) || 0), 0)
  const fmtMoney = (n: number) =>
    n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return {
    stage, imgPreview, dragOver, setDragOver, batch, jobId,
    rows, storeId, setStoreId, storeHint, storeAuto, setStoreAuto,
    vatMode, setVatMode, vatPercent, purchaseDiscount,
    error, busy, fileRef,
    searchIdx, setSearchIdx, searchQ, setSearchQ, searchRes,
    showWorker, workerCfg, copied, openWorker, copyBat,
    handleFiles, updateRow, applyManual, createNew, acceptAll, closeAndSave,
    greenCount, yellowCount, redCount, qtyWarnCount, batchDone,
    invoiceTotal, fmtMoney,
  }
}
