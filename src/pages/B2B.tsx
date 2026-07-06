import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"

const B2B_URL = "https://functions.poehali.dev/f9a06f74-cd3c-4433-ae1b-52c4f76d1dec"
const PWD_KEY = "b2b_password"

interface Item {
  id: number
  name: string
  sku: string
  part_number: string
  category: string
  price_retail?: number
  price_opt1?: number
  price_opt2?: number
  warranty_months: number
  qty_available: number
}

const fmt = (n?: number) =>
  n && n > 0 ? n.toLocaleString("ru-RU") + " ₽" : "—"

export default function B2B() {
  const navigate = useNavigate()

  const [password, setPassword] = useState<string>(() => localStorage.getItem(PWD_KEY) || "")
  const [hasPrices, setHasPrices] = useState(false)
  const [pwdInput, setPwdInput] = useState("")
  const [pwdError, setPwdError] = useState("")
  const [checking, setChecking] = useState(false)

  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("")
  const [sortField, setSortField] = useState<"name" | "price_retail" | "qty_available">("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [showOutOfStock, setShowOutOfStock] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (activeCategory) qs.set("category", activeCategory)
    if (search) qs.set("search", search)
    const url = `${B2B_URL}${qs.toString() ? "?" + qs.toString() : ""}`
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (password) headers["X-B2B-Password"] = password
    const res = await fetch(url, { headers }).then(r => r.json())
    setItems(res.items || [])
    setCategories(res.categories || [])
    setHasPrices(!!res.has_prices)
    setLoading(false)
  }, [activeCategory, search, password])

  useEffect(() => {
    const t = setTimeout(load, search ? 400 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  const submitPassword = async () => {
    if (!pwdInput.trim()) return
    setChecking(true)
    setPwdError("")
    const res = await fetch(`${B2B_URL}?action=check_password`, {
      headers: { "Content-Type": "application/json", "X-B2B-Password": pwdInput.trim() },
    }).then(r => r.json()).catch(() => ({ ok: false }))
    setChecking(false)
    if (res.ok) {
      localStorage.setItem(PWD_KEY, pwdInput.trim())
      setPassword(pwdInput.trim())
      setPwdInput("")
    } else {
      setPwdError("Неверный пароль")
    }
  }

  const logoutPrices = () => {
    localStorage.removeItem(PWD_KEY)
    setPassword("")
    setHasPrices(false)
  }

  const filtered = showOutOfStock ? items : items.filter(i => i.qty_available > 0)
  const sorted = [...filtered].sort((a, b) => {
    let va: string | number = a[sortField] ?? 0
    let vb: string | number = b[sortField] ?? 0
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
    const header = ["SKU", "Партномер", "Название", "Категория", ...(hasPrices ? ["Розница", "Опт 1", "Опт 2"] : []), "Гарантия (мес)", "В наличии"]
    const rows = sorted.map(i => [
      i.sku, i.part_number, `"${i.name}"`, i.category,
      ...(hasPrices ? [i.price_retail || 0, i.price_opt1 || 0, i.price_opt2 || 0] : []),
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

  // Сетка колонок зависит от того, видны ли цены
  const gridCols = hasPrices
    ? "lg:grid-cols-[2fr_140px_1fr_120px_120px_120px_80px_80px]"
    : "lg:grid-cols-[2fr_140px_1fr_80px_80px]"

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
            {hasPrices && (
              <button onClick={logoutPrices} className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="LogOut" size={14} />
                <span className="hidden sm:inline">Скрыть цены</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Шапка */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-0.5 text-xs font-semibold text-primary">B2B</span>
              <span className="text-xs text-foreground/40">Прайс-лист для партнёров</span>
            </div>
            <h1 className="text-2xl font-light text-foreground">Прайс-лист</h1>
            {!loading && (
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

        {/* Парольный баннер для показа цен */}
        {!hasPrices && (
          <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="Lock" size={16} className="text-primary" />
              <p className="text-sm font-medium text-foreground">Введите пароль, чтобы видеть оптовые цены</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="password"
                value={pwdInput}
                onChange={e => { setPwdInput(e.target.value); setPwdError("") }}
                onKeyDown={e => { if (e.key === "Enter") submitPassword() }}
                placeholder="Пароль партнёра"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                style={{ cursor: "text" }}
              />
              <button
                onClick={submitPassword}
                disabled={checking || !pwdInput.trim()}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                style={{ cursor: "pointer" }}
              >
                {checking ? "Проверка..." : "Показать цены"}
              </button>
            </div>
            {pwdError && <p className="mt-2 text-xs text-red-400">{pwdError}</p>}
            <p className="mt-2 text-xs text-foreground/40">Пароль запомнится в этом браузере. Получить пароль — у вашего менеджера.</p>
          </div>
        )}

        {/* Фильтры */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row">
          {/* Поиск */}
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 focus-within:border-primary transition-colors">
            <Icon name="Search" size={15} className="text-foreground/40 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию или партномеру..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/30 focus:outline-none"
              style={{ cursor: "text" }}
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-foreground/30 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="X" size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Категории — выпадающий список */}
        <div className="mb-5">
          <div className="relative inline-flex w-full items-center sm:w-72">
            <Icon name="Tag" size={15} className="pointer-events-none absolute left-3 text-foreground/40" />
            <select
              value={activeCategory}
              onChange={e => setActiveCategory(e.target.value)}
              className="w-full appearance-none rounded-xl border border-border bg-card py-2.5 pl-9 pr-9 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
              style={{ cursor: "pointer" }}
            >
              <option value="">Все категории</option>
              {categories.filter(cat => cat && cat.trim()).map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <Icon name="ChevronDown" size={16} className="pointer-events-none absolute right-3 text-foreground/40" />
          </div>
        </div>

        {/* Таблица */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Шапка таблицы */}
          <div className={`grid gap-0 border-b border-border bg-muted/30 px-4 py-3 text-xs font-semibold text-foreground/50 uppercase tracking-wide hidden lg:grid ${gridCols}`}>
            <button onClick={() => toggleSort("name")} className="flex items-center gap-1 text-left hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              Название <SortIcon field="name" />
            </button>
            <div>Партномер</div>
            <div>Категория</div>
            {hasPrices && (
              <>
                <button onClick={() => toggleSort("price_retail")} className="flex items-center gap-1 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  Розница <SortIcon field="price_retail" />
                </button>
                <div>Опт 1</div>
                <div>Опт 2</div>
              </>
            )}
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
                <div key={item.id} className={`grid grid-cols-1 gap-2 px-4 py-3 hover:bg-muted/20 transition-colors lg:gap-0 lg:items-center ${gridCols}`}>
                  {/* Название */}
                  <div>
                    <p className="text-sm font-medium text-foreground leading-snug">{item.name}</p>
                    <p className="text-xs text-foreground/40 font-mono">{item.sku}</p>
                  </div>

                  {/* Партномер */}
                  <div className="flex items-center justify-between lg:block">
                    <span className="text-xs text-foreground/40 lg:hidden">Партномер</span>
                    <span className="text-xs font-mono text-foreground/60">{item.part_number || "—"}</span>
                  </div>

                  {/* Категория */}
                  <div className="hidden lg:block">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">{item.category}</span>
                  </div>

                  {/* Цены — только при доступе */}
                  {hasPrices && (
                    <>
                      <div className="flex items-center justify-between lg:block">
                        <span className="text-xs text-foreground/40 lg:hidden">Розница</span>
                        <span className={`text-sm font-semibold ${(item.price_retail || 0) > 0 ? "text-foreground" : "text-foreground/25"}`}>
                          {fmt(item.price_retail)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between lg:block">
                        <span className="text-xs text-foreground/40 lg:hidden">Опт 1</span>
                        <span className={`text-sm ${(item.price_opt1 || 0) > 0 ? "text-primary font-medium" : "text-foreground/25"}`}>
                          {fmt(item.price_opt1)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between lg:block">
                        <span className="text-xs text-foreground/40 lg:hidden">Опт 2</span>
                        <span className={`text-sm ${(item.price_opt2 || 0) > 0 ? "text-blue-400 font-medium" : "text-foreground/25"}`}>
                          {fmt(item.price_opt2)}
                        </span>
                      </div>
                    </>
                  )}

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

        {/* Подвал */}
        {!loading && sorted.length > 0 && (
          <p className="mt-4 text-center text-xs text-foreground/30">
            Актуально на сегодня · {new Date().toLocaleDateString("ru-RU")} · Наличие без учёта резервов
          </p>
        )}
      </div>
    </div>
  )
}