import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { useCart } from "@/store/cart"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { CartToast } from "@/components/cart-toast"
import { useNavigate, useSearchParams } from "react-router-dom"

interface Product {
  id: number
  name: string
  description: string
  price: number
  old_price: number | null
  image_url: string | null
  specs: Record<string, string>
  in_stock: boolean
  is_featured: boolean
  category: { id: number; name: string; slug: string } | null
}

interface Category {
  id: number
  name: string
  slug: string
  description: string
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
}

interface CommunityBuild {
  id: number
  name: string
  username: string
  components: Array<{ slot: string; name: string; price: number; qty: number }>
  parts_total: number
  assembly_fee: number
  total_price: number
  share_token: string
  created_at: string
}

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "Оперативная память",
  storage: "Накопитель", psu: "Блок питания", case: "Корпус", motherboard: "Материнская плата",
}

export default function Shop() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [builds, setBuilds] = useState<Build[]>([])
  const [communityBuilds, setCommunityBuilds] = useState<CommunityBuild[]>([])
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [buildsLoading, setBuildsLoading] = useState(true)
  const [communityLoading, setCommunityLoading] = useState(true)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedBuild, setSelectedBuild] = useState<Build | null>(null)
  const [shopTab, setShopTab] = useState<"catalog" | "builds" | "community">("catalog")
  const [catOpen, setCatOpen] = useState(false)
  const catBtnRef = useRef<HTMLButtonElement>(null)
  const [catPos, setCatPos] = useState({ top: 0, left: 0 })

  const openCat = () => {
    if (catBtnRef.current) {
      const r = catBtnRef.current.getBoundingClientRect()
      setCatPos({ top: r.bottom + 6, left: r.left })
    }
    setCatOpen(v => !v)
  }

  // Toast state
  const [toastShow, setToastShow] = useState(false)
  const [toastKey, setToastKey] = useState(0)
  const [toastName, setToastName] = useState("")
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const { addItem, updateQty, getItemQty, count } = useCart()
  const { isAuthed } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const tab = searchParams.get("tab")
    if (tab === "community") setShopTab("community")
    else if (searchParams.get("build")) setShopTab("builds")
  }, [searchParams])

  useEffect(() => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (activeCategory !== "all") params.category = activeCategory
    if (search) params.search = search
    // На главной (без фильтров) показываем только рекомендуемые
    if (activeCategory === "all" && !search) params.featured = "true"
    api.products.getAll(params).then(data => {
      setProducts(data.products || [])
      setCategories(data.categories || [])
      setLoading(false)
    })
  }, [activeCategory, search])

  useEffect(() => {
    setBuildsLoading(true)
    api.builds.getAll({ status: "catalog" }).then(data => {
      setBuilds(data.builds || [])
      setBuildsLoading(false)
    })
    setCommunityLoading(true)
    api.auth.getCommunityBuilds().then(data => {
      setCommunityBuilds(data.builds || [])
      setCommunityLoading(false)
    })
  }, [])

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const closeModal = useCallback(() => {
    setSelectedProduct(null)
    setSelectedBuild(null)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { closeModal(); setCatOpen(false) } }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [closeModal])

  // Воспроизведение звука и показ тоста
  const showAddedToast = (name: string) => {
    setToastName(name)
    setToastShow(false)
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToastKey(k => k + 1)
      setToastShow(true)
    }, 50)
    // Звук
    try {
      const ctx = new AudioContext()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.frequency.setValueAtTime(880, ctx.currentTime)
      o.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1)
      g.gain.setValueAtTime(0.15, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      o.start(); o.stop(ctx.currentTime + 0.3)
    } catch { /* AudioContext недоступен */ }
  }

  const handleAddToCart = (p: Product) => {
    addItem({ id: p.id, name: p.name, price: p.price, image_url: p.image_url, type: "product" })
    showAddedToast(p.name)
  }

  const ShopHeader = () => (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
          <span className="font-semibold text-lg text-foreground">BeGraphics</span>
        </button>
        <nav className="hidden items-center gap-6 md:flex">
          <button onClick={() => setShopTab("catalog")} className={`text-sm font-medium transition-colors ${shopTab === "catalog" ? "text-primary" : "text-foreground/70 hover:text-foreground"}`} style={{ cursor: "pointer" }}>Каталог</button>
          <button onClick={() => setShopTab("builds")} className={`text-sm font-medium transition-colors ${shopTab === "builds" ? "text-primary" : "text-foreground/70 hover:text-foreground"}`} style={{ cursor: "pointer" }}>Наши ПК</button>
          <button onClick={() => setShopTab("community")} className={`text-sm font-medium transition-colors ${shopTab === "community" ? "text-primary" : "text-foreground/70 hover:text-foreground"}`} style={{ cursor: "pointer" }}>Сборки</button>
          <button onClick={() => navigate("/configurator")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Конфигуратор</button>
        </nav>
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
  )

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      <ShopHeader />

      {/* Toast */}
      <CartToast key={toastKey} show={toastShow} productName={toastName} />

      {/* Tab selector */}
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-7xl gap-0 px-6 overflow-x-auto">
          {[
            { key: "catalog", label: "Каталог товаров", icon: "Package" },
            { key: "builds", label: "Наши ПК", icon: "Monitor" },
            { key: "community", label: "Сборки сообщества", icon: "Users" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setShopTab(t.key as typeof shopTab)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${shopTab === t.key ? "border-primary text-primary" : "border-transparent text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              <Icon name={t.icon as "Package"} size={15} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* CATALOG TAB */}
        {shopTab === "catalog" && (
          <>
            {/* Search + controls row */}
            <div className="mb-6 flex gap-3">
              {/* Кнопка категорий */}
              <button
                ref={catBtnRef}
                onClick={openCat}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${catOpen ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground/70 hover:border-primary hover:text-foreground"}`}
                style={{ cursor: "pointer" }}
              >
                <Icon name="AlignLeft" size={16} />
                <span className="hidden sm:inline">Категории</span>
                {activeCategory !== "all" && <span className="h-2 w-2 rounded-full bg-primary" />}
              </button>

              <div className="relative flex-1">
                <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
                <input
                  type="text"
                  placeholder="Поиск товаров..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary focus:outline-none"
                  style={{ cursor: "text" }}
                />
              </div>

              <button
                onClick={() => navigate("/configurator")}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground/70 hover:text-foreground hover:border-primary transition-colors"
                style={{ cursor: "pointer" }}
              >
                <Icon name="Cpu" size={16} />
                <span className="hidden sm:inline">Конфигуратор</span>
              </button>
            </div>

            {/* Дропдаун категорий через portal — левее поля, z-50 */}
            {catOpen && createPortal(
              <>
                <div
                  className="fixed inset-0 z-[998]"
                  onClick={() => setCatOpen(false)}
                  style={{ cursor: "auto" }}
                />
                <div
                  className="fixed z-[999] w-80 rounded-2xl border border-border bg-card p-4 shadow-2xl"
                  style={{ top: catPos.top, left: catPos.left, cursor: "auto" }}
                >
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">Категории</p>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => { setActiveCategory("all"); setCatOpen(false) }}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors text-left ${activeCategory === "all" ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-muted hover:text-foreground"}`}
                      style={{ cursor: "pointer" }}
                    >
                      <Icon name="LayoutGrid" size={15} />
                      Все товары
                      {activeCategory === "all" && <Icon name="Check" size={13} className="ml-auto" />}
                    </button>
                    {categories.map(cat => (
                      <button
                        key={cat.slug}
                        onClick={() => { setActiveCategory(cat.slug); setCatOpen(false) }}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors text-left ${activeCategory === cat.slug ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-muted hover:text-foreground"}`}
                        style={{ cursor: "pointer" }}
                      >
                        {cat.name}
                        {activeCategory === cat.slug && <Icon name="Check" size={13} className="ml-auto" />}
                      </button>
                    ))}
                  </div>
                </div>
              </>,
              document.body
            )}

            {/* Активная категория — бейджик */}
            {activeCategory !== "all" && (
              <div className="mb-4 flex items-center gap-2">
                <span className="text-sm text-foreground/60">Категория:</span>
                <span className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {categories.find(c => c.slug === activeCategory)?.name || activeCategory}
                  <button onClick={() => setActiveCategory("all")} className="ml-1" style={{ cursor: "pointer" }}>
                    <Icon name="X" size={11} />
                  </button>
                </span>
              </div>
            )}

            {/* Подзаголовок */}
            {activeCategory === "all" && !search && (
              <p className="mb-4 text-sm text-foreground/50">
                Показываем рекомендуемые товары. Выберите категорию или введите поиск для полного каталога.
              </p>
            )}

            {loading ? (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[...Array(8)].map((_, i) => <div key={i} className="h-72 rounded-xl bg-card animate-pulse" />)}
              </div>
            ) : products.length === 0 ? (
              <div className="py-24 text-center text-foreground/50">
                <Icon name="PackageSearch" size={48} className="mx-auto mb-4 opacity-30" />
                <p>Товары не найдены</p>
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map(p => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onOpen={() => setSelectedProduct(p)}
                    onAddCart={() => handleAddToCart(p)}
                    onUpdateQty={(qty) => updateQty(p.id, qty)}
                    cartQty={getItemQty(p.id, "product")}
                    fmt={fmt}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* BUILDS TAB */}
        {shopTab === "builds" && (
          <>
            <div className="mb-8">
              <h1 className="mb-2 text-3xl font-light text-foreground">Наши ПК</h1>
              <p className="text-sm text-foreground/60">Готовые сборки от BeGraphics с прозрачным составом и ценами</p>
            </div>
            {buildsLoading ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-80 rounded-xl bg-card animate-pulse" />)}
              </div>
            ) : builds.length === 0 ? (
              <div className="py-24 text-center text-foreground/50">
                <Icon name="Monitor" size={48} className="mx-auto mb-4 opacity-30" />
                <p className="mb-2">Сборки ещё не добавлены</p>
                <p className="text-xs">Менеджер добавит актуальные конфигурации в ближайшее время</p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {builds.map(b => (
                  <BuildCard key={b.id} build={b} onOpen={() => setSelectedBuild(b)} onOrder={() => {
                    addItem({ id: b.id, name: b.name, price: b.total_price, type: "config" })
                    navigate("/cart")
                  }} fmt={fmt} />
                ))}
              </div>
            )}
          </>
        )}

        {/* COMMUNITY TAB */}
        {shopTab === "community" && (
          <>
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="mb-2 text-3xl font-light text-foreground">Сборки сообщества</h1>
                <p className="text-sm text-foreground/60">Конфигурации от пользователей BeGraphics — вдохновляйтесь и копируйте</p>
              </div>
              <button
                onClick={() => navigate(isAuthed() ? "/configurator" : "/auth")}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                style={{ cursor: "pointer" }}
              >
                <Icon name="Plus" size={16} />
                Поделиться сборкой
              </button>
            </div>
            {communityLoading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[...Array(6)].map((_, i) => <div key={i} className="h-56 rounded-xl bg-card animate-pulse" />)}
              </div>
            ) : communityBuilds.length === 0 ? (
              <div className="py-24 text-center text-foreground/50">
                <Icon name="Users" size={48} className="mx-auto mb-4 opacity-30" />
                <p className="mb-2">Публичных сборок пока нет</p>
                <p className="text-xs">Станьте первым — сохраните свою сборку в конфигураторе</p>
                <button onClick={() => navigate("/configurator")} className="mt-4 text-sm text-primary hover:underline" style={{ cursor: "pointer" }}>Открыть конфигуратор →</button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {communityBuilds.map(b => (
                  <CommunityBuildCard key={b.id} build={b} fmt={fmt} onLoad={() => navigate(`/configurator?build=${b.share_token}`)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Product Modal */}
      {selectedProduct && (
        <ProductModal
          product={selectedProduct}
          onClose={closeModal}
          onAddCart={() => {
            handleAddToCart(selectedProduct)
            closeModal()
          }}
          fmt={fmt}
        />
      )}

      {/* Build Modal */}
      {selectedBuild && (
        <BuildModal build={selectedBuild} onClose={closeModal} onOrder={() => {
          addItem({ id: selectedBuild.id, name: selectedBuild.name, price: selectedBuild.total_price, type: "config" })
          navigate("/cart")
        }} fmt={fmt} />
      )}


    </div>
  )
}

// ── ProductCard с кнопкой «в корзине» ──
function ProductCard({
  product: p, onOpen, onAddCart, onUpdateQty, cartQty, fmt
}: {
  product: Product
  onOpen: () => void
  onAddCart: () => void
  onUpdateQty: (qty: number) => void
  cartQty: number
  fmt: (n: number) => string
}) {
  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-all duration-300">
      <button onClick={onOpen} className="relative aspect-video bg-muted flex items-center justify-center overflow-hidden" style={{ cursor: "pointer" }}>
        {p.image_url ? (
          <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
        ) : (
          <Icon name="Monitor" size={48} className="text-foreground/20" />
        )}
        {p.old_price && (
          <span className="absolute right-2 top-2 rounded bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
            -{Math.round((1 - p.price / p.old_price) * 100)}%
          </span>
        )}
        {!p.in_stock && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <span className="rounded bg-muted px-3 py-1 text-xs text-foreground/60">Нет в наличии</span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-background/0 group-hover:bg-background/40 transition-all">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-foreground font-medium bg-background/80 px-3 py-1.5 rounded-full">Подробнее</span>
        </div>
      </button>
      <div className="flex flex-col flex-1 p-4">
        {p.category && <span className="mb-1 text-xs text-foreground/40 font-mono">{p.category.name}</span>}
        <button onClick={onOpen} className="mb-2 text-left font-medium text-foreground leading-tight hover:text-primary transition-colors" style={{ cursor: "pointer" }}>{p.name}</button>
        <p className="mb-3 text-xs text-foreground/60 leading-relaxed line-clamp-2">{p.description}</p>
        {Object.keys(p.specs).length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {Object.entries(p.specs).slice(0, 3).map(([k, v]) => (
              <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground/60">{v}</span>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-end justify-between gap-2">
          <div>
            <div className="text-lg font-bold text-foreground">{fmt(p.price)}</div>
            {p.old_price && <div className="text-xs text-foreground/40 line-through">{fmt(p.old_price)}</div>}
          </div>

          {cartQty > 0 ? (
            /* Кнопка «в корзине» с контролем количества */
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs font-medium text-green-400">в корзине</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onUpdateQty(cartQty - 1)}
                  className="flex h-6 w-6 items-center justify-center rounded border border-border text-foreground/60 hover:border-primary hover:text-primary transition-colors"
                  style={{ cursor: "pointer" }}
                >
                  <Icon name="Minus" size={10} />
                </button>
                <span className="w-7 text-center text-xs font-bold text-foreground">{cartQty}шт</span>
                <button
                  onClick={onAddCart}
                  className="flex h-6 w-6 items-center justify-center rounded border border-border text-foreground/60 hover:border-primary hover:text-primary transition-colors"
                  style={{ cursor: "pointer" }}
                >
                  <Icon name="Plus" size={10} />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={onAddCart}
              disabled={!p.in_stock}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              style={{ cursor: p.in_stock ? "pointer" : "not-allowed" }}
            >
              <Icon name="Plus" size={14} />
              В корзину
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function BuildCard({ build: b, onOpen, onOrder, fmt }: { build: Build; onOpen: () => void; onOrder: () => void; fmt: (n: number) => string }) {
  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-all duration-300">
      <button onClick={onOpen} className="relative aspect-video bg-gradient-to-br from-card to-muted flex items-center justify-center overflow-hidden" style={{ cursor: "pointer" }}>
        {b.image_urls?.[0] ? (
          <img src={b.image_urls[0]} alt={b.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Icon name="Cpu" size={40} className="text-primary/40" />
            <span className="text-xs text-foreground/30 font-mono">BeGraphics Build</span>
          </div>
        )}
        <div className="absolute top-2 right-2 rounded-full bg-primary/90 px-2 py-0.5 text-xs font-medium text-primary-foreground">Сборка</div>
        <div className="absolute inset-0 flex items-center justify-center bg-background/0 group-hover:bg-background/40 transition-all">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-foreground font-medium bg-background/80 px-3 py-1.5 rounded-full">Состав и цены</span>
        </div>
      </button>
      <div className="flex flex-col flex-1 p-5">
        <button onClick={onOpen} className="mb-2 text-left text-lg font-medium text-foreground hover:text-primary transition-colors" style={{ cursor: "pointer" }}>{b.name}</button>
        {b.description && <p className="mb-3 text-sm text-foreground/60 line-clamp-2">{b.description}</p>}
        <div className="mb-4 space-y-1">
          {b.components.slice(0, 3).map((c, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-foreground/50">{SLOT_NAMES[c.slot] || c.slot}</span>
              <span className="text-foreground/70 truncate ml-2 max-w-[160px]">{c.name}</span>
            </div>
          ))}
          {b.components.length > 3 && <p className="text-xs text-foreground/30">+ ещё {b.components.length - 3} компонента</p>}
        </div>
        <div className="mt-auto">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-xs text-foreground/40">Итого со сборкой</p>
              <p className="text-2xl font-bold text-foreground">{fmt(b.total_price)}</p>
              <p className="text-xs text-foreground/40">железо {fmt(b.parts_total)} + работа {fmt(b.assembly_fee)}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onOpen} className="flex-1 rounded-lg border border-border py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Подробнее</button>
            <button onClick={onOrder} className="flex-1 rounded-lg bg-primary py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>Заказать</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProductModal({ product: p, onClose, onAddCart, fmt }: { product: Product; onClose: () => void; onAddCart: () => void; fmt: (n: number) => string }) {
  const [imgIdx, setImgIdx] = useState(0)
  const images = p.image_url ? [p.image_url] : []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ cursor: "auto" }}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} style={{ cursor: "pointer" }} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-card overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="relative aspect-video bg-muted flex items-center justify-center">
          {images.length > 0 ? (
            <>
              <img src={images[imgIdx]} alt={p.name} className="h-full w-full object-cover" />
              {images.length > 1 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, i) => (
                    <button key={i} onClick={() => setImgIdx(i)} className={`h-1.5 rounded-full transition-all ${i === imgIdx ? "w-6 bg-primary" : "w-1.5 bg-foreground/30"}`} style={{ cursor: "pointer" }} />
                  ))}
                </div>
              )}
            </>
          ) : <Icon name="Monitor" size={64} className="text-foreground/15" />}
          <button onClick={onClose} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground/70 hover:text-foreground backdrop-blur" style={{ cursor: "pointer" }}>
            <Icon name="X" size={16} />
          </button>
          {p.old_price && <span className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">-{Math.round((1 - p.price / p.old_price) * 100)}%</span>}
        </div>
        <div className="p-6">
          {p.category && <p className="mb-1 font-mono text-xs text-foreground/40">{p.category.name}</p>}
          <h2 className="mb-2 text-2xl font-medium text-foreground">{p.name}</h2>
          {p.description && <p className="mb-4 text-sm text-foreground/70 leading-relaxed">{p.description}</p>}
          {Object.keys(p.specs).length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-xs font-mono text-foreground/40 uppercase tracking-wider">Характеристики</h3>
              <div className="space-y-2">
                {Object.entries(p.specs).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-sm text-foreground/60 capitalize">{k}</span>
                    <span className="text-sm font-medium text-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-bold text-foreground">{fmt(p.price)}</div>
              {p.old_price && <div className="text-sm text-foreground/40 line-through">{fmt(p.old_price)}</div>}
            </div>
            <button onClick={onAddCart} disabled={!p.in_stock} className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors" style={{ cursor: p.in_stock ? "pointer" : "not-allowed" }}>
              <Icon name="ShoppingCart" size={16} />
              {p.in_stock ? "В корзину" : "Нет в наличии"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BuildModal({ build: b, onClose, onOrder, fmt }: { build: Build; onClose: () => void; onOrder: () => void; fmt: (n: number) => string }) {
  const [imgIdx, setImgIdx] = useState(0)
  const images = b.image_urls || []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ cursor: "auto" }}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} style={{ cursor: "pointer" }} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-card overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="relative aspect-video bg-gradient-to-br from-card to-muted flex items-center justify-center">
          {images.length > 0 ? (
            <>
              <img src={images[imgIdx]} alt={b.name} className="h-full w-full object-cover" />
              {images.length > 1 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {images.map((_, i) => (
                    <button key={i} onClick={() => setImgIdx(i)} className={`h-1.5 rounded-full transition-all ${i === imgIdx ? "w-6 bg-primary" : "w-1.5 bg-foreground/30"}`} style={{ cursor: "pointer" }} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3"><Icon name="Cpu" size={56} className="text-primary/30" /><span className="font-mono text-sm text-foreground/30">BeGraphics Build</span></div>
          )}
          <button onClick={onClose} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground/70 hover:text-foreground backdrop-blur" style={{ cursor: "pointer" }}>
            <Icon name="X" size={16} />
          </button>
        </div>
        <div className="p-6">
          <h2 className="mb-2 text-2xl font-medium text-foreground">{b.name}</h2>
          {b.description && <p className="mb-5 text-sm text-foreground/70 leading-relaxed">{b.description}</p>}
          <h3 className="mb-3 font-mono text-xs text-foreground/40 uppercase tracking-wider">Состав и стоимость</h3>
          <div className="mb-2 space-y-2 rounded-xl border border-border p-4">
            {b.components.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 text-xs text-foreground/40 font-mono w-24">{SLOT_NAMES[c.slot] || c.slot}</span>
                  <span className="text-foreground/80 truncate">{c.name}</span>
                </div>
                <span className="ml-3 shrink-0 font-medium text-foreground">{fmt(c.current_price ?? c.price)}</span>
              </div>
            ))}
          </div>
          <div className="mb-6 rounded-xl border border-border/50 bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/60">Железо:</span>
              <span className="text-foreground">{fmt(b.parts_total)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground/60">Сборка (7%):</span>
              <span className="text-foreground">{fmt(b.assembly_fee)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="font-medium text-foreground">Итого:</span>
              <span className="text-xl font-bold text-foreground">{fmt(b.total_price)}</span>
            </div>
          </div>
          <button onClick={onOrder} className="w-full rounded-xl bg-primary py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>Заказать эту сборку</button>
          <p className="mt-2 text-center text-xs text-foreground/40">После оформления менеджер свяжется для подтверждения</p>
        </div>
      </div>
    </div>
  )
}

function CommunityBuildCard({ build: b, fmt, onLoad }: { build: CommunityBuild; fmt: (n: number) => string; onLoad: () => void }) {
  const slotNames: Record<string, string> = { cpu: "CPU", gpu: "GPU", ram: "RAM", storage: "SSD", psu: "БП", case: "Корпус" }
  return (
    <div className="rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-all">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="font-medium text-foreground">{b.name}</h3>
          <p className="text-xs text-foreground/40">от {b.username} · {new Date(b.created_at).toLocaleDateString("ru-RU")}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">{b.components.length} компонентов</span>
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
        <span className="font-bold text-foreground">{fmt(b.total_price)}</span>
      </div>
      <button onClick={onLoad} className="w-full flex items-center justify-center gap-2 rounded-lg border border-border py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
        <Icon name="Copy" size={13} />Открыть в конфигураторе
      </button>
    </div>
  )
}