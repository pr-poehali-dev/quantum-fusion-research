import Icon from "@/components/ui/icon"
import { BatchItem, BATCH_STATUS } from "./types"

// ШАГ 2: распознавание одного счёта
export function ReceiptScanningStage({ imgPreview, jobId }: {
  imgPreview: string | null
  jobId: number | null
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      {imgPreview && <img src={imgPreview} alt="чек" className="max-h-48 rounded-lg border border-border object-contain" />}
      <Icon name="Loader" size={32} className="animate-spin text-primary" />
      <p className="text-sm text-foreground/60">Распознаём счёт... это занимает несколько секунд</p>
      <p className="text-xs text-foreground/40">Задача #{jobId} в очереди модели</p>
    </div>
  )
}

// ШАГ 2-batch: очередь из нескольких файлов
export default function ReceiptBatchStage({ batch, batchDone }: {
  batch: BatchItem[]
  batchDone: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground/70">
          Обработка {batch.length} файлов · готово {batchDone} из {batch.length}
        </p>
        <span className="text-xs text-foreground/40">Результаты сохраняются в черновики</span>
      </div>
      {batch.map(b => {
        const s = BATCH_STATUS[b.status]
        return (
          <div key={b.id} className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-3">
              <Icon name={b.name.toLowerCase().endsWith(".pdf") ? "FileText" : b.name.match(/\.xlsx?$/i) ? "Sheet" : "Image"}
                size={20} className="shrink-0 text-foreground/40" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{b.name}</span>
                  <span className={`flex shrink-0 items-center gap-1 text-xs font-medium ${s.cls}`}>
                    <Icon name={s.icon} size={13} className={b.status === "uploading" || b.status === "processing" ? "animate-spin" : ""} />
                    {s.label}{b.status === "done" && b.itemsCount != null ? ` · ${b.itemsCount} поз.` : ""}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div className={`h-full rounded-full transition-all ${b.status === "error" ? "bg-red-500" : b.status === "done" ? "bg-green-500" : "bg-primary"}`}
                    style={{ width: `${b.progress}%` }} />
                </div>
                {b.error && <p className="mt-1 text-[11px] text-red-400">{b.error}</p>}
              </div>
            </div>
          </div>
        )
      })}
      <p className="mt-1 text-center text-xs text-foreground/45">
        Готовые черновики появятся в списке приёмки — открой каждый, проверь и прими.
      </p>
    </div>
  )
}
