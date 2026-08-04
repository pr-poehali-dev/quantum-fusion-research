import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

type Link = { label: string; url: string }

type Brand = {
  configured: boolean
  partner_id: string
  partner_name: string
  logo_png_base64: string
  logo_url?: string
  verify_page_url?: string
  links: Link[]
  qr_url_template: string
  issued_at: string
  expires_at: string
  revoked: boolean
  expired: boolean
  has_key?: boolean
  signing_ready?: boolean
  prefilled?: boolean
}

const MAX_LINKS = 5

export default function StressBrandSettings({ session }: { session: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [logo, setLogo] = useState("")
  const [links, setLinks] = useState<Link[]>([])
  const [qrTpl, setQrTpl] = useState("")
  const loadedRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const auth = { session }

  const apply = (b: Brand) => {
    setBrand(b)
    setLogo(b.logo_png_base64 || "")
    setLinks(b.links?.length ? b.links : [])
    setQrTpl(b.qr_url_template || "")
  }

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    api.stress.brandConfig("", auth)
      .then(d => {
        if (d.error || !d.brand) { setLoadError(d.error || "Не удалось загрузить"); return }
        apply(d.brand)
      })
      .catch(() => setLoadError("Нет связи с сервером"))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true
    load()
  }, [open, load])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 5000)
  }

  // Логотип: любое изображение → PNG ≤512×512 → base64
  const pickLogo = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const max = 512
        let { width, height } = img
        if (width > max || height > max) {
          const k = Math.min(max / width, max / height)
          width = Math.round(width * k); height = Math.round(height * k)
        }
        const canvas = document.createElement("canvas")
        canvas.width = width; canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL("image/png")
        const b64 = dataUrl.split(",")[1] || ""
        if (b64.length > 400000) { flash(false, "Логотип слишком большой — возьмите картинку поменьше"); return }
        setLogo(b64)
      }
      img.src = String(reader.result || "")
    }
    reader.readAsDataURL(file)
  }

  const save = (extra: Record<string, unknown> = {}) => {
    setSaving(true)
    return api.stress.brandSave(
      {
        logo_png_base64: logo, links, qr_url_template: qrTpl,
        // Прямая ссылка на логотип попадает в pack. Адрес страницы проверки
        // НЕ берём из текущей вкладки — иначе в QR уйдёт preview-домен;
        // боевой адрес подставит сервер.
        logo_url: brand?.logo_url || "",
        ...extra,
      }, "", auth)
      .then(d => {
        if (d.error) { flash(false, d.error); return null }
        if (d.brand) apply(d.brand)
        return d
      })
      .catch(() => { flash(false, "Не удалось сохранить"); return null })
      .finally(() => setSaving(false))
  }

  const downloadArchive = async () => {
    setSaving(true)
    try {
      const saved = await save()
      if (!saved) return
      const d = await api.stress.brandArchive("", auth)
      if (d.error || !d.zip_base64) { flash(false, d.error || "Не удалось собрать архив"); return }
      const bin = atob(d.zip_base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }))
      const a = document.createElement("a")
      a.href = url
      a.download = d.filename || "brand.zip"
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      flash(true, "Архив скачан: файл-ключ, логотип, пример QR и инструкция")
    } finally {
      setSaving(false)
    }
  }

  const downloadKey = async () => {
    setSaving(true)
    try {
      const saved = await save()
      if (!saved) return
      const d = await api.stress.brandDownload("", auth)
      if (d.error || !d.pack) { flash(false, d.error || "Не удалось создать файл"); return }
      const blob = new Blob([JSON.stringify(d.pack, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = d.filename || "partner.stbrand"
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      flash(true, "Файл-ключ скачан. Импортируйте его в программе StressRunner.")
    } finally {
      setSaving(false)
    }
  }

  const rotate = async () => {
    if (!confirm("Перевыпустить ключ? Старые QR-коды в уже выданных отчётах перестанут проверяться.")) return
    const d = await save({ rotate_key: true })
    if (d) flash(true, "Ключ перевыпущен — скачайте новый файл и импортируйте в программу")
  }

  const revoke = async () => {
    if (!confirm("Отозвать брендинг? Программа перестанет использовать ваш логотип в отчётах.")) return
    setSaving(true)
    api.stress.brandRevoke("", auth)
      .then(d => { if (d.brand) apply(d.brand); flash(true, "Брендинг отозван") })
      .catch(() => flash(false, "Не удалось отозвать"))
      .finally(() => setSaving(false))
  }

  const prefill = () => {
    setSaving(true)
    api.stress.brandPrefill("", auth)
      .then(d => {
        if (d.error) { flash(false, d.error); return }
        if (d.logo_png_base64) setLogo(d.logo_png_base64)
        if (d.links?.length) setLinks(d.links)
        if (!d.logo_png_base64 && !d.links?.length) {
          flash(false, "В профиле компании пока нет логотипа и ссылок")
          return
        }
        flash(true, "Данные из профиля подставлены — не забудьте сохранить")
      })
      .catch(() => flash(false, "Не удалось загрузить данные профиля"))
      .finally(() => setSaving(false))
  }

  const setLink = (i: number, patch: Partial<Link>) =>
    setLinks(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const fmtDate = (iso: string) => {
    if (!iso) return "—"
    const d = new Date(iso)
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ru-RU")
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ cursor: "pointer" }}
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors">
        <Icon name="BadgeCheck" size={14} />
        Брендинг отчётов
      </button>
    )
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="BadgeCheck" size={16} className="text-primary" />
            <h3 className="font-semibold text-foreground">Брендинг PDF-отчётов</h3>
            {saving && <Icon name="Loader" size={13} className="animate-spin text-foreground/40" />}
          </div>
          <p className="mt-1 text-xs text-foreground/50">
            Ваш логотип и контакты в шапке отчёта вместо наших
          </p>
        </div>
        <button onClick={() => setOpen(false)} style={{ cursor: "pointer" }}
          className="text-foreground/40 hover:text-foreground"><Icon name="X" size={16} /></button>
      </div>

      {msg && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-green-500/30 bg-green-500/10 text-green-500" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !brand ? (
        <div className="rounded-xl border border-border px-4 py-8 text-center">
          <Icon name="TriangleAlert" size={20} className="mx-auto mb-2 text-foreground/30" />
          <p className="mb-3 text-sm text-foreground/60">{loadError || "Не удалось загрузить"}</p>
          <button onClick={load} style={{ cursor: "pointer" }}
            className="rounded-lg border border-border px-4 py-2 text-xs text-foreground/70 hover:border-primary hover:text-foreground">
            Повторить
          </button>
        </div>
      ) : (
        <>
          {/* Как это работает */}
          <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs text-foreground/70">
              <b>Как это работает:</b> настройте логотип и ссылки → скачайте файл-ключ →
              импортируйте его в программе StressRunner. После этого отчёты выходят под вашим
              брендом, <b>даже без интернета</b>. При запуске с интернетом программа обновляет
              настройки сама.
            </p>
          </div>

          {/* Данные подтянуты из профиля компании */}
          {brand.prefilled && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-green-500/25 bg-green-500/5 p-3">
              <Icon name="Sparkles" size={14} className="mt-0.5 shrink-0 text-green-500" />
              <p className="text-xs text-foreground/70">
                Логотип и контакты подставлены из профиля вашей компании — проверьте
                и нажмите «Сохранить и скачать файл-ключ».
              </p>
            </div>
          )}

          {/* Статус */}
          {brand.configured && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              {brand.revoked ? (
                <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-400">Отозван</span>
              ) : brand.expired ? (
                <span className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2 py-0.5 text-yellow-400">Срок истёк</span>
              ) : (
                <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-green-500">Активен</span>
              )}
              <span className="text-foreground/40">Выдан: {fmtDate(brand.issued_at)}</span>
              <span className="text-foreground/40">Действует до: {fmtDate(brand.expires_at)}</span>
            </div>
          )}

          {brand.signing_ready === false && (
            <div className="mb-4 rounded-lg border border-yellow-400/30 bg-yellow-400/10 px-3 py-2 text-xs text-yellow-400">
              На сервере не настроена подпись файлов — обратитесь к администратору.
            </div>
          )}

          {/* Логотип */}
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium text-foreground/50">Логотип для шапки отчёта</p>
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background">
                {logo ? (
                  <img src={`data:image/png;base64,${logo}`} alt="Логотип" className="max-h-full max-w-full object-contain" />
                ) : (
                  <Icon name="Image" size={18} className="text-foreground/25" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) pickLogo(f); e.target.value = "" }} />
                <button onClick={() => fileRef.current?.click()} style={{ cursor: "pointer" }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground">
                  Выбрать картинку
                </button>
                <button onClick={prefill} disabled={saving} style={{ cursor: "pointer" }}
                  title="Подставить логотип и контакты из профиля компании"
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground disabled:opacity-50">
                  <Icon name="RefreshCw" size={12} /> Взять из профиля
                </button>
                {logo && (
                  <button onClick={() => setLogo("")} style={{ cursor: "pointer" }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/50 hover:border-red-400 hover:text-red-400">
                    Убрать
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Ссылки */}
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium text-foreground/50">
              Контакты в отчёте <span className="text-foreground/30">— до {MAX_LINKS}</span>
            </p>
            <div className="space-y-2">
              {links.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input value={l.label} onChange={e => setLink(i, { label: e.target.value })}
                    placeholder="Название (Telegram)" style={{ cursor: "text" }}
                    className="min-w-[130px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none" />
                  <input value={l.url} onChange={e => setLink(i, { url: e.target.value })}
                    placeholder="https://t.me/company" style={{ cursor: "text" }}
                    className="min-w-[200px] flex-[2] rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none" />
                  <button onClick={() => setLinks(ls => ls.filter((_, idx) => idx !== i))}
                    style={{ cursor: "pointer" }} className="text-foreground/30 hover:text-red-400" title="Удалить">
                    <Icon name="Trash2" size={14} />
                  </button>
                </div>
              ))}
            </div>
            {links.length < MAX_LINKS && (
              <button onClick={() => setLinks(ls => [...ls, { label: "", url: "" }])} style={{ cursor: "pointer" }}
                className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-foreground/50 hover:border-primary hover:text-foreground">
                <Icon name="Plus" size={12} /> Добавить контакт
              </button>
            )}
          </div>

          {/* QR */}
          <div className="mb-5">
            <p className="mb-2 text-xs font-medium text-foreground/50">
              Ссылка проверки в QR-коде <span className="text-foreground/30">— оставьте пустым для стандартной</span>
            </p>
            <input value={qrTpl} onChange={e => setQrTpl(e.target.value)}
              placeholder="https://begraphics.ru/v/{verify_code}" style={{ cursor: "text" }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none" />
            <p className="mt-1 text-[11px] text-foreground/30">
              Клиент сканирует QR из отчёта и попадает на страницу проверки подлинности.
              Часть <code className="font-mono">{"{verify_code}"}</code> подставится автоматически.
            </p>
          </div>

          {/* Кнопки */}
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <button onClick={downloadArchive} disabled={saving} style={{ cursor: "pointer" }}
              title="ZIP: файл-ключ, логотип, пример QR-кода и инструкция"
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Icon name="FileArchive" size={14} />
              Сохранить и скачать архив
            </button>
            <button onClick={downloadKey} disabled={saving} style={{ cursor: "pointer" }}
              title="Только файл-ключ .stbrand, без картинок"
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs text-foreground/70 hover:border-primary hover:text-foreground disabled:opacity-50">
              <Icon name="Download" size={14} />
              Только файл-ключ
            </button>
            <button onClick={() => save().then(d => d && flash(true, "Сохранено"))} disabled={saving}
              style={{ cursor: "pointer" }}
              className="rounded-lg border border-border px-4 py-2 text-xs text-foreground/70 hover:border-primary hover:text-foreground disabled:opacity-50">
              Только сохранить
            </button>
            {brand.configured && !brand.revoked && (
              <>
                <button onClick={rotate} disabled={saving} style={{ cursor: "pointer" }}
                  className="rounded-lg border border-border px-4 py-2 text-xs text-foreground/50 hover:border-primary hover:text-foreground disabled:opacity-50">
                  Перевыпустить ключ
                </button>
                <button onClick={revoke} disabled={saving} style={{ cursor: "pointer" }}
                  className="rounded-lg border border-border px-4 py-2 text-xs text-foreground/50 hover:border-red-400 hover:text-red-400 disabled:opacity-50">
                  Отозвать
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}