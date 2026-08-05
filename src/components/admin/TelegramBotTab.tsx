import { useCallback, useEffect, useState } from "react"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"
import { getAdminKey } from "@/pages/admin/constants"

type Chat = {
  id: number
  chat_id: number
  title: string
  thread_id: number | null
  kind: string
  is_active: boolean
  note: string | null
}

type Route = {
  event_key: string
  title: string
  category: string
  enabled: boolean
  chat_id: number | null
  chat_title: string | null
}

type LogRow = {
  id: number
  event_key: string | null
  event_title: string | null
  chat_id: number | null
  chat_title: string | null
  status: string
  error: string | null
  preview: string | null
  created_at: string | null
}

type Stats = {
  sent_24h: number
  errors_24h: number
  skipped_24h: number
  active_chats: number
  enabled_events: number
}

const CATEGORY_LABELS: Record<string, string> = {
  orders: "Заказы",
  leads: "Заявки и лиды",
  warehouse: "Склад",
  tasks: "Задачи и календарь",
  builds: "Сборки",
  prices: "Цены",
  stress: "Стресс-тесты",
  other: "Прочее",
}

const INPUT = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"

function fmtDate(s: string | null) {
  if (!s) return "—"
  const d = new Date(s)
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export default function TelegramBotTab() {
  const adminKey = getAdminKey()
  const [tab, setTab] = useState<"chats" | "events" | "log">("chats")
  const [loading, setLoading] = useState(true)
  const [chats, setChats] = useState<Chat[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [log, setLog] = useState<LogRow[]>([])
  const [testing, setTesting] = useState<number | null>(null)
  const [msg, setMsg] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    api.tgBot.overview(adminKey)
      .then(d => {
        setChats(d.chats || [])
        setRoutes(d.routes || [])
        setStats(d.stats || null)
      })
      .finally(() => setLoading(false))
  }, [adminKey])

  useEffect(() => { load() }, [load])

  const loadLog = useCallback(() => {
    api.tgBot.log(adminKey, { limit: 100 }).then(d => setLog(d.log || []))
  }, [adminKey])

  useEffect(() => { if (tab === "log") loadLog() }, [tab, loadLog])

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3000) }

  // ─── Чаты ───────────────────────────────────────────────
  const [editing, setEditing] = useState<Partial<Chat> | null>(null)

  const saveChat = async () => {
    if (!editing?.chat_id || !editing?.title?.trim()) {
      flash("Заполни ID чата и название")
      return
    }
    const r = await api.tgBot.saveChat(editing, adminKey)
    if (r.error) { flash(r.error); return }
    setChats(r.chats || [])
    setEditing(null)
    flash("Чат сохранён")
  }

  const detect = async () => {
    if (!editing?.chat_id) { flash("Сначала укажи ID чата"); return }
    const r = await api.tgBot.detectChat(String(editing.chat_id), adminKey)
    if (r.ok) {
      setEditing({ ...editing, title: r.title, kind: r.kind })
      flash("Название загружено из Telegram")
    } else {
      flash(r.error || "Не удалось получить чат")
    }
  }

  const removeChat = async (c: Chat) => {
    if (!confirm(`Удалить чат «${c.title}»? События из него вернутся в чат по умолчанию.`)) return
    const r = await api.tgBot.deleteChat(c.id, adminKey)
    setChats(r.chats || [])
    load()
    flash("Чат удалён")
  }

  const testChat = async (c: Chat) => {
    setTesting(c.id)
    try {
      const r = await api.tgBot.test(c.chat_id, adminKey, c.thread_id ?? undefined)
      flash(r.sent ? `Сообщение отправлено в «${c.title}»` : "Не доставлено — проверь, что бот в чате")
    } finally {
      setTesting(null)
    }
  }

  const toggleChat = async (c: Chat) => {
    const r = await api.tgBot.saveChat({ ...c, is_active: !c.is_active }, adminKey)
    setChats(r.chats || [])
  }

  // ─── События ────────────────────────────────────────────
  const saveRoute = async (event_key: string, patch: Partial<Route>) => {
    setRoutes(rs => rs.map(r => r.event_key === event_key ? { ...r, ...patch } : r))
    const r = await api.tgBot.saveRoute({ event_key, ...patch }, adminKey)
    if (r.routes) setRoutes(r.routes)
  }

  const grouped = routes.reduce<Record<string, Route[]>>((acc, r) => {
    (acc[r.category] = acc[r.category] || []).push(r)
    return acc
  }, {})

  const activeChats = chats.filter(c => c.is_active)

  return (
    <div className="space-y-4">
      {/* Шапка со сводкой */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Telegram-бот</h2>
          <p className="text-xs text-foreground/50">Чаты, уведомления по событиям и журнал отправок</p>
        </div>
        <button onClick={load} className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary" style={{ cursor: "pointer" }}>
          <Icon name="RefreshCw" size={13} /> Обновить
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Отправлено за сутки", value: stats.sent_24h, icon: "Send", color: "text-emerald-400" },
            { label: "Ошибок за сутки", value: stats.errors_24h, icon: "TriangleAlert", color: stats.errors_24h ? "text-red-400" : "text-foreground/40" },
            { label: "Активных чатов", value: stats.active_chats, icon: "MessagesSquare", color: "text-foreground" },
            { label: "Включённых событий", value: stats.enabled_events, icon: "Bell", color: "text-foreground" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-foreground/50">
                <Icon name={s.icon} size={12} /> {s.label}
              </div>
              <div className={`mt-1 text-xl font-semibold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {msg && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-foreground">{msg}</div>
      )}

      {/* Переключатель разделов */}
      <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
        {([
          ["chats", "Чаты", "MessagesSquare"],
          ["events", "Уведомления", "Bell"],
          ["log", "Журнал", "ScrollText"],
        ] as const).map(([k, label, icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${tab === k ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>
            <Icon name={icon} size={13} /> {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-foreground/50">Загружаю…</div>
      ) : tab === "chats" ? (
        <div className="space-y-3">
          <button onClick={() => setEditing({ kind: "group", is_active: true })}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={14} /> Добавить чат
          </button>

          {editing && (
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
              <p className="mb-3 text-sm font-medium text-foreground">
                {editing.id ? "Изменить чат" : "Новый чат"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] text-foreground/60">ID чата</label>
                  <div className="flex gap-2">
                    <input className={INPUT} placeholder="-1001234567890"
                      value={editing.chat_id ?? ""}
                      onChange={e => setEditing({ ...editing, chat_id: e.target.value as unknown as number })} />
                    <button onClick={detect} title="Загрузить название из Telegram"
                      className="shrink-0 rounded-lg border border-border px-2.5 hover:border-primary" style={{ cursor: "pointer" }}>
                      <Icon name="Search" size={14} />
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-foreground/40">Добавь бота в чат и напиши там /chatid</p>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-foreground/60">Название</label>
                  <input className={INPUT} placeholder="Рабочий чат"
                    value={editing.title ?? ""}
                    onChange={e => setEditing({ ...editing, title: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-foreground/60">Ветка форума (не обязательно)</label>
                  <input className={INPUT} placeholder="ID топика"
                    value={editing.thread_id ?? ""}
                    onChange={e => setEditing({ ...editing, thread_id: e.target.value as unknown as number })} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-foreground/60">Заметка</label>
                  <input className={INPUT} placeholder="Для чего этот чат"
                    value={editing.note ?? ""}
                    onChange={e => setEditing({ ...editing, note: e.target.value })} />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={saveChat} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
                  Сохранить
                </button>
                <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-3 py-2 text-sm" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </div>
          )}

          {chats.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-foreground/50">
              Чатов пока нет. Добавь первый — и бот сможет туда писать.
            </div>
          ) : chats.map(c => (
            <div key={c.id} className={`rounded-xl border bg-card p-4 ${c.is_active ? "border-border" : "border-border/50 opacity-60"}`}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{c.title}</span>
                    {!c.is_active && <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] text-foreground/60">выключен</span>}
                    {c.thread_id && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">ветка {c.thread_id}</span>}
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-foreground/40">{c.chat_id}</p>
                  {c.note && <p className="mt-1 text-xs text-foreground/60">{c.note}</p>}
                  <p className="mt-1 text-[11px] text-foreground/40">
                    Событий сюда: {routes.filter(r => r.chat_id === c.chat_id).length}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => testChat(c)} disabled={testing === c.id}
                    className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-primary disabled:opacity-50"
                    style={{ cursor: "pointer" }}>
                    <Icon name="Send" size={12} /> {testing === c.id ? "Шлю…" : "Тест"}
                  </button>
                  <button onClick={() => toggleChat(c)}
                    className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-primary"
                    style={{ cursor: "pointer" }}>
                    <Icon name={c.is_active ? "Pause" : "Play"} size={12} /> {c.is_active ? "Выключить" : "Включить"}
                  </button>
                  <button onClick={() => setEditing(c)}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-primary" style={{ cursor: "pointer" }}>
                    <Icon name="Pencil" size={12} />
                  </button>
                  <button onClick={() => removeChat(c)}
                    className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10" style={{ cursor: "pointer" }}>
                    <Icon name="Trash2" size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : tab === "events" ? (
        <div className="space-y-4">
          <p className="text-xs text-foreground/50">
            Выключенное событие бот не отправляет. Если чат не выбран — идёт в чат по умолчанию.
          </p>
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat} className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground/50">
                {CATEGORY_LABELS[cat] || cat}
              </p>
              <div className="space-y-2">
                {list.map(r => (
                  <div key={r.event_key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2.5">
                    <button onClick={() => saveRoute(r.event_key, { enabled: !r.enabled })}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${r.enabled ? "bg-primary" : "bg-foreground/20"}`}
                      style={{ cursor: "pointer" }} title={r.enabled ? "Выключить" : "Включить"}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${r.enabled ? "left-4.5" : "left-0.5"}`} />
                    </button>
                    <span className={`min-w-0 flex-1 text-sm ${r.enabled ? "text-foreground" : "text-foreground/40"}`}>
                      {r.title}
                    </span>
                    <select
                      value={r.chat_id ?? ""}
                      onChange={e => saveRoute(r.event_key, { chat_id: e.target.value ? Number(e.target.value) : null })}
                      className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                      style={{ cursor: "pointer" }}>
                      <option value="">Чат по умолчанию</option>
                      {activeChats.map(c => (
                        <option key={c.id} value={c.chat_id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={loadLog} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary" style={{ cursor: "pointer" }}>
              <Icon name="RefreshCw" size={13} /> Обновить
            </button>
            <button onClick={async () => {
              if (!confirm("Очистить журнал отправок?")) return
              await api.tgBot.clearLog(adminKey)
              loadLog(); load()
            }} className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10" style={{ cursor: "pointer" }}>
              <Icon name="Trash2" size={13} /> Очистить
            </button>
          </div>
          {log.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-foreground/50">
              Записей пока нет — здесь появятся все отправленные уведомления.
            </div>
          ) : (
            <div className="space-y-1.5">
              {log.map(l => (
                <div key={l.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${l.status === "ok" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                      {l.status === "ok" ? "доставлено" : "ошибка"}
                    </span>
                    <span className="text-xs font-medium text-foreground">{l.event_title || l.event_key || "—"}</span>
                    <span className="text-[11px] text-foreground/50">→ {l.chat_title || l.chat_id || "—"}</span>
                    <span className="ml-auto text-[11px] text-foreground/40">{fmtDate(l.created_at)}</span>
                  </div>
                  {l.preview && <p className="mt-1 line-clamp-2 text-[11px] text-foreground/50">{l.preview}</p>}
                  {l.error && <p className="mt-1 text-[11px] text-red-400">{l.error}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
