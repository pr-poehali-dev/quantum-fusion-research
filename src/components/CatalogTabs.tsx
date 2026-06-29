import { useState, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import Icon from "@/components/ui/icon"

// Единая лента вкладок каталога. Используется на всех публичных страницах
// каталога, чтобы навигация выглядела одинаково и была в одном месте.
// type "sep" — обычный разделитель между группами пунктов.
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

const ITEMS = TABS.filter((t): t is Tab => t !== "sep")

export default function CatalogTabs() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/")
  const current = ITEMS.find(t => isActive(t.path)) || ITEMS[0]

  // Закрытие мобильного меню по клику вне и по Esc
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey) }
  }, [open])

  return (
    <div className="border-b border-border">
      {/* Десктоп: горизонтальная лента вкладок (один клик = переход) */}
      <div className="mx-auto hidden max-w-7xl items-stretch justify-center px-6 sm:flex">
        {TABS.map((t, i) => {
          if (t === "sep") return <div key={`sep-${i}`} className="mx-3 my-3 w-px bg-border shrink-0" />
          const active = isActive(t.path)
          return (
            <button
              key={t.path}
              onClick={() => navigate(t.path)}
              title={t.label}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${
                active ? "border-primary text-primary" : "border-transparent text-foreground/60 hover:text-foreground"
              }`}
              style={{ cursor: "pointer" }}
            >
              <Icon name={t.icon} size={15} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Телефон: выпадающий список разделов (один тап = переход) */}
      <div ref={ref} className="relative mx-auto max-w-7xl px-4 py-2 sm:hidden">
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground"
          style={{ cursor: "pointer" }}
        >
          <span className="flex items-center gap-2">
            <Icon name={current.icon} size={16} className="text-primary" />
            {current.label}
          </span>
          <Icon name="ChevronDown" size={16} className={`text-foreground/40 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute left-4 right-4 z-50 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            {ITEMS.map(t => {
              const active = isActive(t.path)
              return (
                <button
                  key={t.path}
                  onClick={() => { setOpen(false); navigate(t.path) }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
                    active ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-muted"
                  }`}
                  style={{ cursor: "pointer" }}
                >
                  <Icon name={t.icon} size={16} className={active ? "text-primary" : "text-foreground/40"} />
                  {t.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
