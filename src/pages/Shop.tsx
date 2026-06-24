import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { useCart } from "@/store/cart"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import NotificationBell from "@/components/NotificationBell"
import { CartToast } from "@/components/cart-toast"
import CatalogTabs from "@/components/CatalogTabs"
import { useNavigate, useSearchParams } from "react-router-dom"
import ShopFilters, { ShopAttr, ShopSpecProduct, ShopFilterState, ShopSortKey, emptyFilterState, applyShopFilters, sortShopProducts, ShopSortControl } from "@/components/shop/ShopFilters"

interface Product {
  id: number
  name: string
  description: string
  price: number
  old_price: number | null
  image_url: string | null
  image_urls?: string[]
  specs: Record<string, string>
  in_stock: boolean
  is_featured: boolean
  is_used?: boolean
  avg_cost: number
  category: { id: number; name: string; slug: string } | null
}

interface Category {
  id: number
  name: string
  slug: string
  description: string
}

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
  reserved?: boolean
  parent_id: number | null
  client_token: string | null
  tags?: BuildTag[]
  variantsCount?: number
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

// Расстояние Левенштейна — для «плюс-минус» распознавания категории с ошибками
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

// Подбирает наиболее похожую категорию по введённому тексту (с опечатками).
// Возвращает категорию или null, если уверенного совпадения нет.
function matchCategory<T extends { name: string; slug: string }>(query: string, categories: T[]): T | null {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return null
  let best: T | null = null
  let bestScore = Infinity
  for (const c of categories) {
    const name = c.name.toLowerCase()
    const slug = c.slug.toLowerCase()
    // Прямое вхождение — мгновенно
    if (name.includes(q) || slug.includes(q) || q.includes(name) || q.includes(slug)) return c
    // Похожесть по словам названия
    const candidates = [name, slug, ...name.split(/\s+/)]
    for (const cand of candidates) {
      const d = levenshtein(q, cand)
      const maxLen = Math.max(q.length, cand.length)
      const ratio = d / maxLen
      if (ratio < 0.45 && d < bestScore) { bestScore = d; best = c }
    }
  }
  return best
}

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "Оперативная память",
  storage: "Накопитель", psu: "Блок питания", case: "Корпус", motherboard: "Материнская плата",
}

const SLOT_ICONS: Record<string, string> = {
  cpu: "Cpu", gpu: "Monitor", ram: "MemoryStick", storage: "HardDrive",
  psu: "Zap", case: "Package", motherboard: "CircuitBoard",
}

