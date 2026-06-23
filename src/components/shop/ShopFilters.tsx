import { useMemo } from "react"
import Icon from "@/components/ui/icon"
import { attrVisibleForKind, coolerKindFromValue, COOLER_TYPE_CODE } from "@/lib/coolingFilter"

// Характеристика категории (из spec_attributes)
export interface ShopAttr {
  id: number
  code: string
  name: string
  field_type: string
  options: string[]
  unit?: string | null
  affects_compat?: boolean
  sort_order: number
  applies_to?: string  // all | air | liquid (управляющий тип охлаждения)
}

// Товар с характеристиками и брендом (из specSlotProducts)
export interface ShopSpecProduct {
  id: number
  name: string
  price: number
  image_url?: string | null
  image_urls?: string[]
  in_stock?: boolean
  description?: string
  brand?: string | null
  values: Record<string, string | string[]>
}

export interface ShopFilterState {
  onlyStock: boolean
  priceMin: string
  priceMax: string
  brands: Set<string>
  attrs: Record<number, Set<string>>
}

export const emptyFilterState = (): ShopFilterState => ({
  onlyStock: false, priceMin: "", priceMax: "", brands: new Set(), attrs: {},
})

// Применяет фильтры к списку товаров
export function applyShopFilters(products: ShopSpecProduct[], f: ShopFilterState): ShopSpecProduct[] {
  const pmin = f.priceMin ? parseFloat(f.priceMin) : null
  const pmax = f.priceMax ? parseFloat(f.priceMax) : null
  return products.filter(p => {
    if (f.onlyStock && !p.in_stock) return false
    if (pmin !== null && p.price < pmin) return false
    if (pmax !== null && p.price > pmax) return false
    if (f.brands.size > 0 && !(p.brand && f.brands.has(p.brand))) return false
    for (const [aid, set] of Object.entries(f.attrs)) {
      if (set.size === 0) continue
      const v = p.values[String(aid)]
      const vals = Array.isArray(v) ? v.map(String) : [String(v)]
      if (!vals.some(x => set.has(x))) return false
    }
    return true
  })
}

interface Props {
  attributes: ShopAttr[]        // характеристики категории (пусто — когда категория не выбрана)
  products: ShopSpecProduct[]   // товары категории (для построения списков значений/брендов)
  state: ShopFilterState
  setState: (updater: (s: ShopFilterState) => ShopFilterState) => void
  openAttr: Record<number | string, boolean>
  setOpenAttr: (updater: (o: Record<number | string, boolean>) => Record<number | string, boolean>) => void
}

