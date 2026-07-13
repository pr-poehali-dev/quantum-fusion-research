import { useState, useEffect, useCallback, lazy, Suspense } from "react"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"
import { getAdminKey } from "@/pages/admin/constants"

const RichTextEditor = lazy(() => import("@/components/ui/rich-text-editor"))

const INPUT = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
const LABEL = "mb-1 block text-xs text-foreground/60"

type ComboSlot = { category_ids: number[]; product_ids: number[] }

type Promo = {
  id: number
  code: string
  title: string | null
  description: string | null
  scope: string
  build_part: string
  category_ids: number[]
  product_ids: number[]
  combo_slots: ComboSlot[]
  discount_type: string
  discount_value: number
  max_discount: number | null
  min_order_amount: number
  max_uses: number | null
  used_count: number
  starts_at: string | null
  expires_at: string | null
  is_active: boolean
  is_public: boolean
  sort_order: number
}

type Draft = Partial<Promo>

const SCOPES: { key: string; label: string; hint: string }[] = [
  { key: "cart", label: "Вся корзина", hint: "Скидка на весь заказ" },
  { key: "category", label: "Категории / товары", hint: "Скидка на выбранные позиции в корзине" },
  { key: "product", label: "Конкретный товар", hint: "Скидка на выбранные товары / компы" },
  { key: "build", label: "Сборка ПК", hint: "Скидка на железо или работу в сборках" },
  { key: "combo", label: "Набор / комбо", hint: "Скидка при покупке всех слотов набора" },
  { key: "first", label: "Первый заказ", hint: "Только для первого заказа покупателя" },
]

const emptyDraft = (): Draft => ({
  code: "", title: "", description: "", scope: "cart", build_part: "all",
  category_ids: [], product_ids: [], combo_slots: [],
  discount_type: "percent", discount_value: 10, max_discount: null,
  min_order_amount: 0, max_uses: null, starts_at: null, expires_at: null,
  is_active: true, is_public: false, sort_order: 0,
})

// datetime-local <-> UTC ISO.
// В БД время хранится в UTC, а поле datetime-local работает в локальном времени
// пользователя. Конвертируем в обе стороны, чтобы «действует с 19:56 МСК»
// не превращалось в 19:56 UTC (иначе акция «не началась» на 3 часа).
const toLocal = (v?: string | null) => {
  if (!v) return ""
  // Значение из БД — UTC (может быть без 'Z'). Приводим к Date и берём локальные части.
  const iso = v.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(v) ? v : v + "Z"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)

