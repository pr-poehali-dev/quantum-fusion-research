import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import StressTesterLink from "@/components/StressTesterLink"
import NotificationBell from "@/components/NotificationBell"
import CatalogTabs from "@/components/CatalogTabs"

interface CommunityBuild {
  id: number
  name: string
  username: string
  author_avatar: string
  author_tag: string
  components: Array<{ slot: string; name: string; price: number; qty: number }>
  parts_total: number
  assembly_fee: number
  total_price: number
  share_token: string
  short_code?: string
  created_at: string
}

function CommunityBuildCard({ build: b, fmt, onLoad, onAuthor }: { build: CommunityBuild; fmt: (n: number) => string; onLoad: () => void; onAuthor: () => void }) {
  const slotNames: Record<string, string> = { cpu: "CPU", gpu: "GPU", ram: "RAM", storage: "SSD", psu: "БП", case: "Корпус", motherboard: "mobo", mobo: "mobo", cooling: "Кулер", cooler: "Кулер" }
  return (
    <div className="rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-all">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1 min-w-0 mr-2">
          <h3 className="font-medium text-foreground">{b.name}</h3>
          <button
            onClick={b.author_tag ? onAuthor : undefined}
            className="mt-1 flex items-center gap-1.5 group"
            style={{ cursor: b.author_tag ? "pointer" : "default" }}
          >
            {b.author_avatar ? (
              <img src={b.author_avatar} alt={b.username} className="h-4 w-4 rounded-full object-cover" />
            ) : (
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[10px] font-medium text-primary shrink-0">
                {b.username[0]?.toUpperCase()}
              </div>
            )}
            <span className={`text-xs text-foreground/50 ${b.author_tag ? "group-hover:text-primary transition-colors" : ""}`}>{b.username}</span>
            <span className="text-xs text-foreground/30">· {new Date(b.created_at).toLocaleDateString("ru-RU")}</span>
          </button>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50 shrink-0">{b.components.length} компонентов</span>
      </div>
      <div className="mb-4 space-y-1.5">
        {b.components.slice(0, 4).map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 rounded bg-muted px-1 py-0.5 text-center text-foreground/40 font-mono text-xs">{slotNames[c.slot] || c.slot}</span>
            <span className="flex-1 truncate text-foreground/70">{c.name}</span>
            <span className="text-foreground/50 shrink-0">{fmt(c.price * (c.qty || 1))}</span>
          </div>
        ))}
        {b.components.length > 4 && <p className="text-xs text-foreground/30 pl-10">+ ещё {b.components.length - 4}</p>}
      </div>
      <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
        <span className="text-foreground/50">Итого со сборкой</span>
        <span className="font-bold text-foreground">{fmt(b.components.reduce((s, c) => s + (c.price || 0) * (c.qty || 1), 0) + (b.assembly_fee || 0))}</span>
      </div>
      <button onClick={onLoad} className="w-full flex items-center justify-center gap-2 rounded-lg border border-border py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
        <Icon name="Copy" size={13} />Открыть в конфигураторе
      </button>
    </div>
  )
}

export default function CommunityBuilds() {
  const navigate = useNavigate()
  const { isAuthed } = useAuth()
  const { count } = useCart()
  const [builds, setBuilds] = useState<CommunityBuild[]>([])
  const [loading, setLoading] = useState(true)

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  useEffect(() => {
    setLoading(true)
    api.auth.getCommunityBuilds().then(data => {
      setBuilds(data.builds || [])
      setLoading(false)
    })
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      {/* Шапка */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <div className="flex items-center gap-2">
            <StressTesterLink />
            <ThemeSwitcher />
            <NotificationBell />
            {isAuthed() ? (
              <button onClick={() => navigate("/profile")} className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="User" size={15} />
              </button>
            ) : (
              <button onClick={() => navigate("/auth")} className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="LogIn" size={15} />
              </button>
            )}
            <button onClick={() => navigate("/cart")} className="relative flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="ShoppingCart" size={16} />
              <span>Корзина</span>
              {count() > 0 && <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">{count()}</span>}
            </button>
          </div>
        </div>
      </header>

      {/* Табы */}
      <CatalogTabs />

      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="mb-2 hidden text-2xl font-light text-foreground sm:block sm:text-3xl">Сборки сообщества</h1>
            <p className="text-sm text-foreground/60">Конфигурации от пользователей BeGraphics — вдохновляйтесь и копируйте</p>
          </div>
          <button
            onClick={() => navigate(isAuthed() ? "/configurator" : "/auth")}
            className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors sm:w-auto"
            style={{ cursor: "pointer" }}
          >
            <Icon name="Plus" size={16} />
            Поделиться сборкой
          </button>
        </div>

        {loading ? (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-56 rounded-xl bg-card animate-pulse" />)}
          </div>
        ) : builds.length === 0 ? (
          <div className="py-24 text-center text-foreground/50">
            <Icon name="Users" size={48} className="mx-auto mb-4 opacity-30" />
            <p className="mb-2">Публичных сборок пока нет</p>
            <p className="text-xs">Станьте первым — сохраните свою сборку в конфигураторе</p>
            <button onClick={() => navigate("/configurator")} className="mt-4 text-sm text-primary hover:underline" style={{ cursor: "pointer" }}>
              Открыть конфигуратор →
            </button>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {builds.map(b => (
              <CommunityBuildCard
                key={b.id}
                build={b}
                fmt={fmt}
                onLoad={() => navigate(b.short_code ? `/s/${b.short_code}` : `/configurator?build=${b.share_token}`)}
                onAuthor={() => b.author_tag && navigate(`/profile/${b.author_tag}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}