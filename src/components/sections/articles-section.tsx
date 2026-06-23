import { useReveal } from "@/hooks/use-reveal"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"

interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  category: string
  tags: string[]
  views: number
  created_at: string
}

export function ArticlesSection() {
  const { ref, isVisible } = useReveal(0.2)
  const [articles, setArticles] = useState<Article[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    api.articles.getAll({ published: "true", limit: "4" })
      .then(d => setArticles(d.articles || []))
      .catch(() => {})
  }, [])

  const fmt = (date: string | number) => {
    const d = typeof date === "number" ? new Date(date * 1000) : new Date(date)
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
  }

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="flex h-screen w-full items-center px-4 pt-20 md:px-12 md:pt-0 lg:px-16"
    >
      <div className="mx-auto w-full max-w-7xl">
        {/* Заголовок */}
        <div
          className={`mb-10 transition-all duration-700 ${
            isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
          }`}
        >
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-foreground/40">
            Знания
          </p>
          <h2 className="font-sans text-4xl font-light tracking-tight text-foreground md:text-5xl">
            Статьи и тесты
          </h2>
        </div>

        {articles.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center gap-4 py-16 transition-all duration-700 delay-100 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <Icon name="BookOpen" size={48} className="text-foreground/15" />
            <p className="text-sm text-foreground/40">Статьи скоро появятся</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {articles.map((a, i) => (
              <button
                key={a.id}
                onClick={() => navigate(`/articles/${a.id}`)}
                className={`group text-left transition-all duration-700 ${
                  isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
                }`}
                style={{ transitionDelay: `${100 + i * 80}ms`, cursor: "pointer" }}
              >
                {/* Картинка */}
                <div className="relative mb-4 aspect-[4/3] overflow-hidden rounded-xl bg-foreground/5">
                  {a.image_url ? (
                    <img
                      src={a.image_url}
                      alt={a.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Icon name="FileText" size={40} className="text-foreground/15" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <span className="absolute top-3 left-3 rounded-full bg-foreground/80 px-2 py-0.5 text-xs text-background backdrop-blur-sm">
                    {{ review: "Обзор", test: "Тест", guide: "Гайд", repair: "Ремонты", article: "Статья" }[a.category] || "Статья"}
                  </span>
                </div>

                {/* Контент */}
                <p className="mb-1 font-mono text-xs text-foreground/40">{fmt(a.created_at)}</p>
                <h3 className="mb-2 font-sans text-base font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
                  {a.title}
                </h3>
                {a.excerpt && (
                  <p className="text-sm leading-relaxed text-foreground/60"
                    dangerouslySetInnerHTML={{ __html: a.excerpt.replace(/<[^>]+>/g, "") }} />
                )}
                <div className="mt-3 flex items-center gap-1 text-xs text-foreground/40">
                  <Icon name="Eye" size={12} />
                  <span>{a.views}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Кнопка "все статьи" */}
        <div
          className={`mt-8 transition-all duration-700 delay-500 ${
            isVisible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
        >
          <button
            onClick={() => navigate("/articles")}
            className="flex items-center gap-2 text-sm text-foreground/50 transition-colors hover:text-foreground"
            style={{ cursor: "pointer" }}
          >
            <span>Все публикации</span>
            <Icon name="ArrowRight" size={14} />
          </button>
        </div>
      </div>
    </section>
  )
}