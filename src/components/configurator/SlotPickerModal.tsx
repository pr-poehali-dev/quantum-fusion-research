import { useState, useEffect, useMemo } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

// ── Типы данных из бэкенда ────────────────────────────────────────────────────
interface SpecAttr {
  id: number
  code: string
  name: string
  field_type: string
  options: string[]
  unit?: string | null
  affects_compat: boolean
  is_required: boolean
  sort_order: number
}
interface SlotProduct {
  id: number
  name: string
  price: number
  image_url?: string | null
  image_urls?: string[]
  in_stock?: boolean
  stock_qty?: number
  description?: string
  values: Record<string, string | string[]>
}
interface SpecLink {
  id: number
  name?: string
  from_attribute_id: number
  to_attribute_id: number
  rule: string
  note?: string
  is_active: boolean
}
interface SchemaAttr { id: number; category_id: number; code: string; name: string }

// Что уже выбрано в других слотах: значения характеристик по spec-категориям.
// slotValues = { [specCategoryId]: { [attributeId]: value } }
export interface SelectedSpecValues {
  [specCategoryId: number]: Record<string, string | string[]>
}

interface Props {
  slotCode: string          // код spec-категории, напр. "motherboard"
  slotLabel: string         // "Материнская плата"
  selectedSpec: SelectedSpecValues  // значения уже выбранных деталей (для совместимости)
  onPick: (p: SlotProduct, specCategoryId: number) => void
  onClose: () => void
  onCustom?: () => void     // «Моё железо» — ручной ввод
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

// Проверка одного правила связи между значением выбранной детали и кандидата.
function ruleHolds(rule: string, fromVal: unknown, toVal: unknown): boolean {
  const norm = (v: unknown) => Array.isArray(v) ? v.map(x => String(x).trim().toLowerCase()) : String(v ?? "").trim().toLowerCase()
  const num = (v: unknown) => parseFloat(String(v).replace(",", "."))
  switch (rule) {
    case "eq":
      return norm(fromVal) === norm(toVal)
    case "lte":
      return num(fromVal) <= num(toVal)
    case "gte":
      return num(fromVal) >= num(toVal)
    case "contains": {
      const arr = Array.isArray(toVal) ? toVal.map(x => String(x).trim().toLowerCase())
        : Array.isArray(fromVal) ? fromVal.map(x => String(x).trim().toLowerCase()) : []
      const needle = Array.isArray(toVal) ? String(fromVal).trim().toLowerCase() : String(toVal).trim().toLowerCase()
      return arr.includes(needle)
    }
    default:
      return true
  }
}

export default function SlotPickerModal({ slotCode, slotLabel, selectedSpec, onPick, onClose, onCustom }: Props) {
  const [attributes, setAttributes] = useState<SpecAttr[]>([])
  const [products, setProducts] = useState<SlotProduct[]>([])
  const [specCategoryId, setSpecCategoryId] = useState<number>(0)
  const [links, setLinks] = useState<SpecLink[]>([])
  const [schemaAttrs, setSchemaAttrs] = useState<SchemaAttr[]>([])
  const [loading, setLoading] = useState(true)

  // Состояние фильтров
  const [search, setSearch] = useState("")
  const [onlyCompatible, setOnlyCompatible] = useState(true)
  const [onlyStock, setOnlyStock] = useState(false)
  const [priceMin, setPriceMin] = useState("")
  const [priceMax, setPriceMax] = useState("")
  const [attrFilters, setAttrFilters] = useState<Record<number, Set<string>>>({})
  const [openAttr, setOpenAttr] = useState<Record<number, boolean>>({})

  useEffect(() => {
    setLoading(true)
    Promise.all([api.warehouse.specSlotProducts(slotCode), api.warehouse.specSchema()])
      .then(([slotData, schema]) => {
        setAttributes(slotData.attributes || [])
        setProducts(slotData.products || [])
        setSpecCategoryId(slotData.spec_category_id || 0)
        setLinks((schema.links || []).filter((l: SpecLink) => l.is_active))
        setSchemaAttrs(schema.attributes || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slotCode])

  // attribute_id -> category_id (из общей схемы)
  const attrCat = useMemo(() => {
    const m: Record<number, number> = {}
    schemaAttrs.forEach(a => { m[a.id] = a.category_id })
    return m
  }, [schemaAttrs])

  // Какие характеристики показывать как фильтры — те, что реально заполнены у товаров
  const filterableAttrs = useMemo(() => {
    return attributes.filter(a => {
      if (a.field_type === "number" || a.field_type === "bool" || a.field_type === "text") return false
      return products.some(p => {
        const v = p.values[String(a.id)]
        return v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0)
      })
    })
  }, [attributes, products])

  // Уникальные значения по каждому фильтр-атрибуту
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

  // Проверка совместимости одного кандидата с уже выбранными деталями.
  // Возвращает null если совместим, или строку-причину если нет.
  const incompatReason = (p: SlotProduct): string | null => {
    for (const link of links) {
      const fromCat = attrCat[link.from_attribute_id]
      const toCat = attrCat[link.to_attribute_id]
      // Правило касается нашего слота, если один из атрибутов принадлежит нашей категории
      const meIsFrom = fromCat === specCategoryId
      const meIsTo = toCat === specCategoryId
      if (!meIsFrom && !meIsTo) continue

      const myAttrId = meIsFrom ? link.from_attribute_id : link.to_attribute_id
      const otherAttrId = meIsFrom ? link.to_attribute_id : link.from_attribute_id
      const otherCat = meIsFrom ? toCat : fromCat

      const myVal = p.values[String(myAttrId)]
      const otherVals = selectedSpec[otherCat]
      if (otherVals === undefined) continue           // эта деталь ещё не выбрана
      const otherVal = otherVals[String(otherAttrId)]
      if (myVal === undefined || otherVal === undefined) continue  // нет данных — не блокируем

      // ruleHolds ожидает (from, to) в порядке правила
      const fromVal = meIsFrom ? myVal : otherVal
      const toVal = meIsFrom ? otherVal : myVal
      if (!ruleHolds(link.rule, fromVal, toVal)) {
        const myAttr = attributes.find(a => a.id === myAttrId)
        return link.note || `Не подходит по «${myAttr?.name || "характеристике"}»`
      }
    }
    return null
  }

  // Применяем все фильтры
  const filtered = useMemo(() => {
    const pmin = priceMin ? parseFloat(priceMin) : null
    const pmax = priceMax ? parseFloat(priceMax) : null
    return products
      .map(p => ({ p, reason: incompatReason(p) }))
      .filter(({ p }) => {
        if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
        if (onlyStock && !p.in_stock) return false
        if (pmin !== null && p.price < pmin) return false
        if (pmax !== null && p.price > pmax) return false
        for (const [aid, set] of Object.entries(attrFilters)) {
          if (set.size === 0) continue
          const v = p.values[String(aid)]
          const vals = Array.isArray(v) ? v.map(String) : [String(v)]
          if (!vals.some(x => set.has(x))) return false
        }
        return true
      })
      .sort((a, b) => {
        // совместимые сверху, дальше по цене
        if (!!a.reason !== !!b.reason) return a.reason ? 1 : -1
        return a.p.price - b.p.price
      })
  }, [products, search, onlyStock, priceMin, priceMax, attrFilters, links, selectedSpec, attributes]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = onlyCompatible ? filtered.filter(f => !f.reason) : filtered
  const compatCount = filtered.filter(f => !f.reason).length

  const toggleAttrFilter = (aid: number, val: string) => {
    setAttrFilters(prev => {
      const next = { ...prev }
      const set = new Set(next[aid] || [])
      if (set.has(val)) set.delete(val); else set.add(val)
      next[aid] = set
      return next
    })
  }
  const resetFilters = () => {
    setSearch(""); setOnlyStock(false); setPriceMin(""); setPriceMax(""); setAttrFilters({})
  }

  const hasSelection = Object.keys(selectedSpec).length > 0

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={onClose}>
      <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-foreground">Выбор: {slotLabel}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">{visible.length}</span>
          </div>
          <div className="flex items-center gap-2">
            {onCustom && (
              <button onClick={onCustom}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-primary transition-colors"
                style={{ cursor: "pointer" }} title="Совместимость не гарантируется — менеджер уточнит перед заказом">
                <Icon name="Wrench" size={13} /> Моё железо
              </button>
            )}
            <button onClick={onClose} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
              <Icon name="X" size={20} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Фильтры слева */}
          <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-border p-4 sm:block">
            <div className="relative mb-3">
              <Icon name="Search" size={14} className="absolute left-2.5 top-2.5 text-foreground/30" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по названию"
                className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-2 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
            </div>

            {hasSelection && (
              <button onClick={() => setOnlyCompatible(v => !v)}
                className={`mb-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${onlyCompatible ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70"}`}
                style={{ cursor: "pointer" }}>
                <Icon name={onlyCompatible ? "CheckSquare" : "Square"} size={15} />
                Совместимые товары ({compatCount})
              </button>
            )}
            <button onClick={() => setOnlyStock(v => !v)}
              className={`mb-3 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${onlyStock ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70"}`}
              style={{ cursor: "pointer" }}>
              <Icon name={onlyStock ? "CheckSquare" : "Square"} size={15} />
              В наличии
            </button>

            <div className="mb-3">
              <p className="mb-1.5 text-xs font-semibold text-foreground/60">Цена, ₽</p>
              <div className="flex gap-2">
                <input value={priceMin} onChange={e => setPriceMin(e.target.value)} placeholder="от" inputMode="numeric"
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
                <input value={priceMax} onChange={e => setPriceMax(e.target.value)} placeholder="до" inputMode="numeric"
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
              </div>
            </div>

            {filterableAttrs.map(a => (
              <div key={a.id} className="border-t border-border py-2">
                <button onClick={() => setOpenAttr(o => ({ ...o, [a.id]: !o[a.id] }))}
                  className="flex w-full items-center justify-between text-sm font-medium text-foreground/80" style={{ cursor: "pointer" }}>
                  <span className="flex items-center gap-1">
                    {a.name}
                    {a.affects_compat && <Icon name="Link2" size={11} className="text-primary/60" />}
                  </span>
                  <Icon name={openAttr[a.id] ? "ChevronUp" : "ChevronDown"} size={14} className="text-foreground/40" />
                </button>
                {openAttr[a.id] && (
                  <div className="mt-2 space-y-1">
                    {attrValues[a.id]?.map(val => (
                      <label key={val} className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                        <input type="checkbox" checked={attrFilters[a.id]?.has(val) || false}
                          onChange={() => toggleAttrFilter(a.id, val)} style={{ cursor: "pointer" }} />
                        {val}{a.unit ? ` ${a.unit}` : ""}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <button onClick={resetFilters}
              className="mt-3 w-full rounded-lg border border-border py-2 text-sm text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>
              Сбросить фильтры
            </button>
          </aside>

          {/* Список товаров */}
          <main className="min-w-0 flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-foreground/40">
                <Icon name="SearchX" size={32} />
                <p className="text-sm">Ничего не найдено</p>
                {onlyCompatible && hasSelection && (
                  <button onClick={() => setOnlyCompatible(false)} className="text-sm text-primary" style={{ cursor: "pointer" }}>
                    Показать несовместимые
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {visible.map(({ p, reason }) => (
                  <div key={p.id}
                    className={`flex items-center gap-3 rounded-xl border bg-card p-3 transition-all ${reason ? "border-border opacity-50" : "border-border hover:border-primary/50"}`}>
                    <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {(p.image_url || p.image_urls?.[0]) ? (
                        <img src={p.image_url || p.image_urls?.[0]} alt={p.name} className="h-full w-full object-contain" />
                      ) : <Icon name="Image" size={32} className="text-foreground/20" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground line-clamp-2">{p.name}</p>
                      <div className="mt-1 flex items-center gap-2">
                        {p.in_stock
                          ? <span className="text-xs text-green-500">В наличии</span>
                          : <span className="text-xs text-foreground/40">Под заказ</span>}
                        {reason && (
                          <span className="flex items-center gap-1 text-xs text-orange-500">
                            <Icon name="TriangleAlert" size={11} /> {reason}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-sm font-bold text-foreground">{fmt(p.price)}</span>
                      <button onClick={() => onPick(p, specCategoryId)}
                        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                        style={{ cursor: "pointer" }}>
                        Выбрать
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}