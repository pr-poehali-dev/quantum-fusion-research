import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import CatalogTabs from "@/components/CatalogTabs"
import SiteHeader from "@/components/SiteHeader"
import Footer from "@/components/Footer"
import Seo from "@/components/Seo"

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
  activations_left: number | null
  activations_total: number | null
}

const SCOPE_LABEL: Record<string, string> = {
  cart: "На весь заказ",
  category: "На выбранные товары",
  product: "На конкретные товары",
  build: "На сборку ПК",
  combo: "Набор со скидкой",
  first: "Только для первого заказа",
}

// Обратный отсчёт до конца акции: «5 дн 3 ч» / «12 ч 40 мин» / «45 мин»
function countdown(iso: string, nowMs: number): string | null {
  const end = new Date(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z").getTime()
  const diff = end - nowMs
  if (isNaN(end) || diff <= 0) return null
  const m = Math.floor(diff / 60000)
  const days = Math.floor(m / 1440)
  const hours = Math.floor((m % 1440) / 60)
  const mins = m % 60
  if (days > 0) return `${days} дн ${hours} ч`
  if (hours > 0) return `${hours} ч ${mins} мин`
  return `${mins} мин`
}

export default function Promo() {
  const navigate = useNavigate()
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    api.promos.getPublic()
      .then(d => setPromos(d.promos || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Тикаем раз в минуту — обновляем обратный отсчёт до конца акций
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
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
    <div className="min-h-screen bg-background">
      <Seo
        title="Акции и промокоды — скидки на сборки ПК и комплектующие"
        description="Актуальные акции и промокоды BeGraphics: скидки на сборки ПК, комплектующие и первый заказ. Вводите промокод в корзине."
        path="/promo"
      />
      {/* Базовая шапка сайта */}
      <SiteHeader />

      <CatalogTabs />

      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
        <h1 className="mb-2 font-sans text-4xl font-light tracking-tight text-foreground md:text-5xl">
          Акции и промокоды
        </h1>
        <p className="mb-8 text-sm text-foreground/50">
          Скопируйте промокод и введите его в корзине при оформлении заказа.
        </p>

        {loading ? (
          <div className="py-20 text-center text-foreground/40">Загрузка…</div>
        ) : !promos.length ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <Icon name="Ticket" size={48} className="text-foreground/15" />
            <p className="text-sm text-foreground/40">Сейчас активных акций нет — заглядывайте позже!</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
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

                {/* Остаток активаций и обратный отсчёт */}
                {(p.activations_total != null || (p.expires_at && countdown(p.expires_at, now))) && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
                    {p.activations_total != null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 font-medium text-amber-500">
                        <Icon name="Ticket" size={12} />
                        Осталось {p.activations_left ?? 0} из {p.activations_total}
                      </span>
                    )}
                    {p.expires_at && countdown(p.expires_at, now) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 font-medium text-red-500">
                        <Icon name="Timer" size={12} />
                        До конца: {countdown(p.expires_at, now)}
                      </span>
                    )}
                  </div>
                )}

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
                <button
                  onClick={() => navigate(`/promo/${p.id}`)}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-foreground/50 hover:text-primary transition-colors"
                  style={{ cursor: "pointer" }}
                >
                  Подробнее об акции<Icon name="ChevronRight" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-8 text-center">
          <Icon name="ShoppingBag" size={36} className="text-primary" />
          <div>
            <p className="text-lg font-medium text-foreground">Готовы применить промокод?</p>
            <p className="mt-1 text-sm text-foreground/50">Выберите товары в каталоге и введите код в корзине.</p>
          </div>
          <button
            onClick={() => navigate("/shop")}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            style={{ cursor: "pointer" }}
          >
            <Icon name="Package" size={16} />
            Перейти в каталог
          </button>
        </div>
      </div>

      <Footer />
    </div>
  )
}