export default function PromoTab() {
  const ak = getAdminKey()
  const [promos, setPromos] = useState<Promo[]>([])
  const [cats, setCats] = useState<{ id: number; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  // Поиск товаров для типа «Конкретный товар»
  const [prodQuery, setProdQuery] = useState("")
  const [prodResults, setProdResults] = useState<{ id: number; name: string; price: number; category: string | null }[]>([])
  const [prodPicked, setProdPicked] = useState<Record<number, { name: string; price: number }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const [p, c] = await Promise.all([api.promos.list(ak), api.promos.categories()])
    setPromos(p?.promos || [])
    setCats(c?.categories || [])
    setLoading(false)
  }, [ak])
  useEffect(() => { load() }, [load])

  // Живой поиск товаров (debounce) для типа «Конкретный товар»
  useEffect(() => {
    if (draft?.scope !== "product") return
    if (prodQuery.trim().length < 2) { setProdResults([]); return }
    const t = setTimeout(() => {
      api.promos.productsSearch(prodQuery.trim())
        .then(d => setProdResults(d.products || []))
        .catch(() => setProdResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [prodQuery, draft?.scope])

  // При открытии акции на редактирование подтягиваем имена уже выбранных товаров
  useEffect(() => {
    const ids = draft?.product_ids || []
    const missing = ids.filter(id => !prodPicked[id])
    if (draft?.scope === "product" && missing.length) {
      // Догружаем имена через общий поиск товаров (по каждому нет — берём из products.getAll)
      api.products.getAll().then((d: { products?: { id: number; name: string; price: number }[] }) => {
        const map: Record<number, { name: string; price: number }> = {}
        for (const p of (d.products || [])) if (ids.includes(p.id)) map[p.id] = { name: p.name, price: p.price }
        setProdPicked(prev => ({ ...map, ...prev }))
      }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.scope])

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const scopeLabel = (s: string) => SCOPES.find(x => x.key === s)?.label || s

  const discountLabel = (p: Pick<Promo, "discount_type" | "discount_value">) =>
    p.discount_type === "percent" ? `−${p.discount_value}%` : `−${fmt(p.discount_value)}`

  const save = async () => {
    if (!draft?.code?.trim()) { setErr("Введите код промокода"); return }
    setSaving(true)
    setErr("")
    const payload = {
      ...draft,
      code: draft.code.trim().toUpperCase(),
      starts_at: draft.starts_at || null,
      expires_at: draft.expires_at || null,
    }
    const res = await api.promos.save(payload, ak)
    setSaving(false)
    if (res?.error) {
      setErr(res.error === "code_exists" ? "Такой код уже существует" : res.error)
      return
    }
    setDraft(null)
    await load()
  }

  const remove = async (p: Promo) => {
    if (!confirm(`Удалить промокод «${p.code}»?`)) return
    await api.promos.delete(p.id, ak)
    await load()
  }

  const toggleId = (list: number[], id: number) =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-light text-foreground">
          <Icon name="BadgePercent" size={22} className="text-primary" />
          Промокоды <span className="text-sm text-foreground/40">({promos.length})</span>
        </h2>
        <button onClick={() => { setErr(""); setDraft(emptyDraft()) }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={15} />Новый промокод
        </button>
      </div>

      {loading ? (
        <p className="py-16 text-center text-foreground/40">Загрузка…</p>
      ) : promos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Icon name="Ticket" size={40} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-foreground/50">Промокодов пока нет</p>
        </div>
      ) : (
        <div className="space-y-2">
          {promos.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-bold text-primary">
                {discountLabel(p)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-foreground">{p.code}</span>
                  {p.title && <span className="text-sm text-foreground/70">· {p.title}</span>}
                  {!p.is_active && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground/50">выключен</span>}
                  {p.is_public && <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] text-green-500">на сайте</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-foreground/40">
                  <span>{scopeLabel(p.scope)}{p.scope === "build" && p.build_part !== "all" ? ` (${p.build_part === "assembly" ? "работа" : "железо"})` : ""}</span>
                  {p.min_order_amount > 0 && <span>от {fmt(p.min_order_amount)}</span>}
                  {p.max_uses != null && <span>{p.used_count}/{p.max_uses} исп.</span>}
                  {p.max_uses == null && p.used_count > 0 && <span>{p.used_count} исп.</span>}
                  {p.expires_at && <span>до {new Date(p.expires_at).toLocaleDateString("ru-RU")}</span>}
                </div>
              </div>
              <button onClick={() => { setErr(""); setDraft({ ...p }) }} title="Редактировать"
                className="flex items-center justify-center rounded-lg border border-border p-2 text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                style={{ cursor: "pointer" }}>
                <Icon name="Pencil" size={15} />
              </button>
              <button onClick={() => remove(p)} title="Удалить"
                className="flex items-center justify-center rounded-lg border border-red-400/20 p-2 text-red-400/60 hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-400 transition-colors"
                style={{ cursor: "pointer" }}>
                <Icon name="Trash2" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Модалка редактирования */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" style={{ cursor: "auto" }}>
          <div className="my-8 w-full max-w-lg rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-medium text-foreground">{draft.id ? "Промокод" : "Новый промокод"}</h3>
              <button onClick={() => setDraft(null)} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                <Icon name="X" size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Код *</label>
                  <input value={draft.code || ""} onChange={e => setDraft(d => ({ ...d!, code: e.target.value.toUpperCase() }))}
                    className={INPUT + " font-mono uppercase"} placeholder="SALE10" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className={LABEL}>Название (для акций)</label>
                  <input value={draft.title || ""} onChange={e => setDraft(d => ({ ...d!, title: e.target.value }))}
                    className={INPUT} placeholder="Скидка новичкам" style={{ cursor: "text" }} />
                </div>
              </div>

              <div>
                <label className={LABEL}>Описание (показывается в акциях)</label>
                <Suspense fallback={<div className="py-6 text-center text-sm text-foreground/40">Загрузка редактора…</div>}>
                  <RichTextEditor value={draft.description || ""} onChange={v => setDraft(d => ({ ...d!, description: v }))}
                    placeholder="Условия акции…" folder="promos" className="min-h-[140px]" />
                </Suspense>
              </div>

              {/* Тип действия */}
              <div>
                <label className={LABEL}>На что скидка</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {SCOPES.map(s => (
                    <button key={s.key} type="button" onClick={() => setDraft(d => ({ ...d!, scope: s.key }))}
                      title={s.hint}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${draft.scope === s.key ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/40"}`}
                      style={{ cursor: "pointer" }}>
                      <div className="font-medium">{s.label}</div>
                      <div className="mt-0.5 text-[10px] opacity-60">{s.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Настройки для scope=build */}
              {draft.scope === "build" && (
                <div>
                  <label className={LABEL}>Часть сборки</label>
                  <div className="flex gap-1.5">
                    {[{ k: "all", l: "Вся сборка" }, { k: "hardware", l: "Только железо" }, { k: "assembly", l: "Только работа" }].map(o => (
                      <button key={o.k} type="button" onClick={() => setDraft(d => ({ ...d!, build_part: o.k }))}
                        className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${draft.build_part === o.k ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/40"}`}
                        style={{ cursor: "pointer" }}>{o.l}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Настройки для scope=category */}
              {draft.scope === "category" && (
                <div>
                  <label className={LABEL}>Категории со скидкой</label>
                  <div className="flex flex-wrap gap-1.5">
                    {cats.map(c => (
                      <button key={c.id} type="button"
                        onClick={() => setDraft(d => ({ ...d!, category_ids: toggleId(d!.category_ids || [], c.id) }))}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${(draft.category_ids || []).includes(c.id) ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/40"}`}
                        style={{ cursor: "pointer" }}>{c.name}</button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-foreground/40">Скидка применится только к товарам выбранных категорий в корзине.</p>
                </div>
              )}

              {/* Настройки для scope=product — выбор конкретных товаров/компов */}
              {draft.scope === "product" && (
                <div>
                  <label className={LABEL}>Конкретные товары</label>
                  {/* Выбранные товары */}
                  {(draft.product_ids || []).length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {(draft.product_ids || []).map(id => (
                        <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary">
                          {prodPicked[id]?.name || `#${id}`}
                          <button type="button" onClick={() => setDraft(d => ({ ...d!, product_ids: (d!.product_ids || []).filter(x => x !== id) }))}
                            className="text-primary/70 hover:text-primary" style={{ cursor: "pointer" }}>
                            <Icon name="X" size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Поиск */}
                  <input value={prodQuery} onChange={e => setProdQuery(e.target.value)}
                    className={INPUT} placeholder="Начните вводить название товара…" />
                  {prodResults.length > 0 && (
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-border">
                      {prodResults.map(p => {
                        const picked = (draft.product_ids || []).includes(p.id)
                        return (
                          <button key={p.id} type="button"
                            onClick={() => {
                              setProdPicked(prev => ({ ...prev, [p.id]: { name: p.name, price: p.price } }))
                              setDraft(d => ({ ...d!, product_ids: picked ? (d!.product_ids || []).filter(x => x !== p.id) : [...(d!.product_ids || []), p.id] }))
                            }}
                            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${picked ? "bg-primary/5" : ""}`}
                            style={{ cursor: "pointer" }}>
                            <span>
                              <span className="font-medium text-foreground">{p.name}</span>
                              {p.category && <span className="ml-1 text-foreground/40">· {p.category}</span>}
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span className="text-foreground/50">{fmt(p.price)}</span>
                              {picked && <Icon name="Check" size={13} className="text-primary" />}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <p className="mt-1.5 text-[11px] text-foreground/40">Скидка применится только к выбранным товарам. Если акция публичная — на карточках появится бейдж акции.</p>
                </div>
              )}

              {/* Настройки для scope=combo */}
              {draft.scope === "combo" && (
                <div>
                  <label className={LABEL}>Слоты набора (скидка, если в корзине есть по товару из каждого слота)</label>
                  <div className="space-y-2">
                    {(draft.combo_slots || []).map((slot, idx) => (
                      <div key={idx} className="rounded-lg border border-border p-2">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground/70">Слот {idx + 1}</span>
                          <button type="button" onClick={() => setDraft(d => ({ ...d!, combo_slots: (d!.combo_slots || []).filter((_, i) => i !== idx) }))}
                            className="text-red-400/70 hover:text-red-400" style={{ cursor: "pointer" }}>
                            <Icon name="X" size={14} />
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {cats.map(c => (
                            <button key={c.id} type="button"
                              onClick={() => setDraft(d => {
                                const slots = [...(d!.combo_slots || [])]
                                slots[idx] = { ...slots[idx], category_ids: toggleId(slots[idx].category_ids || [], c.id) }
                                return { ...d!, combo_slots: slots }
                              })}
                              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${(slot.category_ids || []).includes(c.id) ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/50 hover:border-primary/40"}`}
                              style={{ cursor: "pointer" }}>{c.name}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <button type="button"
                      onClick={() => setDraft(d => ({ ...d!, combo_slots: [...(d!.combo_slots || []), { category_ids: [], product_ids: [] }] }))}
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors"
                      style={{ cursor: "pointer" }}>
                      <Icon name="Plus" size={13} />Добавить слот
                    </button>
                  </div>
                </div>
              )}

              {/* Величина скидки */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Тип скидки</label>
                  <div className="flex gap-1.5">
                    {[{ k: "percent", l: "Процент %" }, { k: "amount", l: "Рубли ₽" }].map(o => (
                      <button key={o.k} type="button" onClick={() => setDraft(d => ({ ...d!, discount_type: o.k }))}
                        className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${draft.discount_type === o.k ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/40"}`}
                        style={{ cursor: "pointer" }}>{o.l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Величина {draft.discount_type === "percent" ? "(%)" : "(₽)"}</label>
                  <input type="number" min={0} value={draft.discount_value ?? 0}
                    onChange={e => setDraft(d => ({ ...d!, discount_value: Number(e.target.value) }))}
                    className={INPUT} style={{ cursor: "text" }} />
                </div>
              </div>

              {draft.discount_type === "percent" && (
                <div>
                  <label className={LABEL}>Максимальная скидка в рублях (необязательно)</label>
                  <input type="number" min={0} value={draft.max_discount ?? ""}
                    onChange={e => setDraft(d => ({ ...d!, max_discount: e.target.value ? Number(e.target.value) : null }))}
                    className={INPUT} placeholder="без ограничения" style={{ cursor: "text" }} />
                </div>
              )}

              {/* Лимиты */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Мин. сумма заказа (₽)</label>
                  <input type="number" min={0} value={draft.min_order_amount ?? 0}
                    onChange={e => setDraft(d => ({ ...d!, min_order_amount: Number(e.target.value) }))}
                    className={INPUT} placeholder="0" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className={LABEL}>Лимит активаций</label>
                  <input type="number" min={0} value={draft.max_uses ?? ""}
                    onChange={e => setDraft(d => ({ ...d!, max_uses: e.target.value ? Number(e.target.value) : null }))}
                    className={INPUT} placeholder="без лимита" style={{ cursor: "text" }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Действует с</label>
                  <input type="datetime-local" value={toLocal(draft.starts_at)}
                    onChange={e => setDraft(d => ({ ...d!, starts_at: fromLocal(e.target.value) }))}
                    className={INPUT} style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className={LABEL}>Действует до</label>
                  <input type="datetime-local" value={toLocal(draft.expires_at)}
                    onChange={e => setDraft(d => ({ ...d!, expires_at: fromLocal(e.target.value) }))}
                    className={INPUT} style={{ cursor: "text" }} />
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={!!draft.is_active} onChange={e => setDraft(d => ({ ...d!, is_active: e.target.checked }))} style={{ cursor: "pointer" }} />
                  Активен
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={!!draft.is_public} onChange={e => setDraft(d => ({ ...d!, is_public: e.target.checked }))} style={{ cursor: "pointer" }} />
                  Показывать на сайте (акции)
                </label>
              </div>

              {err && <p className="text-sm text-red-400">{err}</p>}

              <div className="flex gap-2 pt-2">
                <button onClick={save} disabled={saving}
                  className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  style={{ cursor: "pointer" }}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
                <button onClick={() => setDraft(null)}
                  className="rounded-lg border border-border px-4 py-2.5 text-sm text-foreground/60 hover:text-foreground transition-colors"
                  style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}