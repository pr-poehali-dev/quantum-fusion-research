import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { getAdminKey } from "@/pages/admin/constants"

interface UserBuild {
  id: number
  user_id: number | null
  name: string
  components: { slot?: string; name?: string; price?: number; qty?: number }[]
  total_price: number
  is_public: boolean
  created_at: string
  short_code: string
  share_token: string
  username: string
  email: string
  author_tag: string
}

export default function UserBuildsTab() {
  const [builds, setBuilds] = useState<UserBuild[]>([])
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState("")
  const [busyId, setBusyId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [onlyPublic, setOnlyPublic] = useState(false)

  const load = (q?: string) => {
    setLoading(true)
    api.auth.adminGetUserBuilds(getAdminKey(), q)
      .then(d => setBuilds(d?.builds || []))
      .catch(() => setBuilds([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => load(), [])

  const op = async (b: UserBuild, operation: string, extra?: Record<string, unknown>) => {
    setBusyId(b.id)
    const res = await api.auth.adminUpdateUserBuild(
      { build_id: b.id, op: operation, ...extra }, getAdminKey()
    ).catch(() => ({ error: "Нет связи с сервером" }))
    setBusyId(null)
    if (res?.error) { alert(res.error); return }
    if (operation === "delete") setBuilds(bs => bs.filter(x => x.id !== b.id))
    else if (operation === "set_public") setBuilds(bs => bs.map(x => x.id === b.id ? { ...x, is_public: !!extra?.value } : x))
    else if (operation === "rename") setBuilds(bs => bs.map(x => x.id === b.id ? { ...x, name: String(extra?.name || x.name) } : x))
  }

  const rename = (b: UserBuild) => {
    const name = prompt("Новое название сборки", b.name)
    if (name && name.trim() && name !== b.name) op(b, "rename", { name: name.trim() })
  }

  const remove = (b: UserBuild) => {
    if (confirm(`Удалить сборку «${b.name}» пользователя ${b.username}? Отменить нельзя.`)) {
      op(b, "delete")
    }
  }

  const fmt = (n: number) => (n || 0).toLocaleString("ru-RU") + " ₽"
  const fmtDate = (iso: string) => iso
    ? new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" })
    : ""

  const shown = onlyPublic ? builds.filter(b => b.is_public) : builds

  return (
    <div className="max-w-4xl">
      <h2 className="mb-1 text-xl font-light text-foreground">Сборки пользователей</h2>
      <p className="mb-5 text-sm text-foreground/50">
        Конфигурации, которые клиенты собрали сами. Опубликованные видны в разделе «Сборки сообщества».
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 gap-2" style={{ minWidth: "260px" }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") load(searchInput) }}
            placeholder="Поиск по названию, автору или почте"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <button onClick={() => load(searchInput)} style={{ cursor: "pointer" }}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
            Найти
          </button>
          {searchInput && (
            <button onClick={() => { setSearchInput(""); load() }} style={{ cursor: "pointer" }}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground/50 hover:text-foreground transition-colors">
              Сброс
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={onlyPublic} onChange={e => setOnlyPublic(e.target.checked)} className="rounded" />
          Только опубликованные
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-foreground/40">Загрузка…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-foreground/40">Сборок не найдено</p>
      ) : (
        <div className="space-y-2">
          {shown.map(b => (
            <div key={b.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                  className="flex items-center gap-1.5 text-left font-medium hover:text-primary transition-colors"
                  style={{ cursor: "pointer" }}>
                  <Icon name={expanded === b.id ? "ChevronDown" : "ChevronRight"} size={14} />
                  {b.name}
                </button>
                {b.is_public ? (
                  <span className="rounded-full bg-green-400/10 px-2 py-0.5 text-xs text-green-400">В сообществе</span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/40">Личная</span>
                )}
                <span className="text-xs text-foreground/40">{b.username}</span>
                <span className="text-xs text-foreground/40">{fmtDate(b.created_at)}</span>
                <span className="text-xs font-semibold text-foreground/60">{fmt(b.total_price)}</span>

                {busyId === b.id ? (
                  <div className="ml-auto h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                ) : (
                  <div className="ml-auto flex gap-1.5">
                    {b.share_token && (
                      <a href={`/user-build/${b.share_token}`} target="_blank" rel="noreferrer" title="Открыть сборку"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/50 hover:border-primary hover:text-foreground transition-colors">
                        <Icon name="ExternalLink" size={13} />
                      </a>
                    )}
                    <button onClick={() => op(b, "set_public", { value: !b.is_public })}
                      title={b.is_public ? "Убрать из сообщества" : "Опубликовать в сообществе"}
                      style={{ cursor: "pointer" }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/50 hover:border-primary hover:text-foreground transition-colors">
                      <Icon name={b.is_public ? "EyeOff" : "Eye"} size={13} />
                    </button>
                    <button onClick={() => rename(b)} title="Переименовать" style={{ cursor: "pointer" }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/50 hover:border-primary hover:text-foreground transition-colors">
                      <Icon name="Pencil" size={13} />
                    </button>
                    <button onClick={() => remove(b)} title="Удалить сборку" style={{ cursor: "pointer" }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/30 hover:border-red-400 hover:text-red-400 transition-colors">
                      <Icon name="Trash2" size={13} />
                    </button>
                  </div>
                )}
              </div>

              {expanded === b.id && (
                <div className="mt-3 border-t border-border pt-3">
                  {b.email && <p className="mb-2 text-xs text-foreground/40">Автор: {b.username} · {b.email}</p>}
                  {b.components?.length ? (
                    <div className="space-y-1">
                      {b.components.map((c, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-foreground/70">
                            {c.name || "—"}{c.qty && c.qty > 1 ? ` ×${c.qty}` : ""}
                          </span>
                          <span className="shrink-0 text-foreground/50">{fmt(c.price || 0)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-foreground/40">Состав не указан</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}