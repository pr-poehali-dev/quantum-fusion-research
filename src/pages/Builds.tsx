import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useCart } from "@/store/cart"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { CartToast } from "@/components/cart-toast"
import { useRef } from "react"

interface BuildTag {
  id: number
  name: string
  color: string
}

interface Build {
  id: number
  name: string
  description: string
  total_price: number
  parts_total: number
  assembly_fee: number
  assembly_type: string
  components: Array<{ name: string; slot: string; current_price: number; price: number }>
  image_urls: string[]
  status: string
  is_featured: boolean
  in_stock: boolean
  parent_id: number | null
  client_token: string | null
  tags?: BuildTag[]
  variantsCount?: number
}

const TAG_COLOR_MAP: Record<string, string> = {
  primary: "border-primary/40 bg-primary/15 text-primary",
  green: "border-green-400/40 bg-green-400/15 text-green-400",
  blue: "border-blue-400/40 bg-blue-400/15 text-blue-400",
  orange: "border-orange-400/40 bg-orange-400/15 text-orange-400",
  purple: "border-purple-400/40 bg-purple-400/15 text-purple-400",
  red: "border-red-400/40 bg-red-400/15 text-red-400",
}

function getTagClass(color: string) {
  return TAG_COLOR_MAP[color] || TAG_COLOR_MAP.primary
}

