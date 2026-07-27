import { useEffect, useState, useMemo } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import OptimizedImage from "@/components/ui/optimized-image"
import CatalogTabs from "@/components/CatalogTabs"
import SiteHeader from "@/components/SiteHeader"
import Footer from "@/components/Footer"
import Seo from "@/components/Seo"
import { matchesSearch } from "@/lib/keyboardLayout"

interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  category: string
  categories?: string[]
  tags: string[]
  views: number
  comments_count?: number
  created_at: string
}

// Категории статьи (массив с фолбэком на старое одиночное поле)
const articleCats = (a: Article): string[] => (a.categories && a.categories.length ? a.categories : [a.category])

const CATEGORIES: { value: string; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "article", label: "Статья" },
  { value: "review", label: "Обзор" },
  { value: "test", label: "Тест / Бенчмарк" },
  { value: "guide", label: "Гайд" },
  { value: "repair", label: "Ремонты" },
  { value: "tier_detail", label: "Подробный тир-лист" },
]

const SORTS: { value: string; label: string; icon: string }[] = [
  { value: "date", label: "По дате", icon: "CalendarDays" },
  { value: "views", label: "По просмотрам", icon: "Eye" },
  { value: "comments", label: "По обсуждениям", icon: "MessageCircle" },
]

const fmt = (date: string | number) => {
  const d = typeof date === "number" ? new Date(date * 1000) : new Date(date)
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
}

export default function Articles() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)

  const category = searchParams.get("category") || "all"
  const sort = searchParams.get("sort") || "date"
  const query = searchParams.get("q") || ""

  const setParam = (key: string, val: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(key, val)
    setSearchParams(next)
  }

  useEffect(() => {
    setLoading(true)
    api.articles.getAll({ published: "true", limit: "200" })
      .then(d => setArticles(d.articles || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let list = [...articles]

    if (category !== "all") list = list.filter(a => articleCats(a).includes(category))

    if (query.trim()) {
      list = list.filter(a =>
        matchesSearch(a.title, query) || matchesSearch(a.excerpt || "", query)
      )
    }

    if (sort === "date") list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    else if (sort === "views") list.sort((a, b) => (b.views || 0) - (a.views || 0))
    else if (sort === "comments") list.sort((a, b) => (b.comments_count || 0) - (a.comments_count || 0))

    return list
  }, [articles, category, sort, query])

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title="Статьи и тесты — обзоры, гайды и бенчмарки железа"
        description="Обзоры комплектующих, тесты и бенчмарки, гайды по сборке и ремонту ПК от BeGraphics."
        path="/articles"
      />
      {/* Базовая шапка сайта */}
      <SiteHeader back />

      <CatalogTabs />

      <div className="mx-auto max-w-7xl px-4 py-3 md:px-8 md:py-10">
        {/* Заголовок */}
        <div className="mb-4 md:mb-8">
          <h1 className="hidden font-sans text-4xl font-light tracking-tight text-foreground md:block md:text-5xl">
            Статьи и тесты
          </h1>
          <p className="text-sm text-foreground/40 md:mt-2">{articles.length} материалов</p>
        </div>

        {/* Поиск */}
        <div className="relative mb-4 w-full sm:max-w-xs">
          <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30 pointer-events-none" />
          <input
            value={query}
            onChange={e => setParam("q", e.target.value)}
            placeholder="Поиск по статьям..."
            className="w-full rounded-lg border border-border bg-card py-2 pl-8 pr-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none transition-colors"
          />
          {query && (
            <button onClick={() => setParam("q", "")} className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground" style={{ cursor: "pointer" }}>
              <Icon name="X" size={13} />
            </button>
          )}
        </div>

        {/* Группировка (категории) — компактный ряд */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setParam("category", c.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${category === c.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/60 hover:border-primary/50 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Сортировка — выпадающий список под группировкой */}
        <div className="mb-8 flex items-center gap-2">
          <span className="text-xs text-foreground/40">Сортировка:</span>
          <div className="relative">
            <Icon name="ArrowDownUp" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40" />
            <select
              value={sort}
              onChange={e => setParam("sort", e.target.value)}
              className="appearance-none rounded-lg border border-border bg-card py-1.5 pl-8 pr-8 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
              style={{ cursor: "pointer" }}
            >
              {SORTS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <Icon name="ChevronDown" size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground/40" />
          </div>
        </div>

        {/* Контент */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-foreground/30">
            <Icon name="BookOpen" size={40} />
            <p className="text-sm">Ничего не найдено</p>
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map(a => (
              <button
                key={a.id}
                onClick={() => navigate(`/articles/${a.id}`)}
                className="group text-left"
                style={{ cursor: "pointer" }}
              >
                {/* Картинка */}
                <div className="relative mb-4 aspect-[4/3] overflow-hidden rounded-xl bg-foreground/5">
                  {a.image_url ? (
                    <OptimizedImage src={a.image_url} alt={a.title} sizes="(max-width: 640px) 100vw, 33vw" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Icon name="FileText" size={36} className="text-foreground/15" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="absolute top-3 left-3 flex flex-wrap gap-1">
                    {articleCats(a).map(cat => (
                      <span key={cat} className="rounded-full bg-foreground/80 px-2 py-0.5 text-xs text-background backdrop-blur-sm">
                        {CATEGORIES.find(c => c.value === cat)?.label ?? cat}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Мета */}
                <p className="mb-1 font-mono text-xs text-foreground/40">{fmt(a.created_at)}</p>
                <h3 className="mb-2 font-sans text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
                  {a.title}
                </h3>
                {a.excerpt && (
                  <p className="mb-3 text-xs leading-relaxed text-foreground/50 line-clamp-2"
                    dangerouslySetInnerHTML={{ __html: a.excerpt.replace(/<[^>]+>/g, "") }} />
                )}

                {/* Статистика */}
                <div className="flex items-center gap-3 text-xs text-foreground/30">
                  <span className="flex items-center gap-1">
                    <Icon name="Eye" size={11} />
                    {a.views || 0}
                  </span>
                  {(a.comments_count ?? 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <Icon name="MessageCircle" size={11} />
                      {a.comments_count}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}