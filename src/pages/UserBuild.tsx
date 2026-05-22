import { useState, useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useCart } from "@/store/cart"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { useAuth } from "@/store/auth"

const SLOT_LABELS: Record<string, string> = {
  cpu: "Процессор", motherboard: "Материнская плата", gpu: "Видеокарта",
  ram: "Оперативная память", storage: "Накопитель", cooling: "Система охлаждения",
  psu: "Блок питания", case: "Корпус", fan: "Вентилятор",
}

interface BuildData {
  id: number
  name: string
  description: string
  components: Array<{ slot: string; name: string; price: number; qty?: number }>
  parts_total: number
  assembly_fee: number
  total_price: number
  share_token: string
  is_public: boolean
  created_at: string
  username: string
  author_avatar: string
  author_tag: string
  image_urls: string[]
}

export default function UserBuild() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { count } = useCart()
  const { isAuthed } = useAuth()
  const [build, setBuild] = useState<BuildData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeImg, setActiveImg] = useState(0)
  const [copied, setCopied] = useState(false)

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  useEffect(() => {
    if (!token) return
    api.auth.getUserBuild(token).then(data => {
      if (data.error) setError(data.error)
      else setBuild(data)
      setLoading(false)
    })
  }, [token])

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )

  if (error || !build) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <Icon name="PackageSearch" size={48} className="opacity-30" />
      <p className="text-lg font-light">{error || "Сборка не найдена"}</p>
      <button onClick={() => navigate("/community-builds")} className="text-sm text-primary hover:underline" style={{ cursor: "pointer" }}>
        Смотреть сборки сообщества →
      </button>
    </div>
  )

  const images = build.image_urls?.filter(u => u) || []
  const components = build.components || []
  const grouped = Object.entries(SLOT_LABELS).map(([slot, label]) => {
    const items = components.filter(c => c.slot === slot)
    return items.length > 0 ? { slot, label, items } : null
  }).filter(Boolean) as { slot: string; label: string; items: typeof components }[]

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
            <ThemeSwitcher />
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

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">

          {/* Левая колонка */}
          <div className="space-y-6">
            {/* Галерея */}
            {images.length > 0 && (
              <div className="space-y-2">
                <div className="overflow-hidden rounded-2xl border border-border bg-card aspect-video">
                  <img src={images[activeImg]} alt={build.name} className="h-full w-full object-cover" />
                </div>
                {images.length > 1 && (
                  <div className="flex gap-2">
                    {images.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveImg(i)}
                        className={`h-16 w-24 overflow-hidden rounded-lg border-2 transition-all ${activeImg === i ? "border-primary" : "border-border"}`}
                        style={{ cursor: "pointer" }}
                      >
                        <img src={img} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Заголовок */}
            <div>
              <h1 className="text-3xl font-light text-foreground">{build.name}</h1>
              <p className="mt-1 text-sm text-foreground/50">
                {new Date(build.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>

            {/* Описание */}
            {build.description && (
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{build.description}</p>
              </div>
            )}

            {/* Компоненты */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-base font-medium text-foreground">Состав сборки</h2>
              <div className="space-y-2">
                {grouped.map(({ slot, label, items }) => (
                  <div key={slot}>
                    {items.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/40 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-28 shrink-0 text-xs text-foreground/40">{label}</span>
                          <span className="truncate text-sm text-foreground">{c.name}</span>
                          {c.qty && c.qty > 1 && <span className="shrink-0 text-xs text-foreground/40">×{c.qty}</span>}
                        </div>
                        <span className="shrink-0 text-sm font-medium text-foreground">{fmt(c.price * (c.qty || 1))}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <span className="text-sm text-foreground/50">Железо</span>
                <span className="font-medium text-foreground">{fmt(build.parts_total)}</span>
              </div>
              {build.assembly_fee > 0 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-sm text-foreground/50">Сборка</span>
                  <span className="font-medium text-foreground">+ {fmt(build.assembly_fee)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-border pt-3 mt-2">
                <span className="font-medium text-foreground">Итого</span>
                <span className="text-2xl font-bold text-foreground">{fmt(build.total_price)}</span>
              </div>
            </div>
          </div>

          {/* Правая колонка */}
          <div className="space-y-4">
            {/* Автор */}
            <button
              onClick={() => build.author_tag ? navigate(`/profile/${build.author_tag}`) : undefined}
              className="w-full flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 hover:border-primary transition-colors"
              style={{ cursor: build.author_tag ? "pointer" : "default" }}
            >
              {build.author_avatar ? (
                <img src={build.author_avatar} alt={build.username} className="h-14 w-14 rounded-full object-cover shrink-0" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/20 text-2xl font-medium text-primary shrink-0">
                  {build.username?.[0]?.toUpperCase()}
                </div>
              )}
              <div className="text-left">
                <p className="text-xs text-foreground/50 mb-0.5">Автор сборки</p>
                <p className="text-base font-semibold text-foreground">{build.username}</p>
                {build.author_tag && <p className="text-xs text-foreground/40">@{build.author_tag}</p>}
              </div>
            </button>

            {/* Действия */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <button
                onClick={() => navigate(`/configurator?build=${build.share_token}`)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                style={{ cursor: "pointer" }}
              >
                <Icon name="Copy" size={15} />
                Открыть в конфигураторе
              </button>
              <button
                onClick={copyLink}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors"
                style={{ cursor: "pointer" }}
              >
                <Icon name={copied ? "Check" : "Link"} size={15} />
                {copied ? "Скопировано!" : "Скопировать ссылку"}
              </button>
              <button
                onClick={() => navigate("/community-builds")}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm text-foreground/50 hover:text-foreground transition-colors"
                style={{ cursor: "pointer" }}
              >
                <Icon name="Users" size={14} />
                Сборки сообщества
              </button>
            </div>

            {/* Цена */}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
              <p className="text-xs text-foreground/50 mb-1">Стоимость сборки</p>
              <p className="text-3xl font-bold text-foreground">{fmt(build.total_price)}</p>
              {build.assembly_fee > 0 && (
                <p className="text-xs text-foreground/40 mt-1">включая сборку {fmt(build.assembly_fee)}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