function BuildCard({ build: b, onOpen, onOrder, fmt }: { build: Build; onOpen: () => void; onOrder: () => void; fmt: (n: number) => string }) {
  const images = b.image_urls || []
  const hasImage = images.length > 0
  const [imgIdx, setImgIdx] = useState(0)
  const [hovered, setHovered] = useState(false)
  const cpu = b.components.find(c => c.slot === "cpu")
  const gpu = b.components.find(c => c.slot === "gpu")
  const tags = b.tags || []
  const previewTags = tags.slice(0, 2)

  const goImg = (e: React.MouseEvent, dir: 1 | -1) => {
    e.stopPropagation()
    setImgIdx(i => (i + dir + images.length) % images.length)
  }

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative flex flex-col rounded-2xl border border-border overflow-hidden hover:border-primary/50 transition-all duration-300 cursor-pointer"
      style={{ minHeight: 340 }}
    >
      {hasImage ? (
        <div className="absolute inset-0">
          {images.map((url, i) => (
            <img key={i} src={url} alt={b.name}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ opacity: i === imgIdx ? 1 : 0, transition: "opacity 0.6s ease" }}
            />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-muted/80 to-card" />
      )}
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/50 via-black/15 to-transparent group-hover:h-full group-hover:from-black/95 group-hover:via-black/30 transition-all duration-300" />

      {/* Бейджи — слева сверху */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        {!!b.variantsCount && (
          <span className="flex items-center gap-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/80">
            <Icon name="Layers" size={10} />
            {b.variantsCount + 1} варианта
          </span>
        )}
        {previewTags.map(t => (
          <span key={t.id}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-sm transition-all duration-300 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"} ${getTagClass(t.color)}`}
          >
            {t.name}
          </span>
        ))}
      </div>

      {/* Бейджи — справа сверху */}
      <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
        {b.in_stock && (
          <div className="flex items-center gap-1 rounded-full bg-green-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg">
            <Icon name="CheckCircle" size={10} />
            В наличии
          </div>
        )}
        {b.is_featured && (
          <div className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow-lg">
            <Icon name="Star" size={10} />
            Рекомендуем
          </div>
        )}
      </div>

      {/* Стрелки карусели */}
      {images.length > 1 && (
        <div className={`absolute z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${(b.in_stock || b.is_featured) ? "top-16 right-3" : "top-3 right-3"}`}>
          <button onClick={(e) => goImg(e, -1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ChevronLeft" size={12} />
          </button>
          <span className="text-[10px] text-white/70 font-mono">{imgIdx + 1}/{images.length}</span>
          <button onClick={(e) => goImg(e, 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ChevronRight" size={12} />
          </button>
        </div>
      )}

      {/* Точки карусели */}
      {images.length > 1 && (
        <div className="absolute bottom-[88px] left-1/2 z-20 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setImgIdx(i) }}
              className={`rounded-full transition-all duration-300 ${i === imgIdx ? "w-4 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/40"}`}
              style={{ cursor: "pointer" }} />
          ))}
        </div>
      )}

      {/* Hover-оверлей CPU + GPU */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 px-6">
        {cpu && (
          <div className="flex items-center gap-2 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 px-4 py-2 w-full max-w-xs">
            <Icon name="Cpu" size={14} className="text-primary shrink-0" />
            <span className="text-xs text-white/90 truncate">{cpu.name}</span>
          </div>
        )}
        {gpu && (
          <div className="flex items-center gap-2 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 px-4 py-2 w-full max-w-xs">
            <Icon name="Monitor" size={14} className="text-primary shrink-0" />
            <span className="text-xs text-white/90 truncate">{gpu.name}</span>
          </div>
        )}
      </div>

      {/* Контент внизу */}
      <div className="relative z-10 mt-auto p-5">
        <h3 className="mb-3 text-xl font-medium text-white leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-300">
          {b.name}
        </h3>
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xl font-bold text-white">{fmt(b.total_price)}</p>
          <button
            onClick={e => { e.stopPropagation(); onOrder() }}
            className="shrink-0 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            style={{ cursor: "pointer" }}
          >
            Заказать
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Builds() {
  const [builds, setBuilds] = useState<Build[]>([])
  const [loading, setLoading] = useState(true)
  const [allTags, setAllTags] = useState<BuildTag[]>([])
  const [activeTagIds, setActiveTagIds] = useState<number[]>([])
  const [toastShow, setToastShow] = useState(false)
  const [toastKey, setToastKey] = useState(0)
  const [toastName, setToastName] = useState("")
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const { addItem, count } = useCart()
  const { isAuthed } = useAuth()
  const navigate = useNavigate()
  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  useEffect(() => {
    api.tags.getAll().then(d => setAllTags(d.tags || []))
    api.builds.getAll({ status: "catalog" }).then(data => {
      const all: Build[] = Array.isArray(data) ? data : (data.builds || [])
      const variantCounts: Record<number, number> = {}
      all.forEach(b => { if (b.parent_id) variantCounts[b.parent_id] = (variantCounts[b.parent_id] || 0) + 1 })
      const roots = all.filter(b => !b.parent_id).map(b => ({ ...b, variantsCount: variantCounts[b.id] || 0 }))
      setBuilds(roots as Build[])
      setLoading(false)
    })
  }, [])

  const showToast = (name: string) => {
    setToastName(name)
    setToastShow(false)
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => { setToastKey(k => k + 1); setToastShow(true) }, 50)
  }

  const filtered = (activeTagIds.length === 0
    ? builds
    : builds.filter(b => activeTagIds.every(tid => (b.tags || []).some(t => t.id === tid))))
    .slice()
    .sort((a, b) => {
      if (b.in_stock !== a.in_stock) return (b.in_stock ? 1 : 0) - (a.in_stock ? 1 : 0)
      return (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0)
    })

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

      <CartToast key={toastKey} show={toastShow} productName={toastName} />

      {/* Табы — как в Shop */}
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-7xl gap-0 px-6 overflow-x-auto items-stretch">
          <button onClick={() => navigate("/shop")} className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Package" size={15} />
            Каталог товаров
          </button>
          <button className="flex shrink-0 items-center gap-2 border-b-2 border-primary px-5 py-3 text-sm font-medium text-primary transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Monitor" size={15} />
            Наши ПК
          </button>
          <div className="mx-3 my-3 w-px bg-border shrink-0" />
          <button onClick={() => navigate("/configurator")} className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Cpu" size={15} />
            Конфигуратор
          </button>
          <button onClick={() => navigate("/community-builds")} className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Users" size={15} />
            Сборки сообщества
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="mb-2 text-3xl font-light text-foreground">Наши ПК</h1>
          <p className="text-sm text-foreground/60">Готовые сборки от BeGraphics с прозрачным составом и ценами</p>
        </div>

        {/* Фильтр по тегам */}
        {allTags.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={() => setActiveTagIds([])}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${activeTagIds.length === 0 ? "border-primary bg-primary/15 text-primary" : "border-border text-foreground/50 hover:border-primary hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              Все
            </button>
            {allTags.map(t => {
              const active = activeTagIds.includes(t.id)
              return (
                <button key={t.id}
                  onClick={() => setActiveTagIds(ids => active ? ids.filter(i => i !== t.id) : [...ids, t.id])}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all ${active ? getTagClass(t.color) : "border-border text-foreground/50 hover:border-primary hover:text-foreground"}`}
                  style={{ cursor: "pointer" }}
                >
                  {t.name}
                </button>
              )
            })}
          </div>
        )}

        {loading ? (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-80 rounded-xl bg-card animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center text-foreground/50">
            <Icon name="Monitor" size={48} className="mx-auto mb-4 opacity-30" />
            <p className="mb-2">{builds.length === 0 ? "Сборки ещё не добавлены" : "Нет сборок с выбранными тегами"}</p>
            {builds.length > 0 && <button onClick={() => setActiveTagIds([])} className="mt-3 text-sm text-primary hover:underline" style={{ cursor: "pointer" }}>Сбросить фильтр</button>}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map(b => (
              <BuildCard key={b.id} build={b}
                onOpen={() => navigate(`/build-preview/${b.id}`)}
                onOrder={() => {
                  addItem({ id: b.id, name: b.name, price: b.total_price, type: "config" })
                  showToast(b.name)
                }}
                fmt={fmt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}