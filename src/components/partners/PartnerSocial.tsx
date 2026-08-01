import { useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface Props {
  session: string
  initial: string                 // текущее значение social_links (по строке на ссылку)
  onSaved: (value: string) => void
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

export default function PartnerSocial({ session, initial, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setDraft(initial) }, [initial])

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
        </div>
      )}
    </div>
  )
}
