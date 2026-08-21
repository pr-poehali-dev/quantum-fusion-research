import { RefObject } from "react"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { WorkerCfg } from "./types"

// ШАГ 1: загрузка файлов + настройка воркера распознавания
export default function ReceiptUploadStage({
  fileRef, busy, dragOver, setDragOver, handleFiles,
  openWorker, showWorker, workerCfg, copyBat, copied,
}: {
  fileRef: RefObject<HTMLInputElement>
  busy: boolean
  dragOver: boolean
  setDragOver: (v: boolean) => void
  handleFiles: (files: FileList | File[]) => void
  openWorker: () => void
  showWorker: boolean
  workerCfg: WorkerCfg | null
  copyBat: () => void
  copied: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <input ref={fileRef} type="file" multiple
        accept="image/*,.pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = "" }} />
      <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ cursor: "pointer" }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files) }}
        className={`flex h-44 w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-colors disabled:opacity-50 ${
          dragOver ? "border-primary bg-primary/15 text-primary scale-[1.01]" : "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"}`}>
        <Icon name={busy ? "Loader" : dragOver ? "Download" : "Upload"} size={40} className={busy ? "animate-spin" : ""} />
        <span className="text-sm font-medium">
          {busy ? "Загрузка..." : dragOver ? "Отпустите файлы здесь" : "Выбрать, перетащить или сфотографировать счёт"}
        </span>
        <span className="text-xs text-foreground/40">Фото (JPG/PNG), PDF или Excel (XLSX/XLS) · до 20 файлов сразу</span>
      </button>
      <p className="max-w-md text-center text-xs text-foreground/50">
        Модель распознает позиции и подставит товары со склада. Перед приёмкой можно всё проверить и поправить.
        При загрузке нескольких файлов каждый попадёт в черновики.
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
  )
}
