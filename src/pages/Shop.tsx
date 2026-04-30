import { useState, useEffect } from "react"
import { useCart } from "@/store/cart"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { useNavigate } from "react-router-dom"

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

export default function Shop() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const { addItem, count } = useCart()
  const navigate = useNavigate()

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

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">P</div>
            <span className="font-semibold text-lg text-foreground">PCPRO</span>
          </button>
          <nav className="hidden items-center gap-6 md:flex">
            <button onClick={() => navigate("/shop")} className="text-sm font-medium text-primary" style={{ cursor: "pointer" }}>Каталог</button>
            <button onClick={() => navigate("/configurator")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Конфигуратор</button>
          </nav>
          <button
            onClick={() => navigate("/cart")}
            className="relative flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:border-primary transition-colors"
            style={{ cursor: "pointer" }}
          >
            <Icon name="ShoppingCart" size={16} />
            <span>Корзина</span>
            {count() > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">
                {count()}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Search */}
        <div className="mb-6 flex gap-4">
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
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            style={{ cursor: "pointer" }}
          >
            <Icon name="Cpu" size={16} />
            Конфигуратор
          </button>
        </div>

        {/* Categories */}
        <div className="mb-8 flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setActiveCategory("all")}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${activeCategory === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground/70 hover:border-primary hover:text-foreground"}`}
            style={{ cursor: "pointer" }}
          >
            Все
          </button>
          {categories.map(cat => (
            <button
              key={cat.slug}
              onClick={() => setActiveCategory(cat.slug)}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${activeCategory === cat.slug ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground/70 hover:border-primary hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        {loading ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-72 rounded-xl bg-card animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="py-24 text-center text-foreground/50">
            <Icon name="PackageSearch" size={48} className="mx-auto mb-4 opacity-30" />
            <p>Товары не найдены</p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map(p => (
              <div key={p.id} className="group flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-all duration-300">
                <div className="relative aspect-video bg-muted flex items-center justify-center overflow-hidden">
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
                </div>
                <div className="flex flex-col flex-1 p-4">
                  {p.category && (
                    <span className="mb-1 text-xs text-foreground/40 font-mono">{p.category.name}</span>
                  )}
                  <h3 className="mb-2 font-medium text-foreground leading-tight">{p.name}</h3>
                  <p className="mb-3 text-xs text-foreground/60 leading-relaxed line-clamp-2">{p.description}</p>
                  {Object.keys(p.specs).length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1">
                      {Object.entries(p.specs).slice(0, 3).map(([k, v]) => (
                        <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground/60">{v}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-auto flex items-end justify-between">
                    <div>
                      <div className="text-lg font-bold text-foreground">{fmt(p.price)}</div>
                      {p.old_price && <div className="text-xs text-foreground/40 line-through">{fmt(p.old_price)}</div>}
                    </div>
                    <button
                      onClick={() => addItem({ id: p.id, name: p.name, price: p.price, image_url: p.image_url, type: "product" })}
                      disabled={!p.in_stock}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                      style={{ cursor: p.in_stock ? "pointer" : "not-allowed" }}
                    >
                      <Icon name="Plus" size={14} />
                      В корзину
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
