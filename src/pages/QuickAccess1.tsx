import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"

interface Tile {
  to: string
  title: string
  desc: string
  icon: string
  accent: string
}

const TILES: Tile[] = [
  { to: "/configurator",     title: "Конфигуратор",     desc: "Собери свой ПК по шагам", icon: "Cpu",        accent: "from-primary/20 to-primary/5" },
  { to: "/shop",             title: "Магазин",          desc: "Комплектующие в наличии", icon: "ShoppingBag", accent: "from-accent/20 to-accent/5" },
  { to: "/builds",           title: "Готовые сборки",   desc: "Подобранные конфигурации", icon: "MonitorSmartphone", accent: "from-primary/20 to-primary/5" },
  { to: "/articles",         title: "Статьи",           desc: "Гайды и обзоры",          icon: "BookOpen",    accent: "from-accent/20 to-accent/5" },
  { to: "/community-builds", title: "Сборки сообщества", desc: "Конфигурации от других",  icon: "Users",       accent: "from-primary/20 to-primary/5" },
  { to: "/b2b",              title: "B2B прайс",        desc: "Оптовые цены для партнёров", icon: "Briefcase", accent: "from-accent/20 to-accent/5" },
  { to: "/profile",          title: "Личный кабинет",   desc: "Профиль и мои сборки",    icon: "User",        accent: "from-primary/20 to-primary/5" },
  { to: "/cart",             title: "Корзина",          desc: "Оформить заказ",          icon: "ShoppingCart", accent: "from-accent/20 to-accent/5" },
]

export default function QuickAccess1() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
        {/* Шапка */}
        <div className="mb-10 flex flex-col items-start gap-3 sm:mb-14">
          <button onClick={() => navigate("/welcome")}
            className="flex items-center gap-1.5 text-sm text-foreground/40 hover:text-foreground transition-colors"
            style={{ cursor: "pointer" }}>
            <Icon name="Sparkles" size={15} /> На промо-страницу
          </button>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Куда направимся?</h1>
          <p className="text-foreground/50">Быстрый доступ ко всем разделам сайта</p>
        </div>

        {/* Плитки */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TILES.map(t => (
            <button key={t.to} onClick={() => navigate(t.to)} style={{ cursor: "pointer" }}
              className={`group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br ${t.accent} p-6 text-left transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg`}>
              <div className="mb-12 flex h-12 w-12 items-center justify-center rounded-xl bg-background/60 backdrop-blur">
                <Icon name={t.icon} size={24} className="text-primary" />
              </div>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">{t.title}</h3>
                  <p className="mt-0.5 text-sm text-foreground/50">{t.desc}</p>
                </div>
                <Icon name="ArrowUpRight" size={20}
                  className="shrink-0 text-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
