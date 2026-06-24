import { useState, useEffect, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { getAdminKey } from "@/pages/admin/types"

interface Suggestion {
  id: number
  kind: "price_change" | "new_product"
  product_id: number | null
  source_name: string | null
  ext_name: string | null
  ext_url: string | null
  market_price: number | null
  current_price: number | null
  suggested_price: number | null
  product_name: string | null
  created_at: string | null
}

const fmt = (v: number | null) =>
  v === null || v === undefined ? "—" : `${Math.round(v).toLocaleString("ru-RU")} ₽`

export default function PriceMonitorTab() {
  const [view, setView] = useState<"price_change" | "new_product">("price_change")
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Suggestion[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.priceMonitor.list(getAdminKey(), view)
      .then(d => {
        setItems(d.items || [])
        setCounts(d.counts || {})
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [view])

  useEffect(() => { load() }, [load])

  const accept = async (id: number) => {
    setBusy(id)
    await api.priceMonitor.accept(id, getAdminKey())
    setItems(rs => rs.filter(r => r.id !== id))
    setBusy(null)
  }
  const reject = async (id: number) => {
    setBusy(id)
    await api.priceMonitor.reject(id, getAdminKey())
    setItems(rs => rs.filter(r => r.id !== id))
    setBusy(null)
  }
  const acceptAll = async () => {
    if (!confirm("Принять все изменения цен? Цены товаров обновятся автоматически.")) return
    setLoading(true)
    await api.priceMonitor.acceptAll(getAdminKey())
    load()
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-light text-foreground">Цены от парсера</h2>
          <p className="text-sm text-foreground/50">
            Утренние предложения по изменению цен. Подтверди — и цена в товаре обновится сама.
          </p>
        </div>
        {view === "price_change" && items.length > 0 && (
          <button onClick={acceptAll}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            style={{ cursor: "pointer" }}>
            <Icon name="CheckCheck" size={16} />Принять все
          </button>
        )}
      </div>

      {/* Подвкладки */}
      <div className="mb-5 flex gap-2">
        {([
          { key: "price_change", label: "Изменения цен", icon: "TrendingUp" },
          { key: "new_product", label: "Новые товары", icon: "Sparkles" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${view === t.key ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>
            <Icon name={t.icon} size={15} />
            {t.label}
            {counts[t.key] > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-xs text-primary">{counts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <Icon name="CircleCheck" size={32} className="mx-auto mb-3 text-foreground/30" />
          <p className="text-sm text-foreground/50">Предложений нет — всё актуально</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map(s => (
            <div key={s.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-foreground">
                      {s.kind === "price_change" ? (s.product_name || s.ext_name) : s.ext_name}
                    </p>
                    {s.source_name && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/60">{s.source_name}</span>
                    )}
                  </div>
                  {s.kind === "price_change" && s.ext_name && s.ext_name !== s.product_name && (
                    <p className="mt-0.5 truncate text-xs text-foreground/40">У конкурента: {s.ext_name}</p>
                  )}
                  {s.ext_url && (
                    <a href={s.ext_url} target="_blank" rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <Icon name="ExternalLink" size={12} />Открыть у конкурента
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-4 text-sm">
                    {s.kind === "price_change" && (
                      <div className="text-center">
                        <p className="text-xs text-foreground/40">У нас</p>
                        <p className="font-medium text-foreground/70">{fmt(s.current_price)}</p>
                      </div>
                    )}
                    <div className="text-center">
                      <p className="text-xs text-foreground/40">Рынок</p>
                      <p className="font-medium text-foreground/70">{fmt(s.market_price)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-foreground/40">Рекомендуем</p>
                      <p className="font-semibold text-primary">{fmt(s.suggested_price)}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {s.kind === "price_change" && (
                      <button onClick={() => accept(s.id)} disabled={busy === s.id}
                        title="Принять — обновить цену товара"
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        style={{ cursor: "pointer" }}>
                        <Icon name="Check" size={16} />
                      </button>
                    )}
                    <button onClick={() => reject(s.id)} disabled={busy === s.id}
                      title={s.kind === "new_product" ? "Скрыть" : "Отклонить"}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground/60 hover:text-foreground transition-colors disabled:opacity-50"
                      style={{ cursor: "pointer" }}>
                      <Icon name="X" size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