export default function Shop() {
  const [products, setProducts] = useState<Product[]>([])
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [builds, setBuilds] = useState<Build[]>([])
  const [communityBuilds, setCommunityBuilds] = useState<CommunityBuild[]>([])
  const [activeCategory, setActiveCategory] = useState<string>(
    () => new URLSearchParams(window.location.search).get("category") || "all"
  )
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [usedOnly, setUsedOnly] = useState(false)
  // Фильтры по характеристикам/бренду для выбранной категории
  const [specAttrs, setSpecAttrs] = useState<ShopAttr[]>([])
  const [specProducts, setSpecProducts] = useState<ShopSpecProduct[]>([])
  const [specLoading, setSpecLoading] = useState(false)
  const [filterState, setFilterState] = useState<ShopFilterState>(emptyFilterState)
  const [sortKey, setSortKey] = useState<ShopSortKey>("default")
  const [openAttr, setOpenAttr] = useState<Record<number | string, boolean>>({ brand: true })
  const [allTags, setAllTags] = useState<BuildTag[]>([])
  const [activeTagIds, setActiveTagIds] = useState<number[]>([])
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
    api.products.getAll({}).then(data => {
      setAllProducts(data.products || [])
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (activeCategory !== "all") params.category = activeCategory
    if (search) params.search = search
    api.products.getAll(params).then(data => {
      setProducts(data.products || [])
      setCategories(data.categories || [])
      setLoading(false)
    })
  }, [activeCategory, search])

  // При выборе конкретной категории — подтягиваем её характеристики и товары
  // со значениями (для фильтров). Для «Все» / Б/У — не нужно.
  useEffect(() => {
    setFilterState(emptyFilterState())
    setSortKey("default")
    if (activeCategory === "all" || usedOnly) {
      setSpecAttrs([]); setSpecProducts([]); return
    }
    setSpecLoading(true)
    api.warehouse.specSlotProducts(activeCategory).then(d => {
      setSpecAttrs(d.attributes || [])
      setSpecProducts(d.products || [])
      setSpecLoading(false)
    }).catch(() => { setSpecAttrs([]); setSpecProducts([]); setSpecLoading(false) })
  }, [activeCategory, usedOnly])

  useEffect(() => {
    api.tags.getAll().then(d => setAllTags(d.tags || []))
  }, [])

  useEffect(() => {
    setBuildsLoading(true)
    api.builds.getAll({ status: "catalog" }).then(data => {
      const all: Build[] = Array.isArray(data) ? data : (data.builds || [])
      // Считаем количество вариантов для каждой корневой сборки
      const variantCounts: Record<number, number> = {}
      all.forEach(b => { if (b.parent_id) variantCounts[b.parent_id] = (variantCounts[b.parent_id] || 0) + 1 })
      // Показываем только корневые (без parent_id) со статусом "на сайте"
      const roots = all
        .filter(b => !b.parent_id)
        .map(b => ({ ...b, variantsCount: variantCounts[b.id] || 0 }))
      setBuilds(roots as Build[])
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

  const handleAddToCart = (p: Product, preorder = false) => {
    addItem({ id: p.id, name: p.name, price: p.price, image_url: p.image_url, description: p.description, type: "product", preorder })
    showAddedToast(p.name)
  }

  const ShopHeader = () => (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
          <span className="font-semibold text-lg text-foreground">BeGraphics</span>
        </button>
        <div className="flex items-center gap-2">
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
  )

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      <ShopHeader />

      {/* Toast */}
      <CartToast key={toastKey} show={toastShow} productName={toastName} />

      {/* Tab selector */}
      <CatalogTabs />

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
                  placeholder="Поиск товаров или категории (Enter)..."
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const q = searchInput.trim()
                      // Если ввод похож на категорию — открываем её, иначе обычный поиск
                      const matchedCat = q.length >= 2 ? matchCategory(q, categories) : null
                      if (matchedCat) {
                        setActiveCategory(matchedCat.slug)
                        setSearch("")
                        setSearchInput("")
                      } else {
                        setActiveCategory("all")
                        setSearch(q)
                      }
                      e.currentTarget.blur()
                    }
                  }}
                  className="w-full rounded-lg border border-border bg-card pl-9 pr-9 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary focus:outline-none"
                  style={{ cursor: "text" }}
                />
                {(searchInput || search) && (
                  <button
                    onClick={() => { setSearchInput(""); setSearch("") }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground"
                    style={{ cursor: "pointer" }}
                    title="Очистить поиск"
                  >
                    <Icon name="X" size={15} />
                  </button>
                )}
                {/* Выпадающая подсказка при наборе — НЕ трогает фон, чисто предпросмотр */}
                {searchFocused && searchInput.trim().length >= 2 && (() => {
                  const q = searchInput.trim().toLowerCase()
                  const matchedCat = matchCategory(searchInput, categories)
                  const hasPhoto = (p: Product) => !!(p.image_url || (p.image_urls && p.image_urls.length > 0))
                  const found = allProducts
                    .filter(p => hasPhoto(p) && p.name.toLowerCase().includes(q))
                    .sort((a, b) => (b.in_stock ? 1 : 0) - (a.in_stock ? 1 : 0))
                    .slice(0, 5)
                  if (!matchedCat && found.length === 0) return null
                  return (
                    <div className="absolute left-0 top-full z-40 mt-2 w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
                      {matchedCat && matchedCat.slug !== activeCategory && (
                        <button
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { setActiveCategory(matchedCat.slug); setSearch(""); setSearchInput(""); setSearchFocused(false) }}
                          className="flex w-full items-center gap-2 border-b border-border bg-primary/5 px-4 py-2.5 text-left text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                          style={{ cursor: "pointer" }}
                        >
                          <Icon name="FolderOpen" size={15} />
                          Перейти в категорию «{matchedCat.name}»
                        </button>
                      )}
                      {found.map(p => (
                        <button
                          key={p.id}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => navigate(`/product/${p.id}`)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted transition-colors"
                          style={{ cursor: "pointer" }}
                        >
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-muted">
                            {(p.image_url || p.image_urls?.[0]) && (
                              <img src={p.image_url || p.image_urls?.[0]} alt="" className="h-full w-full object-cover" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-foreground">{p.name}</p>
                            <p className="text-xs text-foreground/40">{fmt(p.price)}{!p.in_stock && " · под заказ"}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>

              <button
                onClick={() => { const next = !usedOnly; setUsedOnly(next); if (next) { setActiveCategory("all"); setSearch(""); setSearchInput("") } }}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${usedOnly ? "border-amber-500 bg-amber-500/10 text-amber-500" : "border-border bg-card text-foreground/70 hover:text-foreground hover:border-primary"}`}
                style={{ cursor: "pointer" }}
                title="Показать только бывшие в употреблении"
              >
                <Icon name="RotateCcw" size={16} />
                <span className="hidden sm:inline">Б/У</span>
              </button>

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
                      onClick={() => { setActiveCategory("all"); setSearch(""); setSearchInput(""); setCatOpen(false) }}
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
                        onClick={() => { setActiveCategory(cat.slug); setSearch(""); setSearchInput(""); setCatOpen(false) }}
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

            {/* Категорийный режим: sidebar с фильтрами по характеристикам/бренду */}
            {activeCategory !== "all" && !usedOnly ? (
              specLoading ? (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {[...Array(8)].map((_, i) => <div key={i} className="h-72 rounded-xl bg-card animate-pulse" />)}
                </div>
              ) : (() => {
                const hasPhoto = (p: ShopSpecProduct) => !!(p.image_url || (p.image_urls && p.image_urls.length > 0))
                // Поиск по названию + фильтры панели
                const bySearch = search
                  ? specProducts.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
                  : specProducts
                const filtered = sortShopProducts(
                  applyShopFilters(bySearch, filterState).filter(hasPhoto),
                  sortKey,
                )
                // Карточки рендерим по полному Product из allProducts (там old_price, is_used и т.д.)
                const byId = new Map(allProducts.map(p => [p.id, p]))
                return (
                  <div className="flex flex-col gap-6 sm:flex-row">
                    <ShopFilters
                      attributes={specAttrs}
                      products={specProducts}
                      state={filterState}
                      setState={setFilterState}
                      openAttr={openAttr}
                      setOpenAttr={setOpenAttr}
                    />
                    <div className="min-w-0 flex-1">
                      {filtered.length === 0 ? (
                        <div className="py-24 text-center text-foreground/50">
                          <Icon name="PackageSearch" size={48} className="mx-auto mb-4 opacity-30" />
                          <p>Ничего не найдено по выбранным фильтрам</p>
                        </div>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-foreground/40">Найдено: {filtered.length}</p>
                            <ShopSortControl attributes={specAttrs} products={specProducts} value={sortKey} onChange={setSortKey} />
                          </div>
                          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                            {filtered.map(sp => {
                              const p = byId.get(sp.id) || ({
                                id: sp.id, name: sp.name, description: sp.description || "", price: sp.price,
                                old_price: null, image_url: sp.image_url || null, image_urls: sp.image_urls,
                                specs: {}, in_stock: !!sp.in_stock, is_featured: false, avg_cost: 0, category: null,
                              } as Product)
                              return (
                                <ProductCard
                                  key={p.id}
                                  product={p}
                                  onOpen={() => setSelectedProduct(p)}
                                  onAddCart={() => handleAddToCart(p)}
                                  onPreorder={() => handleAddToCart(p, true)}
                                  onUpdateQty={(qty) => updateQty(p.id, qty)}
                                  cartQty={getItemQty(p.id, "product")}
                                  fmt={fmt}
                                  onNavigate={() => navigate(`/product/${p.id}`)}
                                />
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })()
            ) : loading ? (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[...Array(8)].map((_, i) => <div key={i} className="h-72 rounded-xl bg-card animate-pulse" />)}
              </div>
            ) : (usedOnly ? allProducts.filter(p => p.is_used).length === 0 : products.length === 0) ? (
              <div className="py-24 text-center text-foreground/50">
                <Icon name="PackageSearch" size={48} className="mx-auto mb-4 opacity-30" />
                <p>{usedOnly ? "Б/У товаров пока нет" : "Товары не найдены"}</p>
              </div>
            ) : (() => {
              // Показываем товар только если у него есть фото (без фото — скрываем,
              // даже не в наличии остаётся виден, если фото есть)
              const hasPhoto = (p: Product) => !!(p.image_url || (p.image_urls && p.image_urls.length > 0))
              // При фильтре Б/У показываем ВСЕ б/у-лоты из полного списка,
              // независимо от выбранной категории
              const visible = (usedOnly ? allProducts.filter(p => p.is_used) : products).filter(hasPhoto)
              const sorted = [...visible].sort((a, b) => (b.in_stock ? 1 : 0) - (a.in_stock ? 1 : 0))
              // Рекомендуемые — всегда все is_featured из products (без фильтра по категории)
              const featuredSource = ((activeCategory === "all" && !search && !usedOnly && allProducts.length > 0) ? allProducts : visible).filter(hasPhoto)
              const featured = [...featuredSource]
                .filter(p => p.is_featured)
                .sort((a, b) => (b.in_stock ? 1 : 0) - (a.in_stock ? 1 : 0))
              const rest = sorted.filter(p => !p.is_featured)
              const renderCard = (p: Product) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onOpen={() => setSelectedProduct(p)}
                  onAddCart={() => handleAddToCart(p)}
                  onPreorder={() => handleAddToCart(p, true)}
                  onUpdateQty={(qty) => updateQty(p.id, qty)}
                  cartQty={getItemQty(p.id, "product")}
                  fmt={fmt}
                  onNavigate={() => navigate(`/product/${p.id}`)}
                />
              )
              // Б/У комплектующие из allProducts (в наличии)
              const usedProducts = allProducts
                .filter(p => p.is_used && p.in_stock && hasPhoto(p))
                .sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0))

              // Режим «Только Б/У» — плоский список всех б/у-лотов, без групп
              if (usedOnly) {
                return (
                  <>
                    <div className="mb-4 flex items-center gap-2">
                      <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">Б/У</span>
                      <p className="text-xs font-mono uppercase tracking-widest text-foreground/40">Бывшие в употреблении с гарантией</p>
                    </div>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {sorted.map(renderCard)}
                    </div>
                  </>
                )
              }

              // По категориям из allProducts — топ-3 по марже на категорию.
              // Показываем и товары под заказ (нет в наличии, но с фото),
              // в наличии — выше.
              const catProducts = categories.map(cat => {
                const inCat = allProducts
                  .filter(p => p.category?.slug === cat.slug && hasPhoto(p))
                  .sort((a, b) => {
                    if ((b.in_stock ? 1 : 0) !== (a.in_stock ? 1 : 0)) return (b.in_stock ? 1 : 0) - (a.in_stock ? 1 : 0)
                    const mA = a.avg_cost > 0 ? (a.price - a.avg_cost) / a.price : 0
                    const mB = b.avg_cost > 0 ? (b.price - b.avg_cost) / b.price : 0
                    return mB - mA
                  })
                return { cat, top: inCat.slice(0, 3) }
              }).filter(({ top }) => top.length > 0)

              return (
                <>
                  {featured.length > 0 && (
                    <>
                      {rest.length > 0 && <p className="mb-3 text-3xl font-mono uppercase tracking-widest text-primary">Рекомендуем</p>}
                      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {featured.map(renderCard)}
                      </div>
                    </>
                  )}
                  {/* Остальные товары — при выбранной категории или поиске показываем весь список */}
                  {(activeCategory !== "all" || search) && rest.length > 0 && (
                    <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${featured.length > 0 ? "mt-6" : ""}`}>
                      {rest.map(renderCard)}
                    </div>
                  )}
                  {/* Б/У комплектующие — на главной без фильтра */}
                  {usedProducts.length > 0 && activeCategory === "all" && !search && !usedOnly && (
                    <div className={featured.length > 0 ? "mt-10" : ""}>
                      <div className="mb-4 flex items-center gap-2">
                        <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">Б/У</span>
                        <p className="text-xs font-mono uppercase tracking-widest text-foreground/40">Комплектующие бывшие в употреблении с гарантией</p>
                      </div>
                      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                        {usedProducts.slice(0, 3).map(renderCard)}
                        <button
                          onClick={() => setUsedOnly(true)}
                          style={{ cursor: "pointer" }}
                          className="group flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-500/40 bg-card hover:border-amber-500/70 hover:bg-amber-500/5 transition-all duration-300 min-h-[200px] gap-3 p-6"
                        >
                          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/40 group-hover:border-amber-500/70 transition-colors">
                            <Icon name="ArrowRight" size={20} className="text-amber-500/70 group-hover:text-amber-500 transition-colors" />
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-medium text-foreground/60 group-hover:text-foreground transition-colors">Посмотреть все Б/У</p>
                            <p className="mt-0.5 text-xs text-foreground/30">{usedProducts.length} шт.</p>
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Блоки по категориям — только на главной без фильтра */}
                  {catProducts.length > 0 && activeCategory === "all" && !search && (
                    <div className={`space-y-10 ${featured.length > 0 ? "mt-10" : ""}`}>
                      {catProducts.map(({ cat, top }) => (
                        <div key={cat.slug}>
                          <p className="mb-4 text-xs font-mono uppercase tracking-widest text-foreground/40">{cat.name}</p>
                          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                            {top.map(renderCard)}
                            {/* Бокс "Посмотреть все" */}
                            <button
                              onClick={() => { setActiveCategory(cat.slug) }}
                              style={{ cursor: "pointer" }}
                              className="group flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all duration-300 min-h-[200px] gap-3 p-6"
                            >
                              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border group-hover:border-primary/40 transition-colors">
                                <Icon name="ArrowRight" size={20} className="text-foreground/40 group-hover:text-primary transition-colors" />
                              </div>
                              <div className="text-center">
                                <p className="text-sm font-medium text-foreground/60 group-hover:text-foreground transition-colors">Посмотреть все</p>
                                <p className="mt-0.5 text-xs text-foreground/30">{cat.name}</p>
                              </div>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )
            })()}
          </>
        )}

        {/* BUILDS TAB */}
        {shopTab === "builds" && (
          <>
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
                    <button
                      key={t.id}
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

            {buildsLoading ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-80 rounded-xl bg-card animate-pulse" />)}
              </div>
            ) : (() => {
              const filtered = (activeTagIds.length === 0
                ? builds
                : builds.filter(b => activeTagIds.every(tid => (b.tags || []).some(t => t.id === tid))))
                .slice()
                .sort((a, b) => {
                  if (b.in_stock !== a.in_stock) return (b.in_stock ? 1 : 0) - (a.in_stock ? 1 : 0)
                  return (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0)
                })
              return filtered.length === 0 ? (
                <div className="py-24 text-center text-foreground/50">
                  <Icon name="Monitor" size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="mb-2">{builds.length === 0 ? "Сборки ещё не добавлены" : "Нет сборок с выбранными тегами"}</p>
                  {builds.length === 0 && <p className="text-xs">Менеджер добавит актуальные конфигурации в ближайшее время</p>}
                  {builds.length > 0 && <button onClick={() => setActiveTagIds([])} className="mt-3 text-sm text-primary hover:underline" style={{ cursor: "pointer" }}>Сбросить фильтр</button>}
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.map(b => (
                    <BuildCard key={b.id} build={b} onOpen={() => navigate(`/build-preview/${b.id}`)} onOrder={() => {
                      const p = b.components.reduce((s, c) => s + (c.price || 0), 0) + (b.assembly_fee || 0)
                      addItem({ id: b.id, name: b.name, price: p, type: "config" })
                      navigate("/cart")
                    }} fmt={fmt} />
                  ))}
                </div>
              )
            })()}
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
          const p = selectedBuild.components.reduce((s, c) => s + (c.price || 0), 0) + (selectedBuild.assembly_fee || 0)
          addItem({ id: selectedBuild.id, name: selectedBuild.name, price: p, type: "config" })
          navigate("/cart")
        }} fmt={fmt} />
      )}


    </div>
  )
}

// ── Мини-карусель фото для карточки товара ──
function ProductImageCarousel({ images, name, inStock }: { images: string[]; name: string; inStock: boolean }) {
  const [idx, setIdx] = useState(0)
  if (!images.length) return (
    <div className="relative h-full w-full flex flex-col items-center justify-center overflow-hidden">
      <img src="https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/7e41fee1-74d8-448d-8412-0435e59185ae.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <Icon name="ImageOff" size={20} className="text-foreground/40" />
        <span className="text-[11px] text-foreground/40 font-medium">Фото готовятся</span>
      </div>
    </div>
  )
  return (
    <div className="relative h-full w-full">
      {images.map((src, i) => (
        <img key={i} src={src} alt={name}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${i === idx ? "opacity-100" : "opacity-0"}`} />
      ))}
      {images.length > 1 && (
        <>
          <button onClick={e => { e.stopPropagation(); setIdx(i => (i - 1 + images.length) % images.length) }}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity hover:border-primary"
            style={{ cursor: "pointer" }}>
            <Icon name="ChevronLeft" size={12} />
          </button>
          <button onClick={e => { e.stopPropagation(); setIdx(i => (i + 1) % images.length) }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity hover:border-primary"
            style={{ cursor: "pointer" }}>
            <Icon name="ChevronRight" size={12} />
          </button>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1 z-10">
            {images.map((_, i) => (
              <button key={i} onClick={e => { e.stopPropagation(); setIdx(i) }}
                className={`rounded-full transition-all ${i === idx ? "w-3 h-1 bg-primary" : "w-1 h-1 bg-white/50"}`}
                style={{ cursor: "pointer" }} />
            ))}
          </div>
        </>
      )}
      {!inStock && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
          <span className="rounded-xl border border-white/25 bg-black/50 px-4 py-1.5 text-sm font-semibold uppercase tracking-widest text-white backdrop-blur-sm">
            Нет в наличии
          </span>
        </div>
      )}
    </div>
  )
}

// ── ProductCard с кнопкой «в корзине» ──
function ProductCard({
  product: p, onOpen, onAddCart, onPreorder, onUpdateQty, cartQty, fmt, onNavigate
}: {
  product: Product
  onOpen: () => void
  onAddCart: () => void
  onPreorder: () => void
  onUpdateQty: (qty: number) => void
  cartQty: number
  fmt: (n: number) => string
  onNavigate: () => void
}) {
  const images = p.image_urls?.length ? p.image_urls : p.image_url ? [p.image_url] : []
  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-all duration-300">
      <button onClick={onOpen} className="relative aspect-video bg-muted flex items-center justify-center overflow-hidden" style={{ cursor: "pointer" }}>
        <ProductImageCarousel images={images} name={p.name} inStock={p.in_stock} />
        {p.is_used && (
          <span className="absolute left-2 top-2 z-10 rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
            Б/У
          </span>
        )}
        {p.old_price && p.in_stock && (
          <span className="absolute right-2 top-2 z-10 rounded bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
            -{Math.round((1 - p.price / p.old_price) * 100)}%
          </span>
        )}
        {p.in_stock && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/0 group-hover:bg-background/30 transition-all z-10">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-foreground font-medium bg-background/80 px-3 py-1.5 rounded-full">Предпросмотр</span>
          </div>
        )}
      </button>
      <button onClick={onNavigate} className="flex flex-col flex-1 p-4 text-left" style={{ cursor: "pointer" }}>
        {p.category && <span className="mb-1 text-xs text-foreground/40 font-mono">{p.category.name}</span>}
        <span className="mb-2 font-medium text-foreground leading-tight group-hover:text-primary transition-colors">{p.name}</span>
        {p.description && (
          <div className="mb-3 text-xs text-foreground/60 leading-relaxed line-clamp-3 rich-content" dangerouslySetInnerHTML={{ __html: p.description }} />
        )}
        {Object.keys(p.specs).length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {Object.entries(p.specs).slice(0, 3).map(([k, v]) => (
              <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground/60">{v}</span>
            ))}
          </div>
        )}
        <div className="mt-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-lg font-bold text-foreground">{fmt(p.price)}</div>
              {p.old_price && <div className="text-xs text-foreground/40 line-through">{fmt(p.old_price)}</div>}
            </div>
            {cartQty > 0 ? (
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs font-medium text-green-400">в корзине</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => onUpdateQty(cartQty - 1)} className="flex h-6 w-6 items-center justify-center rounded border border-border text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Minus" size={10} />
                  </button>
                  <span className="w-7 text-center text-xs font-bold text-foreground">{cartQty}шт</span>
                  <button onClick={onAddCart} className="flex h-6 w-6 items-center justify-center rounded border border-border text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Plus" size={10} />
                  </button>
                </div>
              </div>
            ) : (
              p.in_stock ? (
                <button onClick={onAddCart} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                  <Icon name="Plus" size={14} />
                  В корзину
                </button>
              ) : (
                <button onClick={onPreorder} className="flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors" style={{ cursor: "pointer" }}>
                  <Icon name="Clock" size={14} />
                  Под заказ
                </button>
              )
            )}
          </div>
        </div>
      </button>
    </div>
  )
}

function BuildTagChip({ tag }: { tag: BuildTag }) {
  const cls = getTagClass(tag.color)
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-sm ${cls}`}>
      {tag.name}
    </span>
  )
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
      {/* Фон */}
      {hasImage ? (
        <div className="absolute inset-0">
          {images.map((url, i) => (
            <img
              key={i}
              src={url} alt={b.name}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: "brightness(0.55)", opacity: i === imgIdx ? 1 : 0, transition: "opacity 0.6s ease" }}
            />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-muted/80 to-card" />
      )}
      {/* Градиент */}
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/50 via-black/15 to-transparent group-hover:h-full group-hover:from-black/95 group-hover:via-black/30 transition-all duration-300" />

      {/* Бейджи — сверху */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        {!!b.variantsCount && (
          <span className="flex items-center gap-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/80">
            <Icon name="Layers" size={10} />
            {b.variantsCount + 1} варианта
          </span>
        )}
        {/* Теги — 2 при наведении, скрыты иначе */}
        {previewTags.map(t => (
          <span
            key={t.id}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-sm transition-all duration-300 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"} ${getTagClass(t.color)}`}
          >
            {t.name}
          </span>
        ))}
      </div>

      {/* Бейджи — правый верхний угол */}
      <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
        {b.reserved ? (
          <div
            className="flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg cursor-help"
            title="Другой клиент оформляет покупку этого ПК. Напишите нашим менеджерам, если нужен именно он.">
            <Icon name="Clock" size={10} />
            В резерве
          </div>
        ) : b.in_stock && (
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

      {/* Стрелки карусели — справа сверху, только если >1 фото */}
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

      {/* Точки карусели — внизу по центру фото */}
      {images.length > 1 && (
        <div className="absolute bottom-[88px] left-1/2 z-20 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setImgIdx(i) }}
              className={`rounded-full transition-all duration-300 ${i === imgIdx ? "w-4 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/40"}`}
              style={{ cursor: "pointer" }}
            />
          ))}
        </div>
      )}

      {/* Hover-оверлей: CPU + GPU */}
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

      {/* Контент — внизу */}
      <div className="relative z-10 mt-auto p-5">
        <h3 className="mb-3 text-xl font-medium text-white leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-300">
          {b.name}
        </h3>
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xl font-bold text-white">{fmt(b.total_price)}</p>
          {b.reserved ? (
            <span
              className="shrink-0 rounded-xl bg-orange-500/20 border border-orange-400/40 px-4 py-2 text-xs font-semibold text-orange-300 cursor-help"
              title="Другой клиент оформляет покупку этого ПК. Напишите нашим менеджерам, если нужен именно он.">
              В резерве
            </span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onOrder() }}
              className="shrink-0 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              style={{ cursor: "pointer" }}
            >
              Заказать
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProductModal({ product: p, onClose, onAddCart, fmt }: { product: Product; onClose: () => void; onAddCart: () => void; fmt: (n: number) => string }) {
  const [imgIdx, setImgIdx] = useState(0)
  const images = p.image_urls?.length ? p.image_urls : p.image_url ? [p.image_url] : []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ cursor: "auto" }}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} style={{ cursor: "pointer" }} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-card overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="relative aspect-video bg-muted flex items-center justify-center">
          {images.length > 0 ? (
            <>
              <img src={images[imgIdx]} alt={p.name} className="h-full w-full object-cover" />
              {images.length > 1 && (
                <>
                  <button onClick={() => setImgIdx(i => (i - 1 + images.length) % images.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 border border-border/50 hover:border-primary transition-colors backdrop-blur"
                    style={{ cursor: "pointer" }}>
                    <Icon name="ChevronLeft" size={16} />
                  </button>
                  <button onClick={() => setImgIdx(i => (i + 1) % images.length)}
                    className="absolute right-12 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 border border-border/50 hover:border-primary transition-colors backdrop-blur"
                    style={{ cursor: "pointer" }}>
                    <Icon name="ChevronRight" size={16} />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {images.map((_, i) => (
                      <button key={i} onClick={() => setImgIdx(i)} className={`h-1.5 rounded-full transition-all ${i === imgIdx ? "w-6 bg-primary" : "w-1.5 bg-foreground/30"}`} style={{ cursor: "pointer" }} />
                    ))}
                  </div>
                </>
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
          {p.description && <div className="mb-4 text-sm text-foreground/70 leading-relaxed rich-content" dangerouslySetInnerHTML={{ __html: p.description }} />}
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
  const [slideIdx, setSlideIdx] = useState(0)
  const [animDir, setAnimDir] = useState<"left" | "right">("right")
  const [animating, setAnimating] = useState(false)
  const [userInteracted, setUserInteracted] = useState(false)
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Слайды: общее описание + по одному на каждый компонент
  const slides = [
    { type: "overview" as const },
    ...b.components.map((c, i) => ({ type: "component" as const, component: c, index: i })),
    { type: "summary" as const },
  ]
  const total = slides.length

  const goTo = (idx: number, dir: "left" | "right", manual = true) => {
    if (animating || idx === slideIdx) return
    if (manual) setUserInteracted(true)
    setAnimDir(dir)
    setAnimating(true)
    setTimeout(() => {
      setSlideIdx(idx)
      setAnimating(false)
    }, 320)
  }

  const prev = () => { if (slideIdx > 0) goTo(slideIdx - 1, "left") }
  const next = () => { if (slideIdx < total - 1) goTo(slideIdx + 1, "right") }

  // Автосмена слайдов компонентов каждые 5 сек (только если user не взаимодействовал)
  useEffect(() => {
    if (userInteracted) return
    const compSlides = slides
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.type === "component")
    if (compSlides.length < 2) return
    autoRef.current = setInterval(() => {
      setSlideIdx(cur => {
        const curPos = compSlides.findIndex(({ i }) => i === cur)
        if (curPos === -1) {
          // не на компоненте — перейти к первому
          setAnimDir("right")
          setAnimating(true)
          setTimeout(() => { setAnimating(false) }, 320)
          return compSlides[0].i
        }
        const next = compSlides[(curPos + 1) % compSlides.length]
        setAnimDir("right")
        setAnimating(true)
        setTimeout(() => { setAnimating(false) }, 320)
        return next.i
      })
    }, 5000)
    return () => { if (autoRef.current) clearInterval(autoRef.current) }
  }, [userInteracted, total])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next()
      else if (e.key === "ArrowLeft") prev()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [slideIdx, animating])

  const slide = slides[slideIdx]
  const images = b.image_urls || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ cursor: "auto" }}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} style={{ cursor: "pointer" }} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card overflow-hidden" style={{ maxHeight: "90vh" }}>

        {/* Слайд */}
        <div
          className="transition-all duration-300 ease-out"
          style={{
            opacity: animating ? 0 : 1,
            transform: animating
              ? `translateX(${animDir === "right" ? "32px" : "-32px"})`
              : "translateX(0)",
          }}
        >
          {slide.type === "overview" && (
            <div>
              <div className="relative aspect-video bg-gradient-to-br from-card to-muted flex items-center justify-center overflow-hidden">
                {images.length > 0 ? (
                  <img src={images[0]} alt={b.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Icon name="Cpu" size={56} className="text-primary/30" />
                    <span className="font-mono text-sm text-foreground/30">BeGraphics Build</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <p className="font-mono text-xs text-foreground/50 uppercase tracking-wider mb-1">Готовая сборка</p>
                  <h2 className="text-2xl font-medium text-white">{b.name}</h2>
                </div>
              </div>
              <div className="p-6">
                {b.description && <div className="text-sm text-foreground/70 leading-relaxed mb-4 rich-content" dangerouslySetInnerHTML={{ __html: b.description }} />}
                <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
                  <span className="text-sm text-foreground/60">{b.components.length} компонентов</span>
                  <span className="text-lg font-bold text-foreground">{fmt(b.total_price)}</span>
                </div>
                <p className="mt-3 text-center text-xs text-foreground/40">Листайте вправо, чтобы увидеть каждый компонент</p>
              </div>
            </div>
          )}

          {slide.type === "component" && (
            <div>
              <div className="relative aspect-video bg-gradient-to-br from-card to-muted flex items-center justify-center overflow-hidden">
                {images[slide.index + 1] ? (
                  <img
                    key={slide.index}
                    src={images[slide.index + 1]}
                    alt={slide.component.name}
                    className="h-full w-full object-cover"
                    style={{ animation: "fadeIn 0.6s ease" }}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Icon name={SLOT_ICONS[slide.component.slot] || "Cpu"} size={64} className="text-primary/25" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <p className="font-mono text-xs text-primary/80 uppercase tracking-wider mb-1">{SLOT_NAMES[slide.component.slot] || slide.component.slot}</p>
                  <h3 className="text-xl font-medium text-white leading-snug">{slide.component.name}</h3>
                </div>
              </div>
              <div className="p-6">
                {slide.component.description && (
                  <div className="text-sm text-foreground/70 leading-relaxed mb-4 rich-content" dangerouslySetInnerHTML={{ __html: slide.component.description }} />
                )}
                {!slide.component.description && (
                  <p className="text-sm text-foreground/40 italic mb-4">Комплектующее уровня {SLOT_NAMES[slide.component.slot] || slide.component.slot}</p>
                )}
                <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                  <span className="text-sm text-foreground/60">Стоимость</span>
                  <span className="text-xl font-bold text-primary">{fmt(slide.component.current_price ?? slide.component.price)}</span>
                </div>
              </div>
            </div>
          )}

          {slide.type === "summary" && (
            <div className="p-6 pt-8">
              <h3 className="mb-5 text-center text-lg font-medium text-foreground">Итоговая стоимость</h3>
              <div className="mb-4 space-y-2 rounded-xl border border-border p-4">
                {b.components.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-xs text-foreground/40 font-mono w-20">{SLOT_NAMES[c.slot] || c.slot}</span>
                      <span className="text-foreground/70 truncate">{c.name}</span>
                    </div>
                    <span className="ml-2 shrink-0 text-foreground/80">{fmt(c.current_price ?? c.price)}</span>
                  </div>
                ))}
              </div>
              {(() => {
                const calcParts = b.components.reduce((s, c) => s + (c.current_price ?? c.price ?? 0), 0)
                const calcFee = b.assembly_fee || 0
                return (
                  <div className="mb-6 rounded-xl border border-border/50 bg-muted/30 p-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground/60">Железо:</span>
                      <span className="text-foreground">{fmt(calcParts)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground/60">Сборка:</span>
                      <span className="text-foreground">{fmt(calcFee)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <span className="font-medium text-foreground">Итого:</span>
                      <span className="text-xl font-bold text-foreground">{fmt(calcParts + calcFee)}</span>
                    </div>
                  </div>
                )
              })()}
              <button onClick={onOrder} className="w-full rounded-xl bg-primary py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>Заказать эту сборку</button>
              <p className="mt-2 text-center text-xs text-foreground/40">После оформления менеджер свяжется для подтверждения</p>
            </div>
          )}
        </div>

        {/* Навигация */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            onClick={prev}
            disabled={slideIdx === 0}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground/60 hover:border-primary hover:text-foreground disabled:opacity-20 transition-all"
            style={{ cursor: slideIdx === 0 ? "default" : "pointer" }}
          >
            <Icon name="ChevronLeft" size={16} />
          </button>

          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i, i > slideIdx ? "right" : "left")}
                className={`rounded-full transition-all duration-300 ${i === slideIdx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/20 hover:bg-foreground/40"}`}
                style={{ cursor: "pointer" }}
              />
            ))}
          </div>

          <button
            onClick={slideIdx === total - 1 ? onClose : next}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground/60 hover:border-primary hover:text-foreground transition-all"
            style={{ cursor: "pointer" }}
          >
            <Icon name={slideIdx === total - 1 ? "X" : "ChevronRight"} size={16} />
          </button>
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