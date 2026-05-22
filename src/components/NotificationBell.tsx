import { useState, useEffect, useRef } from "react"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"

interface Notification {
  id: number
  type: string
  text: string
  link: string | null
  is_read: boolean
  created_at: string
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return "только что"
  if (diff < 3600) return `${Math.floor(diff / 60)} мин.`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч.`
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
}

export default function NotificationBell() {
  const { isAuthed, sessionId } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = () => {
    if (!isAuthed() || !sessionId) return
    api.notifications.getAll(sessionId).then(d => {
      setNotifications(d.notifications || [])
      setUnread(d.unread || 0)
    })
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [isAuthed(), sessionId])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleOpen = () => {
    setOpen(v => !v)
  }

  const markRead = async (n: Notification) => {
    if (!n.is_read && sessionId) {
      await api.notifications.markRead(n.id, sessionId)
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
      setUnread(u => Math.max(0, u - 1))
    }
    if (n.link) {
      setOpen(false)
      navigate(n.link)
    }
  }

  const markAllRead = async () => {
    if (!sessionId) return
    await api.notifications.markAllRead(sessionId)
    setNotifications(prev => prev.map(x => ({ ...x, is_read: true })))
    setUnread(0)
  }

  if (!isAuthed()) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative flex items-center justify-center h-9 w-9 rounded-full border border-border hover:border-primary transition-colors"
        style={{ cursor: "pointer" }}
      >
        <Icon name="Bell" size={16} className="text-foreground/70" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
            <span className="text-sm font-semibold text-foreground">Уведомления</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline" style={{ cursor: "pointer" }}>
                Прочитать все
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center">
                <Icon name="BellOff" size={28} className="mx-auto mb-2 text-foreground/20" />
                <p className="text-sm text-foreground/40">Уведомлений нет</p>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => markRead(n)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0 ${!n.is_read ? "bg-primary/5" : ""}`}
                  style={{ cursor: "pointer" }}
                >
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${!n.is_read ? "bg-primary/20 text-primary" : "bg-muted text-foreground/40"}`}>
                    <Icon name="MessageSquare" size={13} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug ${!n.is_read ? "text-foreground font-medium" : "text-foreground/60"}`}>
                      {n.text}
                    </p>
                    <p className="mt-0.5 text-[10px] text-foreground/30">{timeAgo(n.created_at)}</p>
                  </div>
                  {!n.is_read && <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
