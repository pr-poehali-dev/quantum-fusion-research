// Общие типы и утилиты приёмки по счёту (ReceiptScanModal и его части).
export interface Store { id: number; name: string }
export interface Candidate { group_id: number; name: string; score: number }
// Элемент очереди пакетной загрузки счетов
export type BatchStatus = "pending" | "uploading" | "queued" | "processing" | "done" | "error"
export interface BatchItem {
  id: string
  name: string
  size: number
  progress: number          // 0..100 — этап загрузки/обработки
  status: BatchStatus
  jobId?: number
  draftId?: number
  itemsCount?: number       // сколько позиций распознано
  error?: string
}
export interface MatchRow {
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

// Настройка воркера (токен для .bat + статус очереди)
export interface WorkerCfg {
  token_set: boolean; bat_line: string; func_url: string
  queue: { new: number; processing: number; done: number; error: number }
  last_pull_at?: string | null
}

// Сжатие фото в браузере перед загрузкой
export function fileToCompressedDataUrl(file: File, maxSide = 1800): Promise<string> {
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

// Подписи/иконки статусов файла в очереди пакетной загрузки
export const BATCH_STATUS: Record<BatchStatus, { label: string; icon: string; cls: string }> = {
  pending:    { label: "в очереди",   icon: "Clock",       cls: "text-foreground/40" },
  uploading:  { label: "загрузка",    icon: "Loader",      cls: "text-blue-500" },
  queued:     { label: "отправлен",   icon: "Send",        cls: "text-amber-500" },
  processing: { label: "обработка",   icon: "Loader",      cls: "text-amber-500" },
  done:       { label: "обработан",   icon: "CheckCircle2",cls: "text-green-500" },
  error:      { label: "ошибка",      icon: "AlertCircle", cls: "text-red-500" },
}

export function levelColor(row: MatchRow): { cls: string; label: string } {
  if (row.skip) return { cls: "border-border bg-muted/40", label: "Пропущено" }
  if (row.group_id) return { cls: "border-green-500/40 bg-green-500/5", label: "Совпадение" }
  // group_id == null: жёлтый (есть похожие кандидаты) или красный (совсем нет)
  if (row.level === "fuzzy_mid" || (row.candidates && row.candidates.length > 0))
    return { cls: "border-yellow-500/40 bg-yellow-500/5", label: "Выберите товар" }
  return { cls: "border-red-500/40 bg-red-500/5", label: "Новый товар" }
}

export interface StoreMatch { store_id: number | null; store_name: string | null; store_hint: string | null }
// matched может прийти как массив (старый формат) или {store, rows} (новый)
export function normMatched(matched: unknown): { store: StoreMatch | null; rows: MatchRow[] } {
  if (Array.isArray(matched)) return { store: null, rows: matched as MatchRow[] }
  const m = (matched || {}) as { store?: StoreMatch; rows?: MatchRow[] }
  return { store: m.store ?? null, rows: m.rows ?? [] }
}
