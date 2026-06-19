import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"

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
}

const BANNER_PODBOR = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/75277750-81a9-4f82-b445-716b62761bdc.jpg"
const BANNER_SBORKA = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/19cce97b-1292-48ca-8691-778f0decabc4.jpg"
const BANNER_RAZGON = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/ea6ff91c-e9c2-4cc8-9cb1-00918fff1b5d.jpg"

const fmtPrice = (n?: number) => (n ? Math.round(n).toLocaleString("ru-RU") + " ₽" : "—")
const fmtDate = (s: string) => {
  if (!s) return ""
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z")
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const NAV = [
  { label: "Каталог", to: "/shop" },
  { label: "Статьи", to: "/articles" },
  { label: "Таблицы", to: "/builds" },
  { label: "Компьютеры", to: "/builds" },
]

export default function HomeStonks() {
  const navigate = useNavigate()
  const [builds, setBuilds] = useState<CommunityBuild[]>([])
  const [articles, setArticles] = useState<Article[]>([])

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
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
      <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-2xl font-extrabold leading-tight text-white drop-shadow-lg sm:text-3xl">
        {title}
      </span>
    </button>
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Шапка */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 shrink-0" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Icon name="Cpu" size={20} /></div>
            <div className="leading-none">
              <span className="block text-lg font-extrabold tracking-tight">PCSTONKS</span>
              <span className="block text-[9px] uppercase tracking-widest text-foreground/40">сборка · настройка · обслуживание</span>
            </div>
          </button>

          <div className="ml-2 hidden items-center gap-2 md:flex">
            <button onClick={() => navigate("/configurator")} style={{ cursor: "pointer" }}
              className="rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">Конфигуратор</button>
            <button onClick={() => navigate("/builds")} style={{ cursor: "pointer" }}
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent/90 transition-colors">Готовые ПК</button>
          </div>

          <nav className="ml-auto hidden items-center gap-5 lg:flex">
            {NAV.map(n => (
              <button key={n.label} onClick={() => navigate(n.to)} style={{ cursor: "pointer" }}
                className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors">{n.label}</button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-2">
            <button onClick={() => navigate("/cart")} className="flex h-9 w-9 items-center justify-center rounded-full border border-border hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="ShoppingCart" size={17} />
            </button>
            <button onClick={() => navigate("/profile")} className="flex h-9 w-9 items-center justify-center rounded-full border border-border hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="User" size={17} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Три баннера */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Banner img={BANNER_PODBOR} title="Подбор комплектующих" to="/configurator" />
          <Banner img={BANNER_SBORKA} title="Заказать сборку ПК" to="/builds" />
          <Banner img={BANNER_RAZGON} title="Разгон и настройка" to="/articles" />
        </div>

        {/* CTA-полоса */}
        <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row">
          <p className="text-center text-base font-semibold sm:text-left">
            Затрудняетесь с выбором комплектующих для сборки ПК? Мы поможем вам!
          </p>
          <button onClick={() => navigate("/configurator")} style={{ cursor: "pointer" }}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            <Icon name="MessageCircleQuestion" size={16} /> Задать вопрос
          </button>
        </div>

        {/* Основной грид: контент + сайдбар */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {/* Видео-карточки */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { t: "Сборка ПК 50K", c: "from-primary/30 to-primary/5" },
                  { t: "Топ NVMe SSD", c: "from-accent/30 to-accent/5" },
                  { t: "Отвал контроллера", c: "from-primary/30 to-primary/5" },
                  { t: "Мифы про ПК", c: "from-accent/30 to-accent/5" },
                ].map((v, i) => (
                  <button key={i} onClick={() => navigate("/articles")} style={{ cursor: "pointer" }}
                    className={`group relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-gradient-to-br ${v.c}`}>
                    <span className="absolute left-2 right-2 top-2 text-sm font-bold leading-tight text-white drop-shadow">{v.t}</span>
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-transform group-hover:scale-110">
                        <Icon name="Play" size={20} />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Большой блок «Стримы» */}
            <button onClick={() => navigate("/articles")} style={{ cursor: "pointer" }}
              className="group relative flex h-72 w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/20 via-card to-accent/10 text-center">
              <div className="relative z-10 px-6">
                <span className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white text-red-600 transition-transform group-hover:scale-105">
                  <Icon name="Play" size={36} />
                </span>
                <h2 className="text-3xl font-bold text-foreground">Стримы</h2>
                <p className="mt-1 text-foreground/60">Задайте вопросы в прямом эфире нашим ведущим</p>
                <span className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-5 py-2.5 text-sm font-medium">
                  Открыть канал
                </span>
              </div>
            </button>
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
              <h3 className="mb-3 text-base font-bold">Последние статьи</h3>
              <div className="space-y-3">
                {articles.length === 0 ? (
                  <p className="py-4 text-center text-sm text-foreground/40">Пока нет статей</p>
                ) : articles.map(a => (
                  <button key={a.id} onClick={() => navigate(`/articles/${a.id}`)} style={{ cursor: "pointer" }}
                    className="block w-full text-left">
                    <p className="text-xs text-foreground/40">{fmtDate(a.created_at)}</p>
                    <p className="flex items-start gap-1.5 text-sm font-medium text-primary hover:underline">
                      <Icon name="ChevronRight" size={14} className="mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{a.title}</span>
                    </p>
                  </button>
                ))}
              </div>
              <button onClick={() => navigate("/articles")} style={{ cursor: "pointer" }}
                className="mt-3 w-full rounded-lg border border-border py-2 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
                Все статьи
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
