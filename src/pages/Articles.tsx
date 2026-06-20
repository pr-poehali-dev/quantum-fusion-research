import { useEffect, useState, useMemo } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import Footer from "@/components/Footer"

interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  category: string
  tags: string[]
  views: number
  comments_count?: number
  created_at: string
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "article", label: "Статья" },
  { value: "review", label: "Обзор" },
  { value: "test", label: "Тест / Бенчмарк" },
  { value: "guide", label: "Гайд" },
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

    if (category !== "all") list = list.filter(a => a.category === category)

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(a =>
        a.title.toLowerCase().includes(q) ||
        (a.excerpt || "").toLowerCase().includes(q)
      )
    }

    if (sort === "date") list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    else if (sort === "views") list.sort((a, b) => (b.views || 0) - (a.views || 0))
    else if (sort === "comments") list.sort((a, b) => (b.comments_count || 0) - (a.comments_count || 0))

    return list
  }, [articles, category, sort, query])

  return (
    <div className="min-h-screen bg-background">
      {/* Шапка */}
      <div className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="flex h-14 items-center gap-3">
            <button onClick={() => navigate("/")} className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/40 hover:text-foreground hover:bg-muted transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="ArrowLeft" size={16} />
            </button>
            <span className="font-mono text-xs uppercase tracking-widest text-foreground/40">Знания</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
        {/* Заголовок */}
        <div className="mb-8">
          <h1 className="font-sans text-4xl font-light tracking-tight text-foreground md:text-5xl">
            Статьи и тесты
          </h1>
          <p className="mt-2 text-sm text-foreground/40">{articles.length} материалов</p>
        </div>

        {/* Фильтры */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Поиск */}
          <div className="relative w-full sm:max-w-xs">
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

          {/* Сортировка */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            {SORTS.map(s => (
              <button
                key={s.value}
                onClick={() => setParam("sort", s.value)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${sort === s.value ? "bg-primary text-primary-foreground" : "text-foreground/50 hover:text-foreground"}`}
                style={{ cursor: "pointer" }}
              >
                <Icon name={s.icon as "Eye"} size={12} />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Категории */}
        <div className="mb-8 flex flex-wrap gap-2">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setParam("category", c.value)}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${category === c.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/60 hover:border-primary/50 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              {c.label}
            </button>
          ))}
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
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                    <img src={a.image_url} alt={a.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Icon name="FileText" size={36} className="text-foreground/15" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <span className="absolute top-3 left-3 rounded-full bg-foreground/80 px-2 py-0.5 text-xs text-background backdrop-blur-sm">
                    {CATEGORIES.find(c => c.value === a.category)?.label ?? a.category}
                  </span>
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