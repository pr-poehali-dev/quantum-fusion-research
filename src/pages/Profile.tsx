import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"

interface UserBuild {
  id: number
  name: string
  components: Array<{ slot: string; name: string; price: number; qty: number }>
  parts_total: number
  assembly_fee: number
  total_price: number
  share_token: string
  is_public: boolean
  created_at: string
}

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "ОЗУ",
  storage: "Накопитель", psu: "БП", case: "Корпус",
}

export default function Profile() {
  const { user, sessionId, isAuthed, logout } = useAuth()
  const navigate = useNavigate()
  const [builds, setBuilds] = useState<UserBuild[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => {
    if (!isAuthed() || !sessionId) { navigate("/auth"); return }
    api.auth.getBuilds(sessionId).then(d => {
      setBuilds(d.builds || [])
      setLoading(false)
    })
  }, [])

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const copyLink = (token: string, id: number) => {
    navigator.clipboard.writeText(`${window.location.origin}/configurator?build=${token}`)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleLogout = async () => {
    if (sessionId) await api.auth.logout(sessionId)
    logout()
    navigate("/")
  }

  const loadInConfigurator = (token: string) => {
    navigate(`/configurator?build=${token}`)
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <nav className="hidden items-center gap-6 md:flex">
            <button onClick={() => navigate("/shop")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Каталог</button>
            <button onClick={() => navigate("/configurator")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Конфигуратор</button>
            <button onClick={() => navigate("/profile")} className="text-sm font-medium text-primary" style={{ cursor: "pointer" }}>Профиль</button>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <button onClick={handleLogout} className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="LogOut" size={15} />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* User card */}
        <div className="mb-10 flex items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
            <Icon name="User" size={28} className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-light text-foreground">{user?.username}</h1>
            <p className="text-sm text-foreground/50">{user?.email}</p>
          </div>
          <div className="ml-auto flex gap-3">
            <button
              onClick={() => navigate("/configurator")}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              style={{ cursor: "pointer" }}
            >
              <Icon name="Plus" size={16} />
              Новая сборка
            </button>
          </div>
        </div>

        {/* Builds */}
        <div>
          <h2 className="mb-4 text-lg font-medium text-foreground">Мои сборки</h2>
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-48 rounded-xl bg-card animate-pulse" />)}
            </div>
          ) : builds.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-20 text-center">
              <Icon name="Cpu" size={40} className="mx-auto mb-4 text-foreground/20" />
              <p className="mb-2 text-foreground/50">Сохранённых сборок пока нет</p>
              <button
                onClick={() => navigate("/configurator")}
                className="mt-2 text-sm text-primary hover:underline"
                style={{ cursor: "pointer" }}
              >
                Создать первую сборку →
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {builds.map(b => (
                <div key={b.id} className="rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-all">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-medium text-foreground">{b.name}</h3>
                      <p className="text-xs text-foreground/40">{new Date(b.created_at).toLocaleDateString("ru-RU")}</p>
                    </div>
                    {b.is_public && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Публичная</span>
                    )}
                  </div>

                  {/* Components list */}
                  <div className="mb-4 space-y-1">
                    {b.components.slice(0, 4).map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-foreground/40 w-20 shrink-0">{SLOT_NAMES[c.slot] || c.slot}</span>
                        <span className="flex-1 text-foreground/70 truncate mx-2">{c.name}</span>
                        <span className="text-foreground/60 shrink-0">{fmt(c.price * (c.qty || 1))}</span>
                      </div>
                    ))}
                    {b.components.length > 4 && (
                      <p className="text-xs text-foreground/30">+ ещё {b.components.length - 4}</p>
                    )}
                  </div>

                  {/* Pricing */}
                  <div className="mb-4 rounded-lg bg-muted/50 px-3 py-2 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-foreground/50">Железо</span>
                      <span className="text-foreground">{fmt(b.parts_total)}</span>
                    </div>
                    {b.assembly_fee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-foreground/50">Сборка (7%)</span>
                        <span className="text-foreground">{fmt(b.assembly_fee)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-border/50 pt-1 font-medium">
                      <span className="text-foreground/70">Итого</span>
                      <span className="text-foreground">{fmt(b.total_price)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => loadInConfigurator(b.share_token)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                      style={{ cursor: "pointer" }}
                    >
                      <Icon name="Edit2" size={13} />
                      Открыть
                    </button>
                    <button
                      onClick={() => copyLink(b.share_token, b.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                      style={{ cursor: "pointer" }}
                    >
                      <Icon name={copied === b.id ? "Check" : "Share2"} size={13} />
                      {copied === b.id ? "Скопировано!" : "Поделиться"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}