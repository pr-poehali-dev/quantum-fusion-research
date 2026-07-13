import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

type PromoInfo = { promo_id: number; code: string; title: string | null; discount_type: string; discount_value: number }

// Баннер акции на странице товара/сборки. Достаёт активную публичную акцию для
// данной позиции (product_id ИЛИ build_id) из promo_products и показывает
// промокод + скидку со ссылкой на подробности.
export default function PromoBanner({ productId, buildId }: { productId?: number; buildId?: number }) {
  const navigate = useNavigate()
  const [promo, setPromo] = useState<PromoInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.promos.promoProducts().then(d => {
      if (cancelled) return
      const map = buildId != null ? (d.builds || {}) : (d.products || {})
      const key = buildId != null ? buildId : productId
      if (key != null && map[key]) setPromo(map[key])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [productId, buildId])

  if (!promo) return null

  const discount = promo.discount_type === "percent"
    ? `−${promo.discount_value}%`
    : `−${promo.discount_value.toLocaleString("ru-RU")} ₽`

  const copy = () => {
    navigator.clipboard?.writeText(promo.code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3.5">
      <div className="flex items-center gap-2">
        <Icon name="Flame" size={16} className="shrink-0 text-red-500" />
        <span className="text-sm font-semibold text-foreground">Акция{promo.title ? `: ${promo.title}` : ""}</span>
        <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">{discount}</span>
      </div>
      <p className="mt-1.5 text-xs text-foreground/60">
        Введите промокод в корзине и получите скидку на эту позицию.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <button onClick={copy}
          className="flex flex-1 items-center justify-between gap-2 rounded-lg border border-dashed border-red-500/40 bg-background/40 px-3 py-2 text-left transition-colors hover:border-red-500"
          style={{ cursor: "pointer" }}>
          <span className="font-mono font-semibold tracking-wider text-foreground">{promo.code}</span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
            <Icon name={copied ? "Check" : "Copy"} size={13} />
            {copied ? "Скопировано" : "Копировать"}
          </span>
        </button>
        <button onClick={() => navigate(`/promo/${promo.promo_id}`)}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
          style={{ cursor: "pointer" }}>
          Подробнее
        </button>
      </div>
    </div>
  )
}
