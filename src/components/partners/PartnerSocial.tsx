import { useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface Props {
  session: string
  initial: string                 // текущее значение social_links (по строке на ссылку)
  onSaved: (value: string) => void
  logo?: string                   // текущий логотип для отчётов (CDN URL)
  onLogoSaved?: (url: string) => void
}

// Нормализация ссылки в кликабельный href
function toHref(raw: string): string {
  const s = raw.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (/^(t\.me|vk\.com|instagram\.com|youtube\.com|dzen\.ru|wa\.me)/i.test(s)) return `https://${s}`
  if (s.startsWith("@")) return `https://t.me/${s.slice(1)}`
  return `https://${s}`
}

// Короткая подпись ссылки
function label(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "")
}

// Иконка соцсети по домену
function iconFor(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes("t.me") || s.startsWith("@") || s.includes("telegram")) return "Send"
  if (s.includes("vk.com") || s.includes("vk.ru")) return "Users"
  if (s.includes("youtube") || s.includes("youtu.be")) return "Youtube"
  if (s.includes("instagram")) return "Instagram"
  if (s.includes("wa.me") || s.includes("whatsapp")) return "MessageCircle"
  return "Link"
}

export default function PartnerSocial({ session, initial, onSaved, logo = "", onLogoSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(initial) }, [initial])

  // Загрузка логотипа: файл → S3 (upload) → сохранить URL в компании
  const onPickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 4 * 1024 * 1024) { alert("Файл больше 4 МБ"); return }
      setLogoBusy(true)
      const reader = new FileReader()
      reader.onload = async () => {
        const up = await api.upload.partnerLogo(String(reader.result))
        if (up?.url) {
          const res = await api.auth.savePartnerLogo(up.url, session)
          if (res?.ok) onLogoSaved?.(res.report_logo_url ?? up.url)
        } else {
          alert("Не удалось загрузить логотип")
        }
        setLogoBusy(false)
      }
      reader.readAsDataURL(file)
    }
    if (fileRef.current) fileRef.current.value = ""
  }

  const removeLogo = async () => {
    setLogoBusy(true)
    const res = await api.auth.savePartnerLogo("", session)
    setLogoBusy(false)
    if (res?.ok) onLogoSaved?.("")
  }

  // Закрытие при клике вне
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setEditing(false) }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const links = initial.split("\n").map(s => s.trim()).filter(Boolean)

  const save = async () => {
    setSaving(true)
    const res = await api.auth.savePartnerSocial(draft, session)
    setSaving(false)
    if (res?.ok) {
      onSaved(res.social_links ?? draft)
      setEditing(false)
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground/60 hover:border-primary hover:text-primary transition-colors"
        style={{ cursor: "pointer" }}
        title="Наши соцсети"
      >
        <Icon name="Share2" size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-border bg-card p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Наши соцсети</span>
            {!editing && (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-foreground/50 hover:text-primary" style={{ cursor: "pointer" }}>
                <Icon name="Pencil" size={12} /> Изменить
              </button>
            )}
          </div>

          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={5}
                placeholder={"t.me/yourchannel\nvk.com/yourpage\n@nickname"}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                style={{ cursor: "text" }}
              />
              <p className="mt-1 mb-2 text-[11px] text-foreground/40">Каждая ссылка — с новой строки</p>
              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60" style={{ cursor: "pointer" }}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
                <button onClick={() => { setEditing(false); setDraft(initial) }} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </>
          ) : links.length ? (
            <div className="flex flex-col gap-1">
              {links.map((l, i) => (
                <a key={i} href={toHref(l)} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground/80 hover:bg-muted hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                  <Icon name={iconFor(l)} size={14} className="shrink-0" />
                  <span className="truncate">{label(l)}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="py-2 text-center text-xs text-foreground/40">Ссылки ещё не добавлены</p>
          )}

          {/* Логотип для отчётов */}
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-2 text-sm font-semibold text-foreground">Логотип в отчётах</div>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                {logo
                  ? <img src={logo} alt="logo" className="h-full w-full object-contain" />
                  : <Icon name="Image" size={20} className="text-foreground/30" />}
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <button onClick={() => fileRef.current?.click()} disabled={logoBusy}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60" style={{ cursor: "pointer" }}>
                  {logoBusy ? "Загрузка…" : logo ? "Заменить" : "Загрузить"}
                </button>
                {logo && !logoBusy && (
                  <button onClick={removeLogo}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:text-red-400 hover:border-red-400/40" style={{ cursor: "pointer" }}>
                    Убрать
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-foreground/40">Появится в правом верхнем углу ваших отчётов</p>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickLogo} className="hidden" />
          </div>
        </div>
      )}
    </div>
  )
}