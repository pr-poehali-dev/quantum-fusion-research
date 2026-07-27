import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import CatalogTabs from "@/components/CatalogTabs"
import SiteHeader from "@/components/SiteHeader"
import Footer from "@/components/Footer"
import Seo from "@/components/Seo"

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

export default function Faq() {
  const [categories, setCategories] = useState<FaqCategory[]>([])
  const [activeCat, setActiveCat] = useState<number | null>(null)
  const [openItem, setOpenItem] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.faq.getPublic()
      .then(d => {
        const cats: FaqCategory[] = d.categories || []
        setCategories(cats)
        if (cats.length) setActiveCat(cats[0].id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const current = categories.find(c => c.id === activeCat) || categories[0]

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title="Вопрос-ответ — частые вопросы о заказе, доставке и гарантии"
        description="Ответы на частые вопросы: оплата, доставка, гарантия и сборка ПК на заказ в BeGraphics."
        path="/faq"
      />
      {/* Базовая шапка сайта */}
      <SiteHeader back />

      <CatalogTabs />

      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
        <h1 className="mb-6 font-sans text-4xl font-light tracking-tight text-foreground md:mb-8 md:text-5xl">
          Вопрос-ответ
        </h1>

        {loading ? (
          <div className="py-20 text-center text-foreground/40">Загрузка…</div>
        ) : !categories.length ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <Icon name="MessagesSquare" size={48} className="text-foreground/15" />
            <p className="text-sm text-foreground/40">Вопросы скоро появятся</p>
          </div>
        ) : (
          <>
            {/* Табы категорий */}
            <div className="mb-8 flex flex-wrap gap-2">
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
            <div className="space-y-3">
              {current?.items.map(item => {
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
                    <div className={`grid transition-all duration-300 ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
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

            {/* Не нашли ответ — связь в Telegram */}
            <div className="mt-10 flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-8 text-center">
              <Icon name="MessageCircleQuestion" fallback="MessagesSquare" size={36} className="text-primary" />
              <div>
                <p className="text-lg font-medium text-foreground">Не нашли ответ на свой вопрос?</p>
                <p className="mt-1 text-sm text-foreground/50">Напишите нам — ответим и поможем с выбором.</p>
              </div>
              <a
                href="https://t.me/BeGraphicsPC"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                style={{ cursor: "pointer" }}
              >
                <Icon name="Send" size={16} />
                Написать в Telegram
              </a>
            </div>
          </>
        )}
      </div>

      <Footer />
    </div>
  )
}