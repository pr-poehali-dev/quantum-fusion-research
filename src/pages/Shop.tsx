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
import Seo from "@/components/Seo"
import { useNavigate, useSearchParams } from "react-router-dom"
import ShopFilters, { ShopAttr, ShopSpecProduct, ShopFilterState, ShopSortKey, emptyFilterState, applyShopFilters, sortShopProducts, ShopSortControl } from "@/components/shop/ShopFilters"
import {
  Product, Category, BuildTag, Build, CommunityBuild,
  matchCategory, getTagClass,
} from "@/components/shop/shared"
import {
  ProductCard, BuildCard, ProductModal, BuildModal, CommunityBuildCard,
} from "@/components/shop/cards"

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
  // Товары и сборки под публичными акциями (id → инфо об акции) — для бейджа
  type PromoInfo = { code: string; title: string | null; discount_type: string; discount_value: number }
  const [promoMap, setPromoMap] = useState<Record<number, PromoInfo>>({})
  const [buildPromoMap, setBuildPromoMap] = useState<Record<number, PromoInfo>>({})
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

  // Товары и сборки под публичными акциями — для бейджа «Акция» на карточках
  useEffect(() => {
    api.promos.promoProducts().then(d => {
      setPromoMap(d.products || {})
      setBuildPromoMap(d.builds || {})
    }).catch(() => {})
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
      <Seo
        title="Магазин комплектующих для ПК"
        description="Видеокарты, процессоры, материнские платы, память и другие комплектующие для ПК с доставкой. Новые и б/у — BeGraphics."
        path="/shop"
      />
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
                {(activeCategory !== "all" || usedOnly) && <span className="h-2 w-2 rounded-full bg-primary" />}
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
                      onClick={() => { setUsedOnly(false); setActiveCategory("all"); setSearch(""); setSearchInput(""); setCatOpen(false) }}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors text-left ${!usedOnly && activeCategory === "all" ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-muted hover:text-foreground"}`}
                      style={{ cursor: "pointer" }}
                    >
                      <Icon name="LayoutGrid" size={15} />
                      Все товары
                      {!usedOnly && activeCategory === "all" && <Icon name="Check" size={13} className="ml-auto" />}
                    </button>
                    {categories.map(cat => (
                      <button
                        key={cat.slug}
                        onClick={() => { setUsedOnly(false); setActiveCategory(cat.slug); setSearch(""); setSearchInput(""); setCatOpen(false) }}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors text-left ${!usedOnly && activeCategory === cat.slug ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-muted hover:text-foreground"}`}
                        style={{ cursor: "pointer" }}
                      >
                        {cat.name}
                        {!usedOnly && activeCategory === cat.slug && <Icon name="Check" size={13} className="ml-auto" />}
                      </button>
                    ))}
                    {/* Б/У как отдельная категория */}
                    <div className="my-1 border-t border-border/60" />
                    <button
                      onClick={() => { setUsedOnly(true); setActiveCategory("all"); setSearch(""); setSearchInput(""); setCatOpen(false) }}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors text-left ${usedOnly ? "bg-amber-500 text-white" : "text-amber-600 dark:text-amber-500 hover:bg-amber-500/10"}`}
                      style={{ cursor: "pointer" }}
                    >
                      <Icon name="RotateCcw" size={15} />
                      Б/У · бывшие в употреблении
                      {usedOnly && <Icon name="Check" size={13} className="ml-auto" />}
                    </button>
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
                                  promo={promoMap[p.id]}
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
                  promo={promoMap[p.id]}
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
                      {rest.length > 0 && <p className="mb-3 text-base font-mono uppercase tracking-widest text-primary">Рекомендуем</p>}
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
                        <p className="text-base font-mono uppercase tracking-widest text-primary">Комплектующие бывшие в употреблении с гарантией</p>
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
                          <p className="mb-4 text-base font-mono uppercase tracking-widest text-primary">{cat.name}</p>
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
                    <BuildCard key={b.id} build={b} promo={buildPromoMap[b.id]} onOpen={() => navigate(`/build-preview/${b.id}`)} onOrder={() => {
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
                  <CommunityBuildCard key={b.id} build={b} fmt={fmt} onLoad={() => navigate(b.short_code ? `/s/${b.short_code}` : `/configurator?build=${b.share_token}`)} />
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