export default function ShopFilters({ attributes, products, state, setState, openAttr, setOpenAttr }: Props) {
  // Выбранный в фильтре тип охлаждения (cooler_type) → подтип air/liquid.
  // Если в фильтре отмечен ровно один тип — прячем характеристики чужого типа.
  const coolingKind = useMemo(() => {
    const typeA = attributes.find(a => a.code === COOLER_TYPE_CODE)
    if (!typeA) return null
    const sel = state.attrs[typeA.id]
    if (!sel || sel.size !== 1) return null
    return coolerKindFromValue(Array.from(sel)[0])
  }, [attributes, state.attrs])

  // Фильтруемые характеристики — только select/multiselect, у которых есть заполненные значения
  const filterableAttrs = useMemo(() =>
    attributes
      .filter(a => (a.field_type === "select" || a.field_type === "multiselect"))
      // скрываем характеристики чужого подтипа охлаждения, когда тип выбран
      .filter(a => coolingKind === null ? true : attrVisibleForKind(a, coolingKind))
      .filter(a => products.some(p => {
        const v = p.values[String(a.id)]
        return v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0)
      }))
      .sort((a, b) => a.sort_order - b.sort_order),
  [attributes, products, coolingKind])

  const attrValues = useMemo(() => {
    const m: Record<number, string[]> = {}
    filterableAttrs.forEach(a => {
      const set = new Set<string>()
      products.forEach(p => {
        const v = p.values[String(a.id)]
        if (Array.isArray(v)) v.forEach(x => set.add(String(x)))
        else if (v !== undefined && v !== null && String(v).length) set.add(String(v))
      })
      m[a.id] = Array.from(set).sort()
    })
    return m
  }, [filterableAttrs, products])

  // Атрибут «Тип» — выносим над брендами и открываем по умолчанию
  const typeAttr = useMemo(
    () => filterableAttrs.find(a => a.name.trim().toLowerCase() === "тип") || null,
    [filterableAttrs])
  const restAttrs = useMemo(
    () => filterableAttrs.filter(a => a.id !== typeAttr?.id),
    [filterableAttrs, typeAttr])

  const brandList = useMemo(() => {
    const s = new Set<string>()
    products.forEach(p => { if (p.brand) s.add(p.brand) })
    return Array.from(s).sort()
  }, [products])

  const toggleBrand = (b: string) => setState(s => {
    const next = new Set(s.brands)
    if (next.has(b)) next.delete(b); else next.add(b)
    return { ...s, brands: next }
  })
  const toggleAttr = (aid: number, val: string) => setState(s => {
    const cur = new Set(s.attrs[aid] || [])
    if (cur.has(val)) cur.delete(val); else cur.add(val)
    return { ...s, attrs: { ...s.attrs, [aid]: cur } }
  })
  const reset = () => setState(() => emptyFilterState())

  const hasActive = state.onlyStock || state.priceMin || state.priceMax || state.brands.size > 0
    || Object.values(state.attrs).some(s => s.size > 0)

  // Рендер одного блока-характеристики. defaultOpen — раскрыт, пока пользователь
  // явно не свернул (когда openAttr[id] ещё undefined).
  const renderAttr = (a: ShopAttr, defaultOpen = false) => {
    const isOpen = openAttr[a.id] === undefined ? defaultOpen : openAttr[a.id]
    return (
      <div key={a.id} className="border-t border-border py-2">
        <button onClick={() => setOpenAttr(o => ({ ...o, [a.id]: !(o[a.id] === undefined ? defaultOpen : o[a.id]) }))}
          className="flex w-full items-center justify-between text-sm font-medium text-foreground/80" style={{ cursor: "pointer" }}>
          <span>{a.name}{state.attrs[a.id]?.size ? ` (${state.attrs[a.id].size})` : ""}</span>
          <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={14} className="text-foreground/40" />
        </button>
        {isOpen && (
          <div className="mt-2 space-y-1">
            {attrValues[a.id]?.map(val => (
              <label key={val} className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={state.attrs[a.id]?.has(val) || false} onChange={() => toggleAttr(a.id, val)} style={{ cursor: "pointer" }} />
                {val}{a.unit ? ` ${a.unit}` : ""}
              </label>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="w-full shrink-0 sm:w-60">
      <div className="rounded-xl border border-border bg-card p-4">
        <button onClick={() => setState(s => ({ ...s, onlyStock: !s.onlyStock }))}
          className={`mb-3 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${state.onlyStock ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70"}`}
          style={{ cursor: "pointer" }}>
          <Icon name={state.onlyStock ? "CheckSquare" : "Square"} size={15} />
          В наличии
        </button>

        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold text-foreground/60">Цена, ₽</p>
          <div className="flex gap-2">
            <input value={state.priceMin} onChange={e => setState(s => ({ ...s, priceMin: e.target.value }))} placeholder="от" inputMode="numeric"
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
            <input value={state.priceMax} onChange={e => setState(s => ({ ...s, priceMax: e.target.value }))} placeholder="до" inputMode="numeric"
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
          </div>
        </div>

        {typeAttr && renderAttr(typeAttr, true)}

        {brandList.length > 0 && (
          <div className="border-t border-border py-2">
            <button onClick={() => setOpenAttr(o => ({ ...o, brand: !o.brand }))}
              className="flex w-full items-center justify-between text-sm font-medium text-foreground/80" style={{ cursor: "pointer" }}>
              <span>Бренд{state.brands.size > 0 ? ` (${state.brands.size})` : ""}</span>
              <Icon name={openAttr.brand ? "ChevronUp" : "ChevronDown"} size={14} className="text-foreground/40" />
            </button>
            {openAttr.brand && (
              <div className="mt-2 space-y-1">
                {brandList.map(b => (
                  <label key={b} className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={state.brands.has(b)} onChange={() => toggleBrand(b)} style={{ cursor: "pointer" }} />
                    {b}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {restAttrs.map(a => renderAttr(a))}

        {hasActive && (
          <button onClick={reset}
            className="mt-3 w-full rounded-lg border border-border py-2 text-sm text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>
            Сбросить фильтры
          </button>
        )}
      </div>
    </aside>
  )
}