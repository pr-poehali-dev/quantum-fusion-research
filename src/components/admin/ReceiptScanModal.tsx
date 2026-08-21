import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Store } from "./receipt-scan/types"
import { useReceiptScan } from "./receipt-scan/useReceiptScan"
import ReceiptUploadStage from "./receipt-scan/ReceiptUploadStage"
import ReceiptBatchStage, { ReceiptScanningStage } from "./receipt-scan/ReceiptBatchStage"
import ReceiptReviewStage from "./receipt-scan/ReceiptReviewStage"

export default function ReceiptScanModal({ stores, draftId, onClose, onAccepted, onCreateProduct }: {
  stores: Store[]
  draftId?: number | null
  onClose: () => void
  onAccepted: () => void
  // вызывается когда нужно создать новый SKU; родитель сохраняет черновик и открывает мастер
  onCreateProduct: (rawName: string, draftId: number) => void
}) {
  const s = useReceiptScan({ stores, draftId, onClose, onAccepted, onCreateProduct })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={s.stage === "review" ? s.closeAndSave : s.stage === "batch" ? undefined : onClose}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="ScanLine" size={20} className="text-primary" />
            Приёмка по счёту
          </h2>
          <button onClick={s.stage === "review" ? s.closeAndSave : onClose} style={{ cursor: "pointer" }}>
            <Icon name="X" size={18} className="text-foreground/40 hover:text-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {s.error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{s.error}</div>
          )}

          {/* ШАГ 1: загрузка */}
          {s.stage === "upload" && (
            <ReceiptUploadStage
              fileRef={s.fileRef} busy={s.busy} dragOver={s.dragOver} setDragOver={s.setDragOver}
              handleFiles={s.handleFiles} openWorker={s.openWorker} showWorker={s.showWorker}
              workerCfg={s.workerCfg} copyBat={s.copyBat} copied={s.copied} />
          )}

          {/* ШАГ 2: распознавание */}
          {s.stage === "scanning" && (
            <ReceiptScanningStage imgPreview={s.imgPreview} jobId={s.jobId} />
          )}

          {/* ШАГ 2-batch: очередь из нескольких файлов */}
          {s.stage === "batch" && (
            <ReceiptBatchStage batch={s.batch} batchDone={s.batchDone} />
          )}

          {/* ШАГ 3: сверка */}
          {s.stage === "review" && (
            <ReceiptReviewStage
              stores={stores} storeId={s.storeId} setStoreId={s.setStoreId}
              storeAuto={s.storeAuto} setStoreAuto={s.setStoreAuto} storeHint={s.storeHint}
              vatMode={s.vatMode} setVatMode={s.setVatMode} purchaseDiscount={s.purchaseDiscount}
              greenCount={s.greenCount} yellowCount={s.yellowCount} redCount={s.redCount}
              qtyWarnCount={s.qtyWarnCount}
              rows={s.rows} updateRow={s.updateRow} applyManual={s.applyManual} createNew={s.createNew}
              searchIdx={s.searchIdx} setSearchIdx={s.setSearchIdx}
              searchQ={s.searchQ} setSearchQ={s.setSearchQ} searchRes={s.searchRes} />
          )}
        </div>

        {/* Футер */}
        {s.stage === "review" && (
          <div className="flex items-center justify-between gap-3 border-t border-border p-4">
            <button onClick={s.closeAndSave} style={{ cursor: "pointer" }}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:text-foreground transition-colors">
              Сохранить черновик и закрыть
            </button>
            <div className="flex items-center gap-4">
              <div className="text-right leading-tight">
                <div className="text-[11px] uppercase tracking-wide text-foreground/40">Сумма счёта</div>
                <div className="text-base font-semibold tabular-nums text-foreground">{s.fmtMoney(s.invoiceTotal)} ₽</div>
              </div>
              <Button onClick={s.acceptAll} disabled={s.busy}>
                <Icon name={s.busy ? "Loader" : "PackageCheck"} size={15} className={`mr-1.5 ${s.busy ? "animate-spin" : ""}`} />
                {s.busy ? "Принимаю..." : `Принять (${s.greenCount + s.yellowCount})`}
              </Button>
            </div>
          </div>
        )}

        {/* Футер batch */}
        {s.stage === "batch" && (
          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <Button onClick={() => { onAccepted(); onClose() }} disabled={s.batchDone < s.batch.length}>
              <Icon name={s.batchDone < s.batch.length ? "Loader" : "Check"} size={15}
                className={`mr-1.5 ${s.batchDone < s.batch.length ? "animate-spin" : ""}`} />
              {s.batchDone < s.batch.length ? `Обработано ${s.batchDone}/${s.batch.length}...` : "Готово — к черновикам"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
