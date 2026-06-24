import { useState, useEffect, useMemo } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { coolerKindFromValue, COOLER_TYPE_CODE } from "@/lib/coolingFilter"

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
  applies_to?: string  // all | air | liquid
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
  margin?: number
  brand?: string | null
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

export interface CustomItemInput {
  name: string
  price: number
  link?: string
}

interface Props {
  slotCode: string          // код spec-категории, напр. "motherboard"
  slotLabel: string         // "Материнская плата"
  selectedSpec: SelectedSpecValues  // значения уже выбранных деталей (для совместимости)
  selectedQty?: Record<number, number>  // кол-во выбранных деталей по spec-категориям (для расчёта БП)
  onPick: (p: SlotProduct, specCategoryId: number) => void
  onClose: () => void
  onCustomAdd?: (item: CustomItemInput) => void  // «Моё железо» — ручной ввод
  startCustom?: boolean       // сразу открыть форму ручного ввода (для «Прочее»)
  hideCatalogToggle?: boolean // скрыть переключение к каталогу (только ручной ввод)
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

export default function SlotPickerModal({ slotCode, slotLabel, selectedSpec, selectedQty, onPick, onClose, onCustomAdd, startCustom, hideCatalogToggle }: Props) {
  const [attributes, setAttributes] = useState<SpecAttr[]>([])
  const [products, setProducts] = useState<SlotProduct[]>([])
  const [specCategoryId, setSpecCategoryId] = useState<number>(0)
  const [links, setLinks] = useState<SpecLink[]>([])
  const [schemaAttrs, setSchemaAttrs] = useState<SchemaAttr[]>([])
  const [specCategories, setSpecCategories] = useState<{ id: number; code: string }[]>([])
  const [loading, setLoading] = useState(true)

  // Состояние фильтров
  const [search, setSearch] = useState("")
  const [onlyCompatible, setOnlyCompatible] = useState(true)
  const [onlyStock, setOnlyStock] = useState(false)       // «В наличии» — фильтр, выкл по умолчанию (наличие приоритетно в сортировке)
  const [recommended, setRecommended] = useState(false)   // «Рекомендуемые» — выкл по умолчанию
  const [priceMin, setPriceMin] = useState("")
  const [priceMax, setPriceMax] = useState("")
  const [brandFilter, setBrandFilter] = useState<Set<string>>(new Set())
  const [brandOpen, setBrandOpen] = useState(false)
  const [attrFilters, setAttrFilters] = useState<Record<number, Set<string>>>({})
  const [openAttr, setOpenAttr] = useState<Record<number, boolean>>({})
  // Показ панели фильтров на телефоне (на десктопе она видна всегда).
  // По умолчанию свёрнута — пользователь раскрывает кнопкой «Фильтры».
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  // Режим ручного ввода («Моё железо»)
  const [customMode, setCustomMode] = useState(!!startCustom)
  const [cName, setCName] = useState("")
  const [cPrice, setCPrice] = useState("")
  const [cLink, setCLink] = useState("")
  const submitCustom = () => {
    if (!cName.trim() || !cPrice) return
    onCustomAdd?.({ name: cName.trim(), price: parseFloat(cPrice) || 0, link: cLink.trim() || undefined })
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([api.warehouse.specSlotProducts(slotCode), api.warehouse.specSchema()])
      .then(([slotData, schema]) => {
        setAttributes(slotData.attributes || [])
        setProducts(slotData.products || [])
        setSpecCategoryId(slotData.spec_category_id || 0)
        setLinks((schema.links || []).filter((l: SpecLink) => l.is_active))
        setSchemaAttrs(schema.attributes || [])
        setSpecCategories(schema.categories || [])
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
  // Выбранный в фильтре тип охлаждения → подтип (для скрытия чужих характеристик)
  const coolingKind = useMemo(() => {
    const typeA = attributes.find(a => a.code === COOLER_TYPE_CODE)
    if (!typeA) return null
    const sel = attrFilters[typeA.id]
    if (!sel || sel.size !== 1) return null
    return coolerKindFromValue(Array.from(sel)[0])
  }, [attributes, attrFilters])

  const filterableAttrs = useMemo(() => {
    return attributes.filter(a => {
      if (a.field_type === "number" || a.field_type === "bool" || a.field_type === "text") return false
      // скрываем характеристики чужого подтипа охлаждения, когда тип выбран
      if (coolingKind !== null && (a.applies_to === "air" || a.applies_to === "liquid") && a.applies_to !== coolingKind) return false
      return products.some(p => {
        const v = p.values[String(a.id)]
        return v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : String(v).length > 0)
      })
    })
  }, [attributes, products, coolingKind])

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

      // Если мой атрибут ограничен подтипом охлаждения (air/liquid), а кандидат
      // другого типа — правило к нему не относится (напр. высота кулера у СЖО).
      const myAttrDef = attributes.find(a => a.id === myAttrId)
      const applies = myAttrDef?.applies_to
      if (applies === "air" || applies === "liquid") {
        const typeAttr = attributes.find(a => a.code === COOLER_TYPE_CODE)
        const kind = typeAttr ? coolerKindFromValue(p.values[String(typeAttr.id)]) : null
        if (kind && kind !== applies) continue
      }

      const myVal = p.values[String(myAttrId)]
      const otherVals = selectedSpec[otherCat]
      if (otherVals === undefined) continue           // эта деталь ещё не выбрана
      const otherVal = otherVals[String(otherAttrId)]

      const isEmpty = (v: unknown) => v === undefined || v === null
        || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "")

      // Для точных правил (eq/contains — сокет, тип памяти, форм-фактор):
      // если у выбранной детали значение есть, а у кандидата нет — считаем
      // НЕСОВМЕСТИМЫМ (нельзя гарантировать совпадение без данных).
      if (link.rule === "eq" || link.rule === "contains") {
        if (isEmpty(otherVal)) continue               // у выбранной детали нет данных — не блокируем
        if (isEmpty(myVal)) {
          const myAttr = attributes.find(a => a.id === myAttrId)
          return `Не указана характеристика «${myAttr?.name || "?"}»`
        }
      } else {
        // Числовые габаритные правила (lte/gte) — без данных не блокируем
        if (isEmpty(myVal) || isEmpty(otherVal)) continue
      }

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

  // ── Рекомендация мощности БП (только для слота psu) ──
  // Считаем TDP процессора + видеокарты из уже выбранных деталей,
  // накидываем фиксированный запас 300 Вт и округляем вверх до номинала.
  const psuAdvice = useMemo(() => {
    if (slotCode !== "psu") return null
    const tdpAttrs = schemaAttrs.filter(a => a.code === "tdp_watt")
    // watt — потребление одной детали, total — с учётом её количества (qty)
    const parts: { catCode: string; watt: number; qty: number; total: number }[] = []
    tdpAttrs.forEach(a => {
      const vals = selectedSpec[a.category_id]
      if (!vals) return
      const raw = vals[String(a.id)]
      const w = parseFloat(String(Array.isArray(raw) ? raw[0] : raw).replace(",", "."))
      if (Number.isNaN(w) || w <= 0) return
      const catCode = specCategories.find(c => c.id === a.category_id)?.code || ""
      const qty = Math.max(1, selectedQty?.[a.category_id] || 1)
      parts.push({ catCode, watt: w, qty, total: w * qty })
    })
    const totalTdp = parts.reduce((s, p) => s + p.total, 0)
    if (totalTdp <= 0) return null
    const cpu = parts.find(p => p.catCode === "cpu")
    const gpu = parts.find(p => p.catCode === "gpu")
    const RESERVE = 300
    const needed = totalTdp + RESERVE
    const NOMINALS = [450, 550, 650, 750, 850, 1000, 1200, 1300, 1500, 1600]
    const recommended = NOMINALS.find(n => n >= needed) || Math.ceil(needed / 100) * 100
    return {
      totalTdp, reserve: RESERVE, needed, recommended,
      cpuW: cpu?.watt || 0, cpuQty: cpu?.qty || 1,
      gpuW: gpu?.watt || 0, gpuQty: gpu?.qty || 1,
    }
  }, [slotCode, schemaAttrs, selectedSpec, specCategories, selectedQty])

  // id атрибута мощности БП (watt) — для проверки достаточности
  const psuWattAttrId = useMemo(
    () => attributes.find(a => a.code === "watt")?.id ?? null,
    [attributes]
  )

  // Мягкое предупреждение по БП (НЕ влияет на совместимость) — если мощность
  // ниже рекомендуемой с запасом. Просто дружелюбный совет жёлтым.
  const psuWarn = (p: SlotProduct): string | null => {
    if (slotCode !== "psu" || !psuAdvice || psuWattAttrId === null) return null
    const raw = p.values[String(psuWattAttrId)]
    const w = parseFloat(String(Array.isArray(raw) ? raw[0] : raw).replace(",", "."))
    if (Number.isNaN(w) || w <= 0) return null
    // Ниже минимально нужного (TDP+запас) — мягкий совет
    if (w < psuAdvice.needed) {
      return `${w} Вт — почти без запаса. Подойдёт, но под нагрузкой может быть чуть шумнее. Комфортнее от ${psuAdvice.recommended} Вт.`
    }
    return null
  }

  // Применяем все фильтры
  // Порог «рекомендуемых» — медиана маржи по товарам слота
  const marginThreshold = useMemo(() => {
    const margins = products.map(p => p.margin || 0).filter(m => m > 0).sort((a, b) => a - b)
    if (margins.length === 0) return 0
    return margins[Math.floor(margins.length / 2)]
  }, [products])

  const filtered = useMemo(() => {
    const pmin = priceMin ? parseFloat(priceMin) : null
    const pmax = priceMax ? parseFloat(priceMax) : null
    return products
      .map(p => ({ p, reason: incompatReason(p), warn: psuWarn(p) }))
      .filter(({ p }) => {
        if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
        if (onlyStock && !p.in_stock) return false
        if (recommended && (p.margin || 0) < marginThreshold) return false
        if (pmin !== null && p.price < pmin) return false
        if (pmax !== null && p.price > pmax) return false
        if (brandFilter.size > 0 && !(p.brand && brandFilter.has(p.brand))) return false
        for (const [aid, set] of Object.entries(attrFilters)) {
          if (set.size === 0) continue
          const v = p.values[String(aid)]
          const vals = Array.isArray(v) ? v.map(String) : [String(v)]
          if (!vals.some(x => set.has(x))) return false
        }
        return true
      })
      .sort((a, b) => {
        // совместимые сверху
        if (!!a.reason !== !!b.reason) return a.reason ? 1 : -1
        // затем приоритет наличия (в наличии — выше)
        if (!!a.p.in_stock !== !!b.p.in_stock) return a.p.in_stock ? -1 : 1
        // затем скрытая сортировка по марже (макс → мин)
        const dm = (b.p.margin || 0) - (a.p.margin || 0)
        if (dm !== 0) return dm
        return a.p.price - b.p.price
      })
  }, [products, search, onlyStock, recommended, marginThreshold, priceMin, priceMax, brandFilter, attrFilters, links, selectedSpec, attributes, psuAdvice, psuWattAttrId]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = onlyCompatible ? filtered.filter(f => !f.reason) : filtered
  const compatCount = filtered.filter(f => !f.reason).length

  // Список брендов, встречающихся среди товаров слота
  const availableBrands = useMemo(() => {
    const s = new Set<string>()
    products.forEach(p => { if (p.brand) s.add(p.brand) })
    return Array.from(s).sort()
  }, [products])

  const toggleBrand = (b: string) => {
    setBrandFilter(prev => {
      const next = new Set(prev)
      if (next.has(b)) next.delete(b); else next.add(b)
      return next
    })
  }

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
    setSearch(""); setOnlyStock(false); setRecommended(false); setPriceMin(""); setPriceMax(""); setBrandFilter(new Set()); setAttrFilters({})
  }

  const hasSelection = Object.keys(selectedSpec).length > 0

  // Главные характеристики товара (влияющие на совместимость, заполненные) —
  // показываем серым под названием: «Сокет: AM5», «TDP макс: 300 Вт» и т.д.
  const keySpecs = (p: SlotProduct): string[] => {
    return attributes
      .filter(a => a.affects_compat)
      .map(a => {
        const v = p.values[String(a.id)]
        if (v === undefined || v === null) return null
        const text = Array.isArray(v) ? v.join(", ") : String(v)
        if (!text.trim()) return null
        return `${a.name}: ${text}${a.unit ? ` ${a.unit}` : ""}`
      })
      .filter((x): x is string => !!x)
      .slice(0, 4)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={onClose}>
      <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-foreground">
              {customMode ? "Своя позиция" : `Выбор: ${slotLabel}`}
            </h3>
            {!customMode && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">{visible.length}</span>}
          </div>
          <div className="flex items-center gap-2">
            {!customMode && (
              <button onClick={() => setMobileFiltersOpen(v => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors sm:hidden ${mobileFiltersOpen ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary hover:text-primary"}`}
                style={{ cursor: "pointer" }}>
                <Icon name="SlidersHorizontal" size={13} /> Фильтры
              </button>
            )}
            {onCustomAdd && !hideCatalogToggle && (
              <button onClick={() => setCustomMode(v => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${customMode ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary hover:text-primary"}`}
                style={{ cursor: "pointer" }} title="Совместимость не гарантируется — менеджер уточнит перед заказом">
                <Icon name={customMode ? "ArrowLeft" : "Wrench"} size={13} /> {customMode ? "К каталогу" : "Моё железо"}
              </button>
            )}
            <button onClick={onClose} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
              <Icon name="X" size={20} />
            </button>
          </div>
        </div>

        {/* ── Подсказка по мощности БП ── */}
        {!customMode && psuAdvice && (
          <div className="flex items-start gap-2.5 border-b border-border bg-primary/5 px-5 py-3 text-sm">
            <Icon name="Zap" size={16} className="mt-0.5 shrink-0 text-primary" />
            <div className="text-foreground/80">
              {psuAdvice.cpuW > 0 && psuAdvice.gpuW > 0 ? (
                <>Процессор ({psuAdvice.cpuW} Вт) + {psuAdvice.gpuQty > 1 ? `${psuAdvice.gpuQty} видеокарты` : "видеокарта"} ({psuAdvice.gpuW} Вт{psuAdvice.gpuQty > 1 ? ` × ${psuAdvice.gpuQty}` : ""}) потребляют <b className="text-foreground">{psuAdvice.totalTdp} Вт</b>. </>
              ) : (
                <>Выбранные компоненты потребляют <b className="text-foreground">{psuAdvice.totalTdp} Вт</b>. </>
              )}
              Накидываем {psuAdvice.reserve} Вт запаса → нужен БП от <b className="text-foreground">{psuAdvice.needed} Вт</b>.{" "}
              <span className="font-semibold text-primary">Рекомендуем {psuAdvice.recommended} Вт{psuAdvice.recommended >= 1000 ? ` (${(psuAdvice.recommended / 1000).toString().replace(".", ",")} кВт)` : ""}.</span>
            </div>
          </div>
        )}

        {customMode ? (
          /* ── Ручной ввод своей позиции ── */
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-md space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <Icon name="Info" size={15} className="mt-0.5 shrink-0" />
                <span>Совместимость своей позиции мы не гарантируем — менеджер уточнит её перед заказом.</span>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground/80">Название</label>
                <input value={cName} onChange={e => setCName(e.target.value)}
                  placeholder="Напр. ASUS ROG STRIX B650-A"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground/80">Цена, ₽</label>
                <input value={cPrice} onChange={e => setCPrice(e.target.value)} inputMode="numeric" placeholder="0"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground/80">Ссылка на товар (необязательно)</label>
                <input value={cLink} onChange={e => setCLink(e.target.value)} placeholder="https://..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
              </div>
              <button onClick={submitCustom} disabled={!cName.trim() || !cPrice}
                className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                style={{ cursor: cName.trim() && cPrice ? "pointer" : "not-allowed" }}>
                Добавить позицию
              </button>
            </div>
          </div>
        ) : (
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Фильтры: слева на десктопе; на телефоне — раскрываются кнопкой «Фильтры».
              На телефоне панель занимает всю ширину и ограничена по высоте, чтобы
              не выталкивать список товаров. */}
          <aside className={`${mobileFiltersOpen ? "block max-h-[45vh] border-b" : "hidden"} w-full shrink-0 overflow-y-auto border-border p-4 sm:block sm:max-h-none sm:w-64 sm:border-b-0 sm:border-r`}>
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
            <button onClick={() => setRecommended(v => !v)}
              className={`mb-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${recommended ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70"}`}
              style={{ cursor: "pointer" }}>
              <Icon name={recommended ? "CheckSquare" : "Square"} size={15} />
              Рекомендуемые
            </button>
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

            {availableBrands.length > 0 && (
              <div className="border-t border-border py-2">
                <button onClick={() => setBrandOpen(o => !o)}
                  className="flex w-full items-center justify-between text-sm font-medium text-foreground/80" style={{ cursor: "pointer" }}>
                  <span>Бренд{brandFilter.size > 0 ? ` (${brandFilter.size})` : ""}</span>
                  <Icon name={brandOpen ? "ChevronUp" : "ChevronDown"} size={14} className="text-foreground/40" />
                </button>
                {brandOpen && (
                  <div className="mt-2 space-y-1">
                    {availableBrands.map(b => (
                      <label key={b} className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                        <input type="checkbox" checked={brandFilter.has(b)} onChange={() => toggleBrand(b)} style={{ cursor: "pointer" }} />
                        {b}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

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
                {visible.map(({ p, reason, warn }) => (
                  <div key={p.id}
                    className={`flex items-center gap-3 rounded-xl border bg-card p-3 transition-all ${reason ? "border-border opacity-50" : warn ? "border-amber-400/50 hover:border-amber-400" : "border-border hover:border-primary/50"}`}>
                    <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {(p.image_url || p.image_urls?.[0]) ? (
                        <img src={p.image_url || p.image_urls?.[0]} alt={p.name} className="h-full w-full object-contain" />
                      ) : <Icon name="Image" size={32} className="text-foreground/20" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      {p.brand && <p className="text-xs font-semibold uppercase tracking-wide text-primary/70">{p.brand}</p>}
                      <p className="text-sm font-medium text-foreground line-clamp-2">{p.name}</p>
                      {keySpecs(p).length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {keySpecs(p).map((s, i) => (
                            <p key={i} className="text-xs leading-tight text-foreground/45">{s}</p>
                          ))}
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center gap-2">
                        {p.in_stock
                          ? <span className="text-xs text-green-500">В наличии</span>
                          : <span className="text-xs text-foreground/40">Под заказ</span>}
                        {reason && (
                          <span className="flex items-center gap-1 text-xs text-orange-500">
                            <Icon name="TriangleAlert" size={11} /> {reason}
                          </span>
                        )}
                      </div>
                      {!reason && warn && (
                        <p className="mt-1 flex items-start gap-1 text-xs leading-tight text-amber-500">
                          <Icon name="Lightbulb" size={11} className="mt-0.5 shrink-0" /> {warn}
                        </p>
                      )}
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
        )}
      </div>
    </div>
  )
}