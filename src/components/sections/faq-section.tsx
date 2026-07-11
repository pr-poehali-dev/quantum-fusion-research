import { useReveal } from "@/hooks/use-reveal"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface FaqItem {
  id: number
  question: string
  answer: string
}
interface FaqCategory {
  id: number
  name: string
  icon: string
  items: FaqItem[]
}

export function FaqSection() {
  const { ref, isVisible } = useReveal(0.15)
  const [categories, setCategories] = useState<FaqCategory[]>([])
  const [activeCat, setActiveCat] = useState<number | null>(null)
  const [openItem, setOpenItem] = useState<number | null>(null)

  useEffect(() => {
    api.faq.getPublic()
      .then(d => {
        const cats: FaqCategory[] = d.categories || []
        setCategories(cats)
        if (cats.length) setActiveCat(cats[0].id)
      })
      .catch(() => {})
  }, [])

  if (!categories.length) return null

  const current = categories.find(c => c.id === activeCat) || categories[0]

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="flex min-h-screen w-full items-center px-4 py-24 md:px-12 lg:px-16"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="mx-auto w-full max-w-4xl">
        {/* Заголовок */}
        <div
          className={`mb-10 transition-all duration-700 ${
            isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
          }`}
        >
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-foreground/40">
            Помощь
          </p>
          <h2 className="font-sans text-4xl font-light tracking-tight text-foreground md:text-5xl">
            Вопросы и ответы
          </h2>
        </div>

        {/* Табы категорий */}
        <div
          className={`mb-8 flex flex-wrap gap-2 transition-all duration-700 delay-100 ${
            isVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => { setActiveCat(cat.id); setOpenItem(null) }}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                activeCat === cat.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-foreground/15 text-foreground/60 hover:border-foreground/30 hover:text-foreground"
              }`}
              style={{ cursor: "pointer" }}
            >
              <Icon name={cat.icon} fallback="HelpCircle" size={15} />
              {cat.name}
            </button>
          ))}
        </div>

        {/* Аккордеон вопросов */}
        <div
          className={`space-y-3 transition-all duration-700 delay-200 ${
            isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
          }`}
        >
          {current.items.map(item => {
            const isOpen = openItem === item.id
            return (
              <div
                key={item.id}
                className="overflow-hidden rounded-xl border border-foreground/10 bg-foreground/[0.03]"
              >
                <button
                  onClick={() => setOpenItem(isOpen ? null : item.id)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  style={{ cursor: "pointer" }}
                >
                  <span className="font-medium text-foreground">{item.question}</span>
                  <Icon
                    name="ChevronDown"
                    size={18}
                    className={`shrink-0 text-foreground/40 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-300 ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <div className="overflow-hidden">
                    <div
                      className="rich-content px-5 pb-5 text-sm leading-relaxed text-foreground/70"
                      dangerouslySetInnerHTML={{ __html: item.answer }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
