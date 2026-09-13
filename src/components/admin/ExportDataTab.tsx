import { useEffect, useState } from "react"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { getAdminKey } from "@/pages/admin/constants"

const FN = "https://functions.poehali.dev/91990b31-7e23-4f0e-aae1-4eb2364c11a6"

interface TableInfo { table: string; rows: number; heavy: boolean }
interface Info {
  db_size: string
  schema: string
  tables: TableInfo[]
  rows_total: number
  files_count: number
}

/** Запрос к функции выгрузки. */
async function ask(action: string, extra = ""): Promise<Response> {
  const r = await fetch(`${FN}?action=${action}${extra}`, {
    headers: { "X-Admin-Key": getAdminKey() },
  })
  if (!r.ok) throw new Error(`${action}: ${r.status}`)
  return r
}

function saveFile(name: string, data: BlobPart, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export default function ExportDataTab() {
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState("")
  const [progress, setProgress] = useState("")
  const [withLogs, setWithLogs] = useState(true)

  useEffect(() => {
    ask("info")
      .then(r => r.json())
      .then(setInfo)
      .catch(e => setErr(String(e.message || e)))
  }, [])

  /**
   * Дамп базы. Качаем по одной таблице: целиком база не влезает ни в лимит
   * времени функции, ни в ограничение на размер ответа. Большие таблицы
   * дополнительно режем на части, а при ошибке уменьшаем шаг.
   */
  async function downloadDump() {
    if (!info) return
    setBusy("db")
    setErr("")
    const parts: string[] = []
    const flag = withLogs ? "" : "&full=0"
    try {
      for (let i = 0; i < info.tables.length; i++) {
        const t = info.tables[i]
        setProgress(`Таблица ${i + 1} из ${info.tables.length}: ${t.table}`)
        let done = false
        // Сначала пробуем целиком, потом дробим всё мельче
        for (const step of [0, 1000, 250, 50, 10, 2]) {
          try {
            if (step === 0) {
              const r = await ask("db", `&table=${t.table}${flag}`)
              parts.push(await r.text())
            } else {
              const chunks: string[] = []
              for (let off = 0; off < Math.max(t.rows, 1); off += step) {
                const r = await ask(
                  "db",
                  `&table=${t.table}&offset=${off}&limit=${step}${flag}`
                )
                chunks.push(await r.text())
                setProgress(
                  `Таблица ${i + 1} из ${info.tables.length}: ${t.table} — ` +
                  `${Math.min(off + step, t.rows)} из ${t.rows} строк`
                )
              }
              parts.push(chunks.join("\n"))
            }
            done = true
            break
          } catch {
            // ответ не влез — пробуем меньший шаг
          }
        }
        if (!done) parts.push(`-- ВНИМАНИЕ: таблицу ${t.table} выгрузить не удалось\n`)
      }
      saveFile("dump.sql", parts.join("\n"), "application/sql;charset=utf-8")

      // Индексы и связи — отдельным файлом: их ставят ПОСЛЕ данных,
      // иначе заливка идёт медленно и ключи спотыкаются о порядок таблиц.
      setProgress("Индексы и связи")
      const idx = await (await ask("indexes")).text()
      saveFile("indexes.sql", idx, "application/sql;charset=utf-8")
      setProgress("")
    } catch (e: any) {
      setErr(`Не удалось выгрузить базу: ${e.message || e}`)
    } finally {
      setBusy("")
    }
  }

  /** Комплект для переноса: инструкция, переменные, скрипт, список ссылок. */
  async function downloadKit() {
    setBusy("kit")
    setErr("")
    try {
      const { default: JSZip } = await import("jszip")
      const zip = new JSZip()
      const files: [string, string][] = [
        ["README.md", "readme"],
        [".env.example", "envfile"],
        ["download.sh", "script"],
        ["files.txt", "filelist"],
      ]
      for (const [name, action] of files) {
        setProgress(`Готовлю ${name}`)
        zip.file(name, await (await ask(action)).text())
      }
      setProgress("Упаковываю архив")
      const blob = await zip.generateAsync({ type: "blob" })
      saveFile("перенос-проекта.zip", blob, "application/zip")
      setProgress("")
    } catch (e: any) {
      setErr(`Не удалось собрать комплект: ${e.message || e}`)
    } finally {
      setBusy("")
    }
  }

  /**
   * Все файлы хранилища одним архивом. Браузер держит архив в памяти
   * вкладки, поэтому объём ограничен — на больших выгрузках надёжнее
   * скрипт download.sh из комплекта переноса.
   */
  async function downloadFilesZip() {
    setBusy("files")
    setErr("")
    try {
      const { default: JSZip } = await import("jszip")
      const data = await (await ask("files")).json()
      const zip = new JSZip()
      let ok = 0
      let bad = 0
      for (let i = 0; i < data.files.length; i++) {
        const f = data.files[i]
        setProgress(`Файл ${i + 1} из ${data.files.length} (пропущено: ${bad})`)
        try {
          const r = await fetch(f.url)
          if (!r.ok) throw new Error(String(r.status))
          zip.file(f.key, await r.blob())
          ok++
        } catch {
          bad++ // битые ссылки в базе — пропускаем молча, сводку покажем в конце
        }
      }
      setProgress("Упаковываю архив, это может занять минуту")
      const blob = await zip.generateAsync({ type: "blob" })
      saveFile("файлы.zip", blob, "application/zip")
      setProgress(`Готово: ${ok} файлов, пропущено ${bad}`)
    } catch (e: any) {
      setErr(`Не удалось собрать архив файлов: ${e.message || e}`)
    } finally {
      setBusy("")
    }
  }

  const disabled = busy !== ""

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Выгрузка данных</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Перенос проекта на свой сервер: база данных, файлы и инструкция по
          развёртыванию. Исходный код скачивается отдельно — кнопкой
          «Скачать код» в панели проекта.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {err}
        </div>
      )}

      {/* Сводка */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">База данных</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {info ? info.db_size : "…"}
          </div>
          <div className="text-xs text-muted-foreground">
            {info ? `${info.tables.length} таблиц, ${info.rows_total.toLocaleString("ru")} строк` : ""}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Файлы хранилища</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {info ? info.files_count : "…"}
          </div>
          <div className="text-xs text-muted-foreground">около 900 МБ</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Схема</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground" title={info?.schema}>
            {info ? info.schema : "…"}
          </div>
          <div className="text-xs text-muted-foreground">имя менять не нужно</div>
        </div>
      </div>

      {progress && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-foreground">
          <Icon name="LoaderCircle" size={16} className="animate-spin" />
          {progress}
        </div>
      )}

      {/* Шаги выгрузки */}
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Icon name="Database" size={18} /> 1. База данных
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Два файла: <code>dump.sql</code> (структура и все данные) и
                <code>indexes.sql</code> (индексы и связи между таблицами).
                Восстанавливаются по очереди: сначала первый, затем второй.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={withLogs}
                  onChange={e => setWithLogs(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Включить логи и метрики (история цен, стресс-тесты)
              </label>
            </div>
            <Button onClick={downloadDump} disabled={disabled || !info}>
              {busy === "db" ? "Выгружаю…" : "Скачать базу"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Icon name="FolderDown" size={18} /> 2. Комплект переноса
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Архив с инструкцией (README), списком переменных окружения
                и скриптом <code>download.sh</code> — он скачает все файлы
                хранилища на ваш сервер. Подходит для любого объёма.
              </p>
            </div>
            <Button onClick={downloadKit} disabled={disabled} variant="secondary">
              {busy === "kit" ? "Собираю…" : "Скачать комплект"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Icon name="Images" size={18} /> 3. Файлы одним архивом
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Удобно, но браузер собирает архив в памяти вкладки. При 900 МБ
                это может занять много времени или не хватить памяти — тогда
                используйте <code>download.sh</code> из комплекта переноса.
              </p>
            </div>
            <Button onClick={downloadFilesZip} disabled={disabled} variant="outline">
              {busy === "files" ? "Качаю…" : "Скачать файлы"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
          <Icon name="KeyRound" size={16} /> Пароли и ключи
        </div>
        Значения секретов (токены Telegram, пароли разделов и прочее) в
        выгрузку не попадают — скопируйте их вручную из раздела «Секреты»
        в панели проекта. Полный список нужных переменных лежит в файле
        <code> .env.example</code> внутри комплекта переноса.
      </div>
    </div>
  )
}