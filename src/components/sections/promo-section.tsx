import { useReveal } from "@/hooks/use-reveal"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface Promo {
  id: number
  code: string
  title: string | null
  description: string | null
  scope: string
  build_part: string
  discount_type: string
  discount_value: number
  min_order_amount: number
  expires_at: string | null
}

const SCOPE_LABEL: Record<string, string> = {
  cart: "На весь заказ",
  category: "На выбранные товары",
  build: "На сборку ПК",
  combo: "Набор со скидкой",
  first: "Только для первого заказа",
}

export function PromoSection() {
  const { ref, isVisible } = useReveal(0.15)
  const [promos, setPromos] = useState<Promo[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.promos.getPublic()
      .then(d => setPromos(d.promos || []))
      .catch(() => {})
  }, [])

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"
  const discount = (p: Promo) =>
    p.discount_type === "percent" ? `−${p.discount_value}%` : `−${fmt(p.discount_value)}`

  const copy = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(code)
    setTimeout(() => setCopied(c => (c === code ? null : c)), 1800)
  }

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="flex min-h-screen w-full items-center px-4 py-24 md:px-12 lg:px-16"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className={`mb-10 transition-all duration-700 ${isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}>
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-foreground/40">Выгода</p>
          <h2 className="font-sans text-4xl font-light tracking-tight text-foreground md:text-5xl">Акции и промокоды</h2>
        </div>

        {promos.length === 0 ? (
          <div className={`rounded-2xl border border-dashed border-foreground/15 py-16 text-center transition-all duration-700 delay-100 ${isVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
            <Icon name="Ticket" size={40} className="mx-auto mb-3 text-foreground/25" />
            <p className="text-foreground/50">Сейчас активных акций нет — заглядывайте позже!</p>
          </div>
        ) : (
          <div className={`grid gap-4 sm:grid-cols-2 transition-all duration-700 delay-100 ${isVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
            {promos.map(p => (
              <div key={p.id} className="group relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.04] p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex h-14 min-w-14 items-center justify-center rounded-xl bg-primary/15 px-3 text-xl font-bold text-primary">
                    {discount(p)}
                  </div>
                  {p.scope === "first" && (
                    <span className="rounded-full bg-green-500/15 px-2.5 py-1 text-[11px] font-medium text-green-500">Новичкам</span>
                  )}
                </div>
                <h3 className="mb-1 text-lg font-medium text-foreground">{p.title || "Промокод"}</h3>
                {p.description && (
                  <div className="rich-content mb-3 text-sm leading-relaxed text-foreground/60"
                    dangerouslySetInnerHTML={{ __html: p.description }} />
                )}

                <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/45">
                  <span className="inline-flex items-center gap-1"><Icon name="Tag" size={12} />{SCOPE_LABEL[p.scope] || "Скидка"}</span>
                  {p.min_order_amount > 0 && <span className="inline-flex items-center gap-1"><Icon name="Wallet" size={12} />от {fmt(p.min_order_amount)}</span>}
                  {p.expires_at && <span className="inline-flex items-center gap-1"><Icon name="Clock" size={12} />до {new Date(p.expires_at).toLocaleDateString("ru-RU")}</span>}
                </div>

                <button
                  onClick={() => copy(p.code)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-primary/40 bg-background/40 px-4 py-2.5 text-left transition-colors hover:border-primary"
                  style={{ cursor: "pointer" }}
                >
                  <span className="font-mono font-semibold tracking-wider text-foreground">{p.code}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Icon name={copied === p.code ? "Check" : "Copy"} size={14} />
                    {copied === p.code ? "Скопировано" : "Копировать"}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={`mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm transition-all duration-700 delay-200 ${isVisible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}>
          <span className="text-foreground/50">Промокод вводится в корзине при оформлении заказа.</span>
          <button onClick={() => navigate("/shop")} className="inline-flex items-center gap-1.5 font-medium text-primary transition-opacity hover:opacity-80" style={{ cursor: "pointer" }}>
            <Icon name="ShoppingBag" size={14} />
            Перейти в каталог
          </button>
        </div>
      </div>
    </section>
  )
}