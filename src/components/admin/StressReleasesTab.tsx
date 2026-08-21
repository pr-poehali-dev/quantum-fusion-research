import { useEffect, useState } from "react"
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

interface StorageFile { key: string; name: string; size: number; modified: string }

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
  const [link, setLink] = useState("")
  const [publish, setPublish] = useState(true)

  // Файл лежит на Яндекс.Диске: наше хранилище не принимает загрузку
  // из браузера, а EXE весит слишком много для отправки через сервер.
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ name: string; size: number } | null>(null)
  const [error, setError] = useState("")

  // Файлы, уже залитые в наше хранилище: можно выбрать вместо ссылки.
  const [storage, setStorage] = useState<StorageFile[] | null>(null)
  const [picked, setPicked] = useState<StorageFile | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)

  const load = () => {
    api.stressReleases.list(getAdminKey())
      .then(d => setReleases(d?.releases || []))
      .catch(() => setReleases([]))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const reset = () => {
    setVersion(""); setChangelog(""); setLink("")
    setFound(null); setBusy(false); setError("")
    setPicked(null); setStorage(null)
  }

  // Список дистрибутивов из нашего хранилища (exe/msi/zip).
  const loadStorage = async () => {
    const ak = getAdminKey()
    if (!ak) { setError("Нет доступа администратора"); return }
    setStorageBusy(true); setError("")
    const r = await api.stressReleases.storageFiles(ak).catch(() => null)
    setStorageBusy(false)
    if (!r?.ok) { setError("Не удалось получить список файлов"); return }
    setStorage(r.files || [])
  }

  const pickFile = (f: StorageFile) => {
    setPicked(f); setLink(""); setFound({ name: f.name, size: f.size }); setError("")
    if (!version.trim()) {
      // Номер версии обычно есть в имени файла — подставим его.
      const m = f.name.match(/(\d+(?:\.\d+){1,3})/)
      if (m) setVersion(m[1])
    }
  }

  // Проверяем ссылку заранее: сразу видно имя и размер файла.
  const check = async () => {
    const ak = getAdminKey()
    if (!ak) { setError("Нет доступа администратора"); return null }
    if (!link.trim()) { setError("Вставьте ссылку на файл"); return null }
    setBusy(true); setError(""); setFound(null)
    const r = await api.stressReleases.resolveLink(link.trim(), ak).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setError(r?.error || "Не удалось открыть ссылку"); return null }
    setFound({ name: r.file_name, size: Number(r.file_size || 0) })
    return r
  }

  const publishRelease = async () => {
    const ak = getAdminKey()
    if (!ak) { setError("Нет доступа администратора"); return }
    if (!version.trim()) { setError("Укажите номер версии"); return }

    let payload: Record<string, unknown>
    if (picked) {
      payload = {
        file_url: "", source_link: "", s3_key: picked.key,
        file_name: picked.name, file_size: picked.size,
      }
    } else {
      const r = await check()
      if (!r) return
      payload = {
        file_url: r.file_url, source_link: r.public_link || "",
        file_name: r.file_name, file_size: Number(r.file_size || 0),
      }
    }

    setBusy(true)
    const res = await api.stressReleases.create({
      version: version.trim(),
      changelog: changelog.trim(),
      is_published: publish,
      ...payload,
    }, ak).catch(() => null)
    setBusy(false)

    if (!res?.ok) { setError("Не удалось сохранить версию"); return }
    reset()
    load()
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

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-xl font-light text-foreground">Стресс-тестер — версии</h2>
      <p className="mb-6 text-sm text-foreground/50">
        Опубликованная версия появляется на странице /stresstester, откуда её скачивают клиенты.
      </p>

      {/* Форма новой версии: файл берётся с Яндекс.Диска по ссылке */}
      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        <h3 className="mb-1 font-medium">Новая версия</h3>
        <p className="mb-4 text-xs text-foreground/50">
          Выберите файл, уже загруженный в наше хранилище, — или вставьте ссылку
          с Яндекс.Диска. Имя и размер подставятся сами.
        </p>

        {/* Файлы из нашего хранилища */}
        <div className="mb-4 rounded-lg border border-border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground/70">Файл из хранилища</span>
            <button onClick={loadStorage} disabled={storageBusy || busy} style={{ cursor: "pointer" }}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors disabled:opacity-40">
              <Icon name={storageBusy ? "Loader2" : "FolderOpen"} size={13} className={storageBusy ? "animate-spin" : ""} />
              {storage ? "Обновить список" : "Показать файлы"}
            </button>
          </div>

          {picked && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-green-400">
              <Icon name="Check" size={13} />
              Выбран: {picked.name} — {fmtSize(picked.size)}
            </p>
          )}

          {storage && (
            storage.length === 0 ? (
              <p className="mt-2 text-xs text-foreground/40">
                В хранилище нет файлов программы (.exe, .msi, .zip).
              </p>
            ) : (
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {storage.map(f => (
                  <button key={f.key} onClick={() => pickFile(f)} disabled={busy} style={{ cursor: "pointer" }}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${picked?.key === f.key ? "border-primary bg-primary/5 text-foreground" : "border-border text-foreground/70 hover:border-primary/50"}`}>
                    <Icon name="FileBox" size={14} className="shrink-0 text-foreground/40" />
                    <span className="min-w-0 flex-1 truncate" title={f.key}>{f.name}</span>
                    <span className="shrink-0 text-foreground/40">{fmtSize(f.size)}</span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Номер версии *</label>
            <input value={version} onChange={e => setVersion(e.target.value)} disabled={busy}
              placeholder="1.4.2" className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-foreground/60">
              Ссылка на файл {picked ? "(не нужна — файл выбран выше)" : "*"}
            </label>
            <input value={link} onChange={e => { setLink(e.target.value); setFound(null); setPicked(null) }}
              disabled={busy || !!picked}
              placeholder="https://disk.yandex.ru/d/..." className={`${inputCls} disabled:opacity-50`} />
          </div>
        </div>

        <button onClick={check} disabled={busy || !link.trim() || !!picked} style={{ cursor: "pointer" }}
          className="mb-3 flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors disabled:opacity-40">
          <Icon name={busy ? "Loader2" : "Link"} size={13} className={busy ? "animate-spin" : ""} />
          Проверить ссылку
        </button>

        {found && !picked && (
          <p className="mb-3 flex items-center gap-1.5 text-xs text-green-400">
            <Icon name="Check" size={13} />
            Файл найден: {found.name}{found.size ? ` — ${fmtSize(found.size)}` : ""}
          </p>
        )}

        <div className="mb-3">
          <label className="mb-1 block text-xs text-foreground/60">Что нового</label>
          <textarea value={changelog} onChange={e => setChangelog(e.target.value)} rows={4} disabled={busy}
            placeholder="Каждое изменение с новой строки" className={`${inputCls} resize-none`} />
        </div>

        <label className="mb-4 flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)}
            disabled={busy} className="rounded" />
          Сразу опубликовать на сайте
        </label>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <button onClick={publishRelease} disabled={busy} style={{ cursor: "pointer" }}
          className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
          <Icon name={busy ? "Loader2" : "Plus"} size={15} className={busy ? "animate-spin" : ""} />
          {busy ? "Сохраняем…" : "Добавить версию"}
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