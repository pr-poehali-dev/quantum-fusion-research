import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"

interface Row {
  to: string
  title: string
  desc: string
  icon: string
}

const PRIMARY: Row[] = [
  { to: "/configurator", title: "Конфигуратор", desc: "Собрать ПК по шагам", icon: "Cpu" },
  { to: "/shop",         title: "Магазин",      desc: "Комплектующие в наличии", icon: "ShoppingBag" },
  { to: "/builds",       title: "Готовые сборки", desc: "Подобранные конфигурации", icon: "MonitorSmartphone" },
  { to: "/articles",     title: "Статьи",       desc: "Гайды и обзоры", icon: "BookOpen" },
]

const SECONDARY: Row[] = [
  { to: "/community-builds", title: "Сборки сообщества", desc: "Конфигурации от других", icon: "Users" },
  { to: "/b2b",              title: "B2B прайс",         desc: "Оптовые цены", icon: "Briefcase" },
  { to: "/profile",          title: "Личный кабинет",    desc: "Профиль и мои сборки", icon: "User" },
  { to: "/cart",             title: "Корзина",           desc: "Оформить заказ", icon: "ShoppingCart" },
]

export default function QuickAccess2() {
  const navigate = useNavigate()

  const RowItem = ({ r, big }: { r: Row; big?: boolean }) => (
    <button onClick={() => navigate(r.to)} style={{ cursor: "pointer" }}
      className="group flex w-full items-center gap-4 border-b border-border py-5 text-left transition-colors hover:border-primary">
      <div className={`flex items-center justify-center rounded-lg bg-muted text-foreground/60 transition-colors group-hover:bg-primary group-hover:text-primary-foreground ${big ? "h-12 w-12" : "h-10 w-10"}`}>
        <Icon name={r.icon} size={big ? 22 : 18} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className={`font-semibold transition-colors group-hover:text-primary ${big ? "text-xl sm:text-2xl" : "text-base"}`}>{r.title}</h3>
        <p className="text-sm text-foreground/45">{r.desc}</p>
      </div>
      <Icon name="ChevronRight" size={20} className="shrink-0 text-foreground/25 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
    </button>
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-20">
        <button onClick={() => navigate("/welcome")}
          className="mb-8 flex items-center gap-1.5 text-sm text-foreground/40 hover:text-foreground transition-colors"
          style={{ cursor: "pointer" }}>
          <Icon name="Sparkles" size={15} /> На промо-страницу
        </button>

        <h1 className="mb-2 font-mono text-3xl font-bold tracking-tight sm:text-4xl">
          <span className="text-primary">/</span> Навигация
        </h1>
        <p className="mb-10 text-foreground/50">Выберите раздел</p>

        <div className="mb-10">
          <p className="mb-1 font-mono text-xs uppercase tracking-widest text-foreground/35">Основное</p>
          {PRIMARY.map(r => <RowItem key={r.to} r={r} big />)}
        </div>

        <div>
          <p className="mb-1 font-mono text-xs uppercase tracking-widest text-foreground/35">Ещё</p>
          {SECONDARY.map(r => <RowItem key={r.to} r={r} />)}
        </div>
      </div>
    </div>
  )
}
