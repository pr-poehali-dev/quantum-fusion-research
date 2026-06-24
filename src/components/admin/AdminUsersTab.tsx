import { useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { AdminUser, getAdminKey } from "@/pages/admin/types"

interface Props {
  adminUsers: AdminUser[]
  loading: boolean
  setAdminUsers: React.Dispatch<React.SetStateAction<AdminUser[]>>
}

export function AdminUsersTab({ adminUsers, loading, setAdminUsers }: Props) {
  const [userSearch, setUserSearch] = useState("")
  const [userSearchInput, setUserSearchInput] = useState("")
  const [userActionLoading, setUserActionLoading] = useState<number | null>(null)

  const adminUserOp = async (userId: number, op: string, extra?: Record<string, unknown>) => {
    setUserActionLoading(userId)
    await api.auth.adminUpdateUser({ user_id: userId, op, ...extra }, getAdminKey())
    const d = await api.auth.adminGetUsers(getAdminKey(), userSearch)
    setAdminUsers(d.users || [])
    setUserActionLoading(null)
  }

  const handleSearch = async () => {
    setUserSearch(userSearchInput)
    const d = await api.auth.adminGetUsers(getAdminKey(), userSearchInput)
    setAdminUsers(d.users || [])
  }

  const handleClearSearch = () => {
    setUserSearchInput("")
    setUserSearch("")
    api.auth.adminGetUsers(getAdminKey()).then(d => setAdminUsers(d.users || []))
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-light text-foreground">Пользователи ({adminUsers.length})</h2>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <Icon name="Search" size={14} className="text-foreground/40 shrink-0" />
          <input
            type="text"
            value={userSearchInput}
            onChange={e => setUserSearchInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Поиск по email / username..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
            style={{ cursor: "text" }}
          />
          {userSearchInput && (
            <button onClick={handleClearSearch} className="text-foreground/30 hover:text-foreground" style={{ cursor: "pointer" }}>
              <Icon name="X" size={13} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)}</div>
      ) : adminUsers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Icon name="Users" size={32} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">Пользователи не найдены</p>
        </div>
      ) : (
        <div className="space-y-2">
          {adminUsers.map(u => {
            const isLoading = userActionLoading === u.id
            return (
              <div key={u.id} className={`rounded-xl border bg-card p-4 transition-all ${u.status === "blocked" ? "border-red-400/40 bg-red-400/5" : "border-border"}`}>
                <div className="flex items-center gap-3">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt={u.username} className="h-10 w-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-sm font-medium text-primary shrink-0">
                      {u.username?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">{u.username}</span>
                      {u.user_tag && <span className="text-xs text-foreground/40">@{u.user_tag}</span>}
                      {u.is_premium && <span className="rounded-full bg-yellow-400/15 border border-yellow-400/30 px-2 py-0.5 text-xs text-yellow-400">★ Премиум</span>}
                      {u.role === "admin" && <span className="rounded-full bg-primary/15 border border-primary/30 px-2 py-0.5 text-xs text-primary">Админ</span>}
                      {u.role === "superadmin" && <span className="rounded-full bg-purple-400/15 border border-purple-400/30 px-2 py-0.5 text-xs text-purple-400">Суперадмин</span>}
                      {u.status === "blocked" && <span className="rounded-full bg-red-400/15 border border-red-400/30 px-2 py-0.5 text-xs text-red-400">Заблокирован</span>}
                      {u.is_muted && <span className="rounded-full bg-orange-400/15 border border-orange-400/30 px-2 py-0.5 text-xs text-orange-400">Мут</span>}
                      {u.warning_count > 0 && <span className="rounded-full bg-yellow-400/15 border border-yellow-400/30 px-2 py-0.5 text-xs text-yellow-400">⚠ {u.warning_count}</span>}
                    </div>
                    <p className="text-xs text-foreground/40 mt-0.5 truncate">{u.email} · {new Date(u.created_at).toLocaleDateString("ru-RU")}</p>
                  </div>
                  {!isLoading ? (
                    <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                      <button onClick={() => adminUserOp(u.id, "set_premium", { value: !u.is_premium })}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${u.is_premium ? "border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10" : "border-border text-foreground/50 hover:border-yellow-400/40 hover:text-yellow-400"}`}
                        style={{ cursor: "pointer" }} title={u.is_premium ? "Убрать премиум" : "Дать премиум"}>★</button>
                      <select value={u.role} onChange={e => adminUserOp(u.id, "set_role", { role: e.target.value })}
                        className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                        style={{ cursor: "pointer" }}>
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                        <option value="superadmin">superadmin</option>
                      </select>
                      <button onClick={() => adminUserOp(u.id, "mute", { value: !u.is_muted })}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${u.is_muted ? "border-orange-400/40 text-orange-400 hover:bg-orange-400/10" : "border-border text-foreground/50 hover:border-orange-400/40 hover:text-orange-400"}`}
                        style={{ cursor: "pointer" }} title={u.is_muted ? "Снять мут" : "Замутить"}>
                        <Icon name={u.is_muted ? "VolumeX" : "Volume2"} size={12} />
                      </button>
                      <button onClick={() => adminUserOp(u.id, "warn")}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:border-yellow-400/40 hover:text-yellow-400 transition-colors"
                        style={{ cursor: "pointer" }} title="Выдать предупреждение">
                        <Icon name="AlertTriangle" size={12} />
                      </button>
                      <button onClick={() => adminUserOp(u.id, "set_status", { status: u.status === "blocked" ? "active" : "blocked" })}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${u.status === "blocked" ? "border-green-400/40 text-green-400 hover:bg-green-400/10" : "border-border text-foreground/50 hover:border-red-400/40 hover:text-red-400"}`}
                        style={{ cursor: "pointer" }} title={u.status === "blocked" ? "Разблокировать" : "Заблокировать"}>
                        <Icon name={u.status === "blocked" ? "Unlock" : "Ban"} size={12} />
                      </button>
                      <button onClick={() => { if (confirm(`Удалить аккаунт ${u.username}? Это действие необратимо!`)) adminUserOp(u.id, "delete") }}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/40 hover:border-red-400 hover:text-red-400 transition-colors"
                        style={{ cursor: "pointer" }} title="Удалить аккаунт">
                        <Icon name="Trash2" size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}