import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"
import { useCart } from "@/store/cart"
import { useAuth } from "@/store/auth"
import { ThemeSwitcher } from "@/components/theme-switcher"
import NotificationBell from "@/components/NotificationBell"

interface CommunityBuild {
  id: number
  name: string
  username?: string
  total_price?: number
  share_token?: string
  created_at: string
}
interface Article {
  id: number
  title: string
  created_at: string
  category?: string
  slug?: string
  image_url?: string | null
}

const BANNER_PODBOR = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/36698bd0-b01d-4377-b795-267d9ac8c779.jpg"
const BANNER_SBORKA = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/369e76c4-c4a6-46da-ab1d-843219204c9a.jpg"
const BANNER_RAZGON = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/1acd0059-3641-4d44-88b4-82eb45a824cc.png"

const fmtPrice = (n?: number) => (n ? Math.round(n).toLocaleString("ru-RU") + " ₽" : "—")
const fmtDate = (s: string) => {
  if (!s) return ""
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z")
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}


export default function HomeStonks() {
  const navigate = useNavigate()
  const { isAuthed } = useAuth()
  const { count } = useCart()
  const [builds, setBuilds] = useState<CommunityBuild[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [artIdx, setArtIdx] = useState(0)
  const artPaused = useRef(false)

  const goArticle = (dir: 1 | -1) => {
    setArtIdx(i => (i + dir + articles.length) % articles.length)
  }

  useEffect(() => { setArtIdx(0) }, [articles.length])

  useEffect(() => {
    if (articles.length < 2) return
    const id = setInterval(() => {
      if (!artPaused.current) setArtIdx(i => (i + 1) % articles.length)
    }, 4000)
    return () => clearInterval(id)
  }, [articles.length])

  useEffect(() => {
    api.auth.getCommunityBuilds()
      .then(d => {
        const list: CommunityBuild[] = d.builds || []
        list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        setBuilds(list.slice(0, 4))
      }).catch(() => {})
    api.articles.getAll({ published: "true", limit: "10" })
      .then(d => {
        const list: Article[] = d.articles || []
        list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        setArticles(list.slice(0, 5))
      }).catch(() => {})
  }, [])

  const Banner = ({ img, title, to }: { img: string; title: string; to: string }) => (
    <button onClick={() => navigate(to)} style={{ cursor: "pointer" }}
      className="group relative h-40 overflow-hidden rounded-2xl border border-border sm:h-48">
      <img src={img} alt={title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-center px-4 py-3 text-center text-2xl font-extrabold leading-tight text-white [text-shadow:_0_2px_8px_rgb(0_0_0_/_90%)] sm:text-3xl">
        {title}
      </span>
    </button>
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Шапка (как в Shop) */}
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

      {/* Навигационные табы (как в Shop) */}
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-7xl gap-0 px-6 overflow-x-auto items-stretch">
          <button
            onClick={() => navigate("/shop")}
            className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors"
            style={{ cursor: "pointer" }}
          >
            <Icon name="Package" size={15} />
            Каталог товаров
          </button>
          <button
            onClick={() => navigate("/builds")}
            className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors"
            style={{ cursor: "pointer" }}
          >
            <Icon name="Monitor" size={15} />
            Наши ПК
          </button>

          {/* Разделитель */}
          <div className="mx-3 my-3 w-px bg-border shrink-0" />

          <button
            onClick={() => navigate("/configurator")}
            className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors"
            style={{ cursor: "pointer" }}
          >
            <Icon name="Cpu" size={15} />
            Конфигуратор
          </button>
          <button
            onClick={() => navigate("/community-builds")}
            className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors"
            style={{ cursor: "pointer" }}
          >
            <Icon name="Users" size={15} />
            Сборки сообщества
          </button>
          <button
            onClick={() => navigate("/articles")}
            className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors"
            style={{ cursor: "pointer" }}
          >
            <Icon name="BookOpen" size={15} />
            Статьи
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Три баннера */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Banner img={BANNER_PODBOR} title="Покупка комплектующих" to="/shop" />
          <Banner img={BANNER_SBORKA} title="Заказать сборку ПК" to="/builds" />
          <Banner img={BANNER_RAZGON} title="Ремонт и обслуживание" to="/articles" />
        </div>

        {/* Основной грид: контент слева + сайдбар справа */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Левая колонка — CTA */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-card to-accent/10 p-6 sm:p-8">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Icon name="Cpu" size={24} />
              </span>
              <h2 className="text-2xl font-bold leading-tight sm:text-3xl">
                Подобрать конфигурацию ПК под ваши задачи можно тут
              </h2>
              <p className="text-foreground/60">
                Игры, работа, монтаж или сервер — соберём оптимальную конфигурацию по вашему бюджету.
              </p>
              <button onClick={() => navigate("/configurator")} style={{ cursor: "pointer" }}
                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                Открыть конфигуратор <Icon name="ArrowRight" size={16} />
              </button>
            </div>
          </div>

          {/* Сайдбар */}
          <div className="space-y-6">
            {/* Сборки пользователей */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <h3 className="mb-3 text-base font-bold">Сборки пользователей</h3>
              <div className="space-y-2.5">
                {builds.length === 0 ? (
                  <p className="py-4 text-center text-sm text-foreground/40">Пока нет сборок</p>
                ) : builds.map(b => (
                  <button key={b.id} onClick={() => navigate("/community-builds")} style={{ cursor: "pointer" }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border-b border-border/60 pb-2.5 text-left last:border-0 last:pb-0 hover:text-primary transition-colors">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{b.name || b.username || "Сборка"}</p>
                      <p className="text-xs text-foreground/40">{fmtDate(b.created_at)}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtPrice(b.total_price)}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => navigate("/community-builds")} style={{ cursor: "pointer" }}
                className="mt-3 w-full rounded-lg border border-border py-2 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
                Посмотреть все
              </button>
            </div>

            {/* Последние статьи */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-bold">Последние статьи</h3>
                <button onClick={() => navigate("/articles")} style={{ cursor: "pointer" }}
                  className="text-sm font-medium text-foreground/60 hover:text-primary transition-colors">
                  Все статьи
                </button>
              </div>
              {articles.length === 0 ? (
                <p className="py-4 text-center text-sm text-foreground/40">Пока нет статей</p>
              ) : (
                <div className="group/car relative"
                  onMouseEnter={() => { artPaused.current = true }}
                  onMouseLeave={() => { artPaused.current = false }}>
                  <div className="overflow-hidden">
                    <div className="flex transition-transform duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{ transform: `translateX(-${artIdx * 100}%)` }}>
                      {articles.map((a, i) => (
                        <button key={a.id} onClick={() => navigate(`/articles/${a.id}`)} style={{ cursor: "pointer" }}
                          className="group block w-full shrink-0 text-left">
                          <div className="relative h-56 w-full overflow-hidden rounded-xl border border-border bg-muted">
                            {a.image_url ? (
                              <img src={a.image_url} alt={a.title}
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                            ) : (
                              <div className="flex h-full items-center justify-center">
                                <Icon name="FileText" size={36} className="text-foreground/15" />
                              </div>
                            )}
                          </div>
                          <p className="mt-2 text-xs text-foreground/40">{fmtDate(a.created_at)}</p>
                          <p className="line-clamp-2 text-sm font-medium group-hover:text-primary transition-colors">{a.title}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  {articles.length > 1 && (
                    <>
                      <button onClick={() => goArticle(-1)} style={{ cursor: "pointer" }} aria-label="Назад"
                        className="absolute left-1 top-28 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-md opacity-0 transition-opacity group-hover/car:opacity-100 hover:bg-background">
                        <Icon name="ChevronLeft" size={18} />
                      </button>
                      <button onClick={() => goArticle(1)} style={{ cursor: "pointer" }} aria-label="Вперёд"
                        className="absolute right-1 top-28 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-md opacity-0 transition-opacity group-hover/car:opacity-100 hover:bg-background">
                        <Icon name="ChevronRight" size={18} />
                      </button>
                      <div className="mt-3 flex justify-center gap-1.5">
                        {articles.map((_, i) => (
                          <button key={i} onClick={() => setArtIdx(i)} style={{ cursor: "pointer" }} aria-label={`Статья ${i + 1}`}
                            className={`h-1.5 rounded-full transition-all ${i === artIdx ? "w-4 bg-primary" : "w-1.5 bg-foreground/20"}`} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}