import { useNavigate, useLocation } from "react-router-dom"
import Icon from "@/components/ui/icon"

// Единая лента вкладок каталога. Используется на всех публичных страницах
// каталога, чтобы навигация выглядела одинаково и была в одном месте.
// type "div" — обычный разделитель между группами пунктов.
interface Tab { label: string; icon: string; path: string }

const TABS: Array<Tab | "sep"> = [
  { label: "Каталог товаров", icon: "Package", path: "/shop" },
  { label: "Наши ПК", icon: "Monitor", path: "/builds" },
  "sep",
  { label: "Конфигуратор", icon: "Cpu", path: "/configurator" },
  { label: "Сборки сообщества", icon: "Users", path: "/community-builds" },
  "sep",
  { label: "Статьи", icon: "BookOpen", path: "/articles" },
  { label: "Тир-листы", icon: "Trophy", path: "/tier-lists" },
]

export default function CatalogTabs() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div className="border-b border-border">
      <div className="mx-auto flex max-w-7xl gap-0 px-6 overflow-x-auto items-stretch">
        {TABS.map((t, i) => {
          if (t === "sep") return <div key={`sep-${i}`} className="mx-3 my-3 w-px bg-border shrink-0" />
          const active = pathname === t.path || pathname.startsWith(t.path + "/")
          return (
            <button
              key={t.path}
              onClick={() => navigate(t.path)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-foreground/60 hover:text-foreground"
              }`}
              style={{ cursor: "pointer" }}
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
