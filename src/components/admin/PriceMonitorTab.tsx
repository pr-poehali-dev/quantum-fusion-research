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
  ext_sku?: string | null
  match_score?: number | null
}

interface Candidate {
  product_id: number
  name: string
  price: number
  score: number
}

const fmt = (v: number | null) =>
  v === null || v === undefined ? "—" : `${Math.round(v).toLocaleString("ru-RU")} ₽`

// округление ВВЕРХ до 250 (как на складе для розничной цены)
const ceil250 = (v: number) => Math.ceil(v / 250) * 250

export default function PriceMonitorTab() {
  const [view, setView] = useState<"price_change" | "new_product">("price_change")
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Suggestion[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [processItem, setProcessItem] = useState<Suggestion | null>(null)

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

  // Убирает позицию из списка и уменьшает счётчик её вкладки на 1
  const removeItem = (id: number) => {
    const kind = items.find(r => r.id === id)?.kind
    setItems(rs => rs.filter(r => r.id !== id))
    if (kind) setCounts(c => ({ ...c, [kind]: Math.max(0, (c[kind] || 0) - 1) }))
  }

  const accept = async (id: number) => {
    setBusy(id)
    await api.priceMonitor.accept(id, getAdminKey())
    removeItem(id)
    setBusy(null)
  }
  const reject = async (id: number) => {
    setBusy(id)
    await api.priceMonitor.reject(id, getAdminKey())
    removeItem(id)
    setBusy(null)
  }
  const acceptAll = async () => {
    if (!confirm("Принять все изменения цен? Цены товаров обновятся автоматически.")) return
    setLoading(true)
    await api.priceMonitor.acceptAll(getAdminKey())
    load()
  }
  const rejectAll = async () => {
    const label = view === "price_change" ? "изменения цен" : "новые товары"
    if (!confirm(`Удалить все предложения (${label})? Они пропадут из списка.`)) return
    setLoading(true)
    await api.priceMonitor.rejectAll(getAdminKey(), view)
    setCounts(c => ({ ...c, [view]: 0 }))
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
      <div className="mb-5 flex flex-wrap items-center gap-2">
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
        {items.length > 0 && (
          <button onClick={rejectAll}
            title="Удалить все предложения этой вкладки"
            className="ml-auto flex items-center gap-1.5 rounded-xl border border-red-400/40 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-400/10 transition-colors"
            style={{ cursor: "pointer" }}>
            <Icon name="Trash2" size={15} />Удалить все
          </button>
        )}
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
                      <p className="text-xs text-foreground/40">На сайте</p>
                      <p className="font-medium text-foreground/70">{fmt(s.market_price)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-foreground/40">Рекомендуем</p>
                      <p className="font-semibold text-primary">{fmt(s.suggested_price)}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => setProcessItem(s)} disabled={busy === s.id}
                      title="Обработать — задать цену продажи, привязку"
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                      style={{ cursor: "pointer" }}>
                      <Icon name="Settings2" size={15} />Обработать
                    </button>
                    {s.kind === "price_change" && (
                      <button onClick={() => accept(s.id)} disabled={busy === s.id}
                        title="Быстро принять рекомендованную цену"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
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

      {processItem && (
        <ProcessModal
          item={processItem}
          onClose={() => setProcessItem(null)}
          onDone={() => { setProcessItem(null); load() }}
        />
      )}
    </div>
  )
}

function ProcessModal({ item, onClose, onDone }: {
  item: Suggestion
  onClose: () => void
  onDone: () => void
}) {
  const isNew = item.kind === "new_product"
  // базовая цена: рекомендованная от цены на сайте конкурента (market*0.93)
  const [price, setPrice] = useState<number>(Math.round(item.suggested_price || item.market_price || 0))
  const [linkedId, setLinkedId] = useState<number | null>(item.product_id)
  const [linkedName, setLinkedName] = useState<string | null>(item.product_name)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loadingCand, setLoadingCand] = useState(false)
  const [saving, setSaving] = useState(false)
  // поиск другого товара со склада (как в приёмке по счёту)
  const [picking, setPicking] = useState(false)
  const [searchQ, setSearchQ] = useState("")
  const [searchRes, setSearchRes] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)

  // НДС в мониторе цен не применяется — это только приёмка поставок
  const finalPrice = ceil250(price)

  useEffect(() => {
    if (!isNew || linkedId) return
    setLoadingCand(true)
    api.priceMonitor.match(item.id, getAdminKey())
      .then(d => setCandidates(d.candidates || []))
      .finally(() => setLoadingCand(false))
  }, [isNew, linkedId, item.id])

  // Живой поиск товара по названию (debounce 300мс)
  useEffect(() => {
    if (!picking || searchQ.trim().length < 2) { setSearchRes([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      api.priceMonitor.match(item.id, getAdminKey(), searchQ.trim())
        .then(d => setSearchRes(d.candidates || []))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [picking, searchQ, item.id])

  const link = async (c: Candidate) => {
    await api.priceMonitor.linkProduct(item.id, c.product_id, getAdminKey())
    setLinkedId(c.product_id)
    setLinkedName(c.name)
    // подставляем текущую цену выбранного товара как базу
    if (c.price) setPrice(Math.round(item.suggested_price || item.market_price || c.price))
    setPicking(false); setSearchQ(""); setSearchRes([])
  }

  const apply = async () => {
    setSaving(true)
    await api.priceMonitor.accept(item.id, getAdminKey(), {
      final_price: price,
      ...(linkedId ? { product_id: linkedId } : {}),
    })
    setSaving(false)
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium text-foreground">Обработка предложения</h3>
            <p className="mt-0.5 truncate text-xs text-foreground/50">{item.ext_name}</p>
          </div>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Товар: привязка + возможность выбрать другой со склада */}
        <div className="mb-4">
          <label className="mb-1.5 block text-xs text-foreground/50">
            {isNew ? "Привязка к товару каталога" : "Наш товар"}
          </label>

          {/* Текущий выбранный товар */}
          {linkedId && !picking && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <span className="truncate text-sm text-foreground">{linkedName || "Товар выбран"}</span>
              <button onClick={() => { setPicking(true); setSearchQ(""); setSearchRes([]) }}
                className="shrink-0 text-xs text-primary hover:underline" style={{ cursor: "pointer" }}>
                Выбрать другой
              </button>
            </div>
          )}

          {/* Ничего не привязано (new_product без выбора) */}
          {!linkedId && !picking && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2">
              <span className="text-sm text-foreground/50">Товар не выбран</span>
              <button onClick={() => { setPicking(true); setSearchQ(""); setSearchRes([]) }}
                className="shrink-0 text-xs text-primary hover:underline" style={{ cursor: "pointer" }}>
                Выбрать товар
              </button>
            </div>
          )}

          {/* Режим выбора: поиск + похожие кандидаты (как в приёмке по счёту) */}
          {picking && (
            <div className="rounded-lg border border-primary/20 bg-background p-2">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                  <Icon name="Search" size={14} className="text-foreground/40" />
                  <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                    placeholder="Поиск товара по названию…"
                    className="w-full bg-transparent text-sm outline-none" />
                </div>
                {linkedId && (
                  <button onClick={() => setPicking(false)}
                    className="shrink-0 text-xs text-foreground/50 hover:text-foreground" style={{ cursor: "pointer" }}>
                    Отмена
                  </button>
                )}
              </div>

              <div className="max-h-48 space-y-1 overflow-y-auto">
                {searching ? (
                  <p className="px-1 py-2 text-xs text-foreground/40">Ищу…</p>
                ) : (searchQ.trim().length >= 2 ? searchRes : candidates).length === 0 ? (
                  <p className="px-1 py-2 text-xs text-foreground/40">
                    {searchQ.trim().length >= 2 ? "Ничего не найдено" : loadingCand ? "Загружаю похожие…" : "Начните вводить название"}
                  </p>
                ) : (
                  (searchQ.trim().length >= 2 ? searchRes : candidates).map(c => (
                    <button key={c.product_id} onClick={() => link(c)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left hover:bg-muted transition-colors"
                      style={{ cursor: "pointer" }}>
                      <span className="min-w-0 truncate text-sm text-foreground">{c.name}</span>
                      <span className="shrink-0 text-xs text-foreground/40">
                        {c.price ? fmt(c.price) : `${c.score}%`}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Цена конкурента / наша */}
        <div className="mb-3 flex items-center gap-4 text-sm">
          {item.current_price != null && (
            <div>
              <p className="text-xs text-foreground/40">У нас</p>
              <p className="text-foreground/70">{fmt(item.current_price)}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-foreground/40">На сайте</p>
            <p className="text-foreground/70">{fmt(item.market_price)}</p>
          </div>
        </div>

        {/* Редактируемая цена */}
        <div className="mb-4">
          <label className="mb-1 block text-xs text-foreground/50">Цена продажи</label>
          <input type="number" value={price}
            onChange={e => setPrice(parseFloat(e.target.value) || 0)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>

        {/* Итог */}
        <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
          <span className="text-sm text-foreground/60">Итоговая цена</span>
          <span className="text-lg font-semibold text-primary">{fmt(finalPrice)}</span>
        </div>

        <div className="flex gap-2">
          <button onClick={apply} disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            style={{ cursor: "pointer" }}>
            <Icon name="Check" size={16} />{saving ? "Применяю…" : "Применить цену"}
          </button>
          <button onClick={onClose}
            className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground/60 hover:text-foreground transition-colors"
            style={{ cursor: "pointer" }}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}