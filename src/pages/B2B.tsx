import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import NotificationBell from "@/components/NotificationBell"

const B2B_URL = "https://functions.poehali.dev/f9a06f74-cd3c-4433-ae1b-52c4f76d1dec"

interface Item {
  id: number
  name: string
  sku: string
  category: string
  price_retail: number
  price_opt1: number
  price_opt2: number
  warranty_months: number
  qty_available: number
}

const fmt = (n: number) =>
  n > 0 ? n.toLocaleString("ru-RU") + " ₽" : "—"

function authHeaders(session: string) {
  return { "Content-Type": "application/json", "X-Session-Id": session }
}

export default function B2B() {
  const navigate = useNavigate()
  const { isAuthed, sessionId, user } = useAuth()

  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("")
  const [sortField, setSortField] = useState<"name" | "price_retail" | "qty_available">("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [showOutOfStock, setShowOutOfStock] = useState(false)

  const load = useCallback(async () => {
    if (!isAuthed() || !sessionId) return
    setLoading(true)
    setError("")
    const qs = new URLSearchParams()
    if (activeCategory) qs.set("category", activeCategory)
    if (search) qs.set("search", search)
    const url = `${B2B_URL}${qs.toString() ? "?" + qs.toString() : ""}`
    const res = await fetch(url, { headers: authHeaders(sessionId) }).then(r => r.json())
    if (res.error) {
      setError(res.error)
    } else {
      setItems(res.items || [])
      setCategories(res.categories || [])
    }
    setLoading(false)
  }, [isAuthed, sessionId, activeCategory, search])

  useEffect(() => {
    if (!isAuthed()) { navigate("/auth"); return }
    const t = setTimeout(load, search ? 400 : 0)
    return () => clearTimeout(t)
  }, [load, isAuthed, search])

  const filtered = showOutOfStock ? items : items.filter(i => i.qty_available > 0)
  const sorted = [...filtered].sort((a, b) => {
    let va: string | number = a[sortField]
    let vb: string | number = b[sortField]
    if (typeof va === "string") va = va.toLowerCase()
    if (typeof vb === "string") vb = vb.toLowerCase()
    return sortDir === "asc" ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
  })
  const hiddenCount = items.length - items.filter(i => i.qty_available > 0).length

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir("asc") }
  }

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return <Icon name="ChevronsUpDown" size={13} className="text-foreground/30" />
    return <Icon name={sortDir === "asc" ? "ChevronUp" : "ChevronDown"} size={13} className="text-primary" />
  }

  const exportCSV = () => {
    const header = ["SKU", "Название", "Категория", "Розница", "Опт 1", "Опт 2", "Гарантия (мес)", "В наличии"]
    const rows = sorted.map(i => [
      i.sku, `"${i.name}"`, i.category,
      i.price_retail, i.price_opt1, i.price_opt2,
      i.warranty_months, i.qty_available
    ])
    const csv = [header, ...rows].map(r => r.join(";")).join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url
    a.download = `pricelist_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const inStock = items.filter(i => i.qty_available > 0).length

  if (!isAuthed()) return null

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <NotificationBell />
            <button onClick={() => navigate("/profile")} className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="User" size={15} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Шапка */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-semibold text-primary">B2B</span>
              <span className="text-xs text-foreground/40">Только для партнёров</span>
            </div>
            <h1 className="text-2xl font-light text-foreground">Прайс-лист</h1>
            {!loading && !error && (
              <p className="mt-1 text-sm text-foreground/50">
                {items.length} позиций · <span className="text-green-400">{inStock} в наличии</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowOutOfStock(v => !v)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${showOutOfStock ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              <Icon name={showOutOfStock ? "EyeOff" : "Eye"} size={15} />
              <span className="hidden sm:inline">{showOutOfStock ? "Скрыть отсутствующие" : "Показать не в наличии"}</span>
              {!showOutOfStock && hiddenCount > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-foreground/40">{hiddenCount}</span>
              )}
            </button>
            <button
              onClick={exportCSV}
              disabled={!items.length}
              className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-foreground/60 hover:border-primary hover:text-foreground transition-colors disabled:opacity-40"
              style={{ cursor: items.length ? "pointer" : "not-allowed" }}
            >
              <Icon name="Download" size={15} />
              <span className="hidden sm:inline">Скачать CSV</span>
            </button>
          </div>
        </div>

        {/* Фильтры */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row">
          {/* Поиск */}
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 focus-within:border-primary transition-colors">
            <Icon name="Search" size={15} className="text-foreground/40 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию или SKU..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/30 focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-foreground/30 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="X" size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Категории */}
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCategory("")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${activeCategory === "" ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
            style={{ cursor: "pointer" }}
          >
            Все
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? "" : cat)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${activeCategory === cat ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Ошибка доступа */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-400/30 bg-red-400/10 px-5 py-4">
            <Icon name="Lock" size={18} className="text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-400">{error}</p>
              <p className="text-xs text-foreground/50 mt-0.5">Доступ к B2B прайс-листу открывается после подключения партнёрского аккаунта</p>
            </div>
          </div>
        )}

        {/* Таблица */}
        {!error && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {/* Шапка таблицы */}
            <div className="grid grid-cols-[2fr_1fr_120px_120px_120px_80px_80px] gap-0 border-b border-border bg-muted/30 px-4 py-3 text-xs font-semibold text-foreground/50 uppercase tracking-wide hidden lg:grid">
              <button onClick={() => toggleSort("name")} className="flex items-center gap-1 text-left hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                Название <SortIcon field="name" />
              </button>
              <div>Категория</div>
              <button onClick={() => toggleSort("price_retail")} className="flex items-center gap-1 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                Розница <SortIcon field="price_retail" />
              </button>
              <div>Опт 1</div>
              <div>Опт 2</div>
              <div>Гарантия</div>
              <button onClick={() => toggleSort("qty_available")} className="flex items-center gap-1 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                Наличие <SortIcon field="qty_available" />
              </button>
            </div>

            {/* Строки */}
            {loading ? (
              <div className="divide-y divide-border/50">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="h-14 animate-pulse bg-muted/20 mx-4 my-2 rounded-lg" />
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <div className="py-16 text-center">
                <Icon name="PackageSearch" size={40} className="mx-auto mb-3 text-foreground/20" />
                <p className="text-foreground/40">Ничего не найдено</p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {sorted.map(item => (
                  <div key={item.id} className="grid grid-cols-1 gap-2 px-4 py-3 hover:bg-muted/20 transition-colors lg:grid-cols-[2fr_1fr_120px_120px_120px_80px_80px] lg:gap-0 lg:items-center">
                    {/* Название */}
                    <div>
                      <p className="text-sm font-medium text-foreground leading-snug">{item.name}</p>
                      <p className="text-xs text-foreground/40 font-mono">{item.sku}</p>
                    </div>

                    {/* Категория */}
                    <div className="hidden lg:block">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">{item.category}</span>
                    </div>

                    {/* Цены — мобайл лейбл */}
                    <div className="flex items-center justify-between lg:block">
                      <span className="text-xs text-foreground/40 lg:hidden">Розница</span>
                      <span className={`text-sm font-semibold ${item.price_retail > 0 ? "text-foreground" : "text-foreground/25"}`}>
                        {fmt(item.price_retail)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between lg:block">
                      <span className="text-xs text-foreground/40 lg:hidden">Опт 1</span>
                      <span className={`text-sm ${item.price_opt1 > 0 ? "text-primary font-medium" : "text-foreground/25"}`}>
                        {fmt(item.price_opt1)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between lg:block">
                      <span className="text-xs text-foreground/40 lg:hidden">Опт 2</span>
                      <span className={`text-sm ${item.price_opt2 > 0 ? "text-blue-400 font-medium" : "text-foreground/25"}`}>
                        {fmt(item.price_opt2)}
                      </span>
                    </div>

                    {/* Гарантия */}
                    <div className="flex items-center justify-between lg:block">
                      <span className="text-xs text-foreground/40 lg:hidden">Гарантия</span>
                      <span className="text-xs text-foreground/50">{item.warranty_months} мес.</span>
                    </div>

                    {/* Наличие */}
                    <div className="flex items-center justify-between lg:block">
                      <span className="text-xs text-foreground/40 lg:hidden">В наличии</span>
                      <span className={`text-sm font-bold tabular-nums ${item.qty_available > 0 ? "text-green-400" : "text-foreground/25"}`}>
                        {item.qty_available > 0 ? item.qty_available : "0"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Подвал */}
        {!error && !loading && sorted.length > 0 && (
          <p className="mt-4 text-center text-xs text-foreground/30">
            Цены актуальны на сегодня · {new Date().toLocaleDateString("ru-RU")} · Наличие без учёта резервов
          </p>
        )}
      </div>
    </div>
  )
}