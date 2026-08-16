import { useEffect, useState, useRef } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { getAdminKey } from "@/pages/admin/constants"

export interface Release {
  id: number
  version: string
  changelog: string
  file_url: string
  file_name: string
  file_size: number
  download_count: number
  created_at: string
  is_published?: boolean
}

export function fmtSize(bytes: number): string {
  if (!bytes) return "—"
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2).replace(".", ",")} ГБ`
  const mb = bytes / 1024 ** 2
  return `${mb.toFixed(mb >= 100 ? 0 : 1).replace(".", ",")} МБ`
}

export function fmtDate(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
}

export default function StressReleasesTab() {
  const [releases, setReleases] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)

  const [version, setVersion] = useState("")
  const [changelog, setChangelog] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [publish, setPublish] = useState(true)

  // Прогресс важен: 5 ГБ грузятся минутами, без него кажется, что всё зависло.
  const [progress, setProgress] = useState<number | null>(null)
  const [speed, setSpeed] = useState("")
  const [error, setError] = useState("")
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  const load = () => {
    api.stressReleases.list(getAdminKey())
      .then(d => setReleases(d?.releases || []))
      .catch(() => setReleases([]))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const reset = () => {
    setVersion(""); setChangelog(""); setFile(null)
    setProgress(null); setSpeed(""); setError("")
  }

  const upload = async () => {
    const ak = getAdminKey()
    if (!ak) { setError("Нет доступа администратора"); return }
    if (!version.trim()) { setError("Укажите номер версии"); return }
    if (!file) { setError("Выберите файл"); return }
    setError("")
    setProgress(0)

    // Шаг 1 — просим у сервера временную ссылку на прямую загрузку.
    const u = await api.stressReleases.getUploadUrl(file.name, ak).catch(() => null)
    if (!u?.upload_url) { setError("Не удалось начать загрузку"); setProgress(null); return }

    // Шаг 2 — льём файл напрямую в хранилище, мимо наших функций.
    // XMLHttpRequest (а не fetch) — ради события progress.
    const ok = await new Promise<boolean>(resolve => {
      const xhr = new XMLHttpRequest()
      xhrRef.current = xhr
      const started = Date.now()
      xhr.open("PUT", u.upload_url)
      xhr.setRequestHeader("Content-Type", "application/octet-stream")
      xhr.upload.onprogress = e => {
        if (!e.lengthComputable) return
        setProgress(Math.round((e.loaded / e.total) * 100))
        const sec = (Date.now() - started) / 1000
        if (sec > 1) setSpeed(`${(e.loaded / 1024 ** 2 / sec).toFixed(1)} МБ/с`)
      }
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
      xhr.onerror = () => resolve(false)
      xhr.onabort = () => resolve(false)
      xhr.send(file)
    })
    xhrRef.current = null
    if (!ok) { setError("Загрузка прервалась. Попробуйте ещё раз"); setProgress(null); return }

    // Шаг 3 — сохраняем карточку версии.
    const res = await api.stressReleases.create({
      version: version.trim(),
      changelog: changelog.trim(),
      file_url: u.file_url,
      s3_key: u.s3_key,
      file_name: file.name,
      file_size: file.size,
      is_published: publish,
    }, ak).catch(() => null)

    if (!res?.ok) { setError("Файл загрузился, но версия не сохранилась"); setProgress(null); return }
    reset()
    load()
  }

  const cancelUpload = () => {
    xhrRef.current?.abort()
    xhrRef.current = null
    setProgress(null); setSpeed("")
  }

  const togglePublish = async (r: Release) => {
    const ak = getAdminKey()
    if (!ak) return
    setReleases(rs => rs.map(x => x.id === r.id ? { ...x, is_published: !x.is_published } : x))
    await api.stressReleases.update({ id: r.id, is_published: !r.is_published }, ak).catch(() => {})
  }

  const remove = async (r: Release) => {
    const ak = getAdminKey()
    if (!ak) return
    if (!confirm(`Удалить версию ${r.version}? Файл будет удалён безвозвратно.`)) return
    setReleases(rs => rs.filter(x => x.id !== r.id))
    await api.stressReleases.remove(r.id, ak).catch(() => {})
  }

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
  const uploading = progress !== null

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-xl font-light text-foreground">Стресс-тестер — версии</h2>
      <p className="mb-6 text-sm text-foreground/50">
        Загруженная версия появляется на странице /stresstester, откуда её скачивают клиенты.
      </p>

      {/* Форма загрузки новой версии */}
      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 font-medium">Новая версия</h3>

        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Номер версии *</label>
            <input value={version} onChange={e => setVersion(e.target.value)} disabled={uploading}
              placeholder="1.4.2" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Файл программы *</label>
            <input type="file" accept=".exe,.zip,.msi" disabled={uploading}
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:text-primary" />
          </div>
        </div>

        {file && (
          <p className="mb-3 text-xs text-foreground/50">
            {file.name} — {fmtSize(file.size)}
          </p>
        )}

        <div className="mb-3">
          <label className="mb-1 block text-xs text-foreground/60">Что нового</label>
          <textarea value={changelog} onChange={e => setChangelog(e.target.value)} rows={4} disabled={uploading}
            placeholder="Каждое изменение с новой строки" className={`${inputCls} resize-none`} />
        </div>

        <label className="mb-4 flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)}
            disabled={uploading} className="rounded" />
          Сразу опубликовать на сайте
        </label>

        {uploading && (
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-xs text-foreground/60">
              <span>Загрузка… {progress}%{speed ? ` · ${speed}` : ""}</span>
              <button onClick={cancelUpload} className="text-red-400 hover:underline" style={{ cursor: "pointer" }}>
                Отменить
              </button>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-foreground/40">Не закрывайте вкладку до конца загрузки</p>
          </div>
        )}

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <button onClick={upload} disabled={uploading} style={{ cursor: "pointer" }}
          className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
          <Icon name={uploading ? "Loader2" : "Upload"} size={15} className={uploading ? "animate-spin" : ""} />
          {uploading ? "Загружаем…" : "Загрузить версию"}
        </button>
      </div>

      {/* Список версий */}
      <h3 className="mb-3 font-medium">Загруженные версии ({releases.length})</h3>
      {loading ? (
        <p className="text-sm text-foreground/40">Загрузка…</p>
      ) : releases.length === 0 ? (
        <p className="text-sm text-foreground/40">Пока ни одной версии</p>
      ) : (
        <div className="space-y-2">
          {releases.map(r => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">v{r.version}</span>
                {r.is_published ? (
                  <span className="rounded-full bg-green-400/10 px-2 py-0.5 text-xs text-green-400">На сайте</span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/40">Черновик</span>
                )}
                <span className="text-xs text-foreground/40">{fmtDate(r.created_at)}</span>
                <span className="text-xs text-foreground/40">{fmtSize(r.file_size)}</span>
                <span className="flex items-center gap-1 text-xs text-foreground/40">
                  <Icon name="Download" size={11} />{r.download_count}
                </span>
                <div className="ml-auto flex gap-1.5">
                  <button onClick={() => togglePublish(r)} title={r.is_published ? "Скрыть с сайта" : "Опубликовать"}
                    style={{ cursor: "pointer" }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/50 hover:border-primary hover:text-foreground transition-colors">
                    <Icon name={r.is_published ? "EyeOff" : "Eye"} size={13} />
                  </button>
                  <button onClick={() => remove(r)} title="Удалить версию и файл" style={{ cursor: "pointer" }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/30 hover:border-red-400 hover:text-red-400 transition-colors">
                    <Icon name="Trash2" size={13} />
                  </button>
                </div>
              </div>
              {r.changelog && (
                <p className="mt-2 whitespace-pre-line text-xs text-foreground/60">{r.changelog}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
