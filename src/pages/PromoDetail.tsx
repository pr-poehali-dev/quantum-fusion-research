import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import CatalogTabs from "@/components/CatalogTabs"
import SiteHeader from "@/components/SiteHeader"
import Footer from "@/components/Footer"
import Seo from "@/components/Seo"

interface PromoItem {
  kind: string
  id: number
  name: string
  price: number | null
  url: string
}
interface Promo {
  id: number
  code: string
  title: string | null
  description: string | null
  scope: string
  discount_type: string
  discount_value: number
  max_discount: number | null
  min_order_amount: number
  expires_at: string | null
  starts_at: string | null
  activations_left: number | null
  activations_total: number | null
  items: PromoItem[]
}

const SCOPE_LABEL: Record<string, string> = {
  cart: "На весь заказ",
  category: "На выбранные категории",
  product: "На конкретные товары и сборки",
  build: "На сборку ПК",
  combo: "Набор со скидкой",
  first: "Только для первого заказа",
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

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

export default function PromoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [promo, setPromo] = useState<Promo | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!id) return
    api.promos.getOne(id)
      .then(d => setPromo(d.promo || null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const discount = promo
    ? (promo.discount_type === "percent" ? `−${promo.discount_value}%` : `−${fmt(promo.discount_value)}`)
    : ""

  const copy = () => {
    if (!promo) return
    navigator.clipboard?.writeText(promo.code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title={promo ? `${promo.title || "Акция"} — промокод ${promo.code}` : "Акция"}
        description={promo?.title ? `${promo.title}. Промокод ${promo.code}, скидка ${discount}.` : "Акция BeGraphics"}
        path={`/promo/${id}`}
      />
      <SiteHeader />

      <CatalogTabs />

      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
        {loading ? (
          <div className="py-20 text-center text-foreground/40">Загрузка…</div>
        ) : !promo ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <Icon name="TicketX" size={48} className="text-foreground/15" />
            <p className="text-sm text-foreground/40">Акция не найдена или уже завершилась.</p>
            <button onClick={() => navigate("/promo")} className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90" style={{ cursor: "pointer" }}>
              Все акции
            </button>
          </div>
        ) : (
          <>
            {/* Шапка акции */}
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-16 min-w-16 items-center justify-center rounded-2xl bg-primary/15 px-4 text-2xl font-bold text-primary">
                {discount}
              </div>
              <div>
                <h1 className="text-2xl font-light tracking-tight text-foreground md:text-3xl">{promo.title || "Промокод"}</h1>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-foreground/50">
                  <Icon name="Tag" size={14} />{SCOPE_LABEL[promo.scope] || "Скидка"}
                </p>
              </div>
            </div>

            {/* Промокод */}
            <button onClick={copy}
              className="mb-6 flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/[0.04] px-4 py-3 text-left transition-colors hover:border-primary"
              style={{ cursor: "pointer" }}>
              <span className="font-mono text-lg font-semibold tracking-wider text-foreground">{promo.code}</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                <Icon name={copied ? "Check" : "Copy"} size={15} />
                {copied ? "Скопировано" : "Копировать"}
              </span>
            </button>

            {/* Метрики */}
            <div className="mb-6 flex flex-wrap gap-2 text-xs">
              {promo.min_order_amount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-foreground/60">
                  <Icon name="Wallet" size={13} />от {fmt(promo.min_order_amount)}
                </span>
              )}
              {promo.max_discount && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-foreground/60">
                  <Icon name="BadgePercent" size={13} />макс. скидка {fmt(promo.max_discount)}
                </span>
              )}
              {promo.expires_at && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-foreground/60">
                  <Icon name="Clock" size={13} />до {new Date(promo.expires_at).toLocaleDateString("ru-RU")}
                </span>
              )}
              {promo.activations_total != null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1.5 font-medium text-amber-500">
                  <Icon name="Ticket" size={13} />осталось {promo.activations_left ?? 0} из {promo.activations_total}
                </span>
              )}
              {promo.expires_at && countdown(promo.expires_at, now) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1.5 font-medium text-red-500">
                  <Icon name="Timer" size={13} />до конца: {countdown(promo.expires_at, now)}
                </span>
              )}
            </div>

            {/* Условия (описание) */}
            {promo.description && (
              <div className="mb-6 rounded-2xl border border-border bg-card p-5">
                <p className="mb-2 text-sm font-medium text-foreground">Условия акции</p>
                <div className="rich-content text-sm leading-relaxed text-foreground/70"
                  dangerouslySetInnerHTML={{ __html: promo.description }} />
              </div>
            )}

            {/* Товары/сборки, на которые действует акция */}
            {promo.items?.length > 0 && (
              <div className="mb-8">
                <p className="mb-3 text-sm font-medium text-foreground">Действует на {promo.items.length} {promo.items.length === 1 ? "позицию" : "позиции/й"}:</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {promo.items.map(it => (
                    <button key={`${it.kind}-${it.id}`} onClick={() => navigate(it.url)}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50"
                      style={{ cursor: "pointer" }}>
                      <span className="flex items-center gap-2 min-w-0">
                        <Icon name={it.kind === "build" ? "Cpu" : it.kind === "category" ? "Layers" : "Package"} size={16} className="text-primary shrink-0" />
                        <span className="truncate text-sm font-medium text-foreground">{it.name}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {it.price != null && it.price > 0 && <span className="text-xs text-foreground/50">{fmt(it.price)}</span>}
                        <Icon name="ChevronRight" size={15} className="text-foreground/30" />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-border bg-card px-6 py-6 text-center">
              <p className="text-sm text-foreground/50">Скопируйте промокод <span className="font-mono font-semibold text-foreground">{promo.code}</span> и введите его в корзине при оформлении.</p>
              <button onClick={() => navigate("/shop")} className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90" style={{ cursor: "pointer" }}>
                <Icon name="Package" size={16} />Перейти в каталог
              </button>
            </div>
          </>
        )}
      </div>

      <Footer />
    </div>
  )
}