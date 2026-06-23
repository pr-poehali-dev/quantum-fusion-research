import { useState, useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import NotificationBell from "@/components/NotificationBell"
import CatalogTabs from "@/components/CatalogTabs"
import Footer from "@/components/Footer"
import { isAdminAuthed } from "@/components/admin/AdminGuard"
import ShopFilters, { ShopAttr, ShopSpecProduct, ShopFilterState, emptyFilterState, applyShopFilters } from "@/components/shop/ShopFilters"

interface TierItem {
  id: number
  name: string
  image_url: string | null
  category: { id: number; name: string; slug: string } | null
  brand: string | null
  tier_rank: string | null
  tier_pos: number
  price?: number
  in_stock?: boolean
  values?: Record<string, string | string[]>
}
interface TierCategory { id: number; name: string; slug: string; sort_order?: number }
interface TierAttr extends ShopAttr { category_slug?: string }

// Ряды тир-листа: буква + цвет фона ярлыка (как на классических тир-листах)
const TIERS: Array<{ rank: string; color: string }> = [
  { rank: "S", color: "#ef4444" },
  { rank: "A", color: "#f97316" },
  { rank: "B", color: "#eab308" },
  { rank: "C", color: "#22c55e" },
  { rank: "D", color: "#3b82f6" },
  { rank: "F", color: "#a855f7" },
]
const RANKS = TIERS.map(t => t.rank)

export default function TierLists() {
  const navigate = useNavigate()
  const { user } = useAuth()
  // Редактировать тир-лист может тот, кто вошёл в админку по паролю
  // ИЛИ имеет роль admin в аккаунте.
  const isAdmin = isAdminAuthed() || user?.role === "admin"

  const [items, setItems] = useState<TierItem[]>([])
  const [categories, setCategories] = useState<TierCategory[]>([])
  const [attributes, setAttributes] = useState<TierAttr[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [catOpen, setCatOpen] = useState(false)  // выпадающий список категорий
  const [filterState, setFilterState] = useState<ShopFilterState>(emptyFilterState())
  const [openAttr, setOpenAttr] = useState<Record<number | string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [pickedId, setPickedId] = useState<number | null>(null)  // выбранная карточка (клик-режим)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    api.tier.getAll().then(d => {
      setItems(d.items || [])
      setAttributes(d.attributes || [])
      // Категории — только те, у которых есть товары с фото
      const usedSlugs = new Set((d.items || []).map((i: TierItem) => i.category?.slug).filter(Boolean))
      const cats = (d.categories || []).filter((c: TierCategory) => usedSlugs.has(c.slug))
      setCategories(cats)
      if (cats.length) setActiveCat(cats[0].slug)
      setLoading(false)
    })
  }, [])

  // Сброс фильтров при смене категории
  useEffect(() => { setFilterState(emptyFilterState()); setOpenAttr({}) }, [activeCat])

  // Товары текущей категории
  const catItems = useMemo(
    () => items.filter(i => i.category?.slug === activeCat),
    [items, activeCat])

  // Характеристики выбранной категории (для сайдбара фильтров)
  const catAttrs = useMemo(
    () => attributes.filter(a => a.category_slug === activeCat),
    [attributes, activeCat])

  // Приводим к формату ShopSpecProduct для общего фильтра
  const asShopProducts = useMemo<ShopSpecProduct[]>(
    () => catItems.map(i => ({
      id: i.id, name: i.name, price: i.price || 0,
      image_url: i.image_url, in_stock: i.in_stock, brand: i.brand,
      values: i.values || {},
    })),
    [catItems])

  // Применяем фильтр и оставляем только прошедшие id
  const filtered = useMemo(() => {
    const okIds = new Set(applyShopFilters(asShopProducts, filterState).map(p => p.id))
    return catItems.filter(i => okIds.has(i.id))
  }, [catItems, asShopProducts, filterState])

  // Раскладка по рядам
  const byRank = useMemo(() => {
    const map: Record<string, TierItem[]> = {}
    RANKS.forEach(r => { map[r] = [] })
    const unranked: TierItem[] = []
    filtered.forEach(i => {
      if (i.tier_rank && map[i.tier_rank]) map[i.tier_rank].push(i)
      else unranked.push(i)
    })
    Object.keys(map).forEach(r => map[r].sort((a, b) => a.tier_pos - b.tier_pos))
    unranked.sort((a, b) => a.tier_pos - b.tier_pos)
    return { map, unranked }
  }, [filtered])

  // Сохранение расстановки (с дебаунсом)
  const persist = (changed: TierItem[]) => {
    if (!isAdmin) return
    setSaving(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.tier.save(changed.map(i => ({ id: i.id, tier_rank: i.tier_rank, tier_pos: i.tier_pos })))
        .finally(() => setSaving(false))
    }, 400)
  }

  // Перемещение товара в ряд с позицией.
  // beforeId — id карточки, ПЕРЕД которой вставить (null — в конец ряда).
  // Перенумеровываем весь целевой ряд (0,1,2…), чтобы позиция была стабильной.
  const moveTo = (id: number, rank: string | null, beforeId: number | null = null) => {
    if (!isAdmin) return
    setItems(prev => {
      const moving = prev.find(i => i.id === id)
      if (!moving) return prev
      const slug = moving.category?.slug
      // текущий порядок целевого ряда (без перемещаемой карточки)
      const row = prev
        .filter(i => i.category?.slug === slug && i.tier_rank === rank && i.id !== id)
        .sort((a, b) => a.tier_pos - b.tier_pos)
      // вставляем moving перед beforeId (или в конец)
      const insertAt = beforeId != null ? row.findIndex(i => i.id === beforeId) : -1
      const ordered = [...row]
      if (insertAt >= 0) ordered.splice(insertAt, 0, moving)
      else ordered.push(moving)
      // новые позиции
      const posById = new Map<number, number>()
      ordered.forEach((i, idx) => posById.set(i.id, idx))
      const changed: TierItem[] = []
      const next = prev.map(i => {
        if (i.id === id) {
          const u = { ...i, tier_rank: rank, tier_pos: posById.get(i.id) ?? 0 }
          changed.push(u); return u
        }
        if (posById.has(i.id) && i.tier_pos !== posById.get(i.id)) {
          const u = { ...i, tier_pos: posById.get(i.id)! }
          changed.push(u); return u
        }
        return i
      })
      persist(changed)
      return next
    })
  }

  // Бросок/клик на ПУСТУЮ зону ряда — в конец.
  const dropToRank = (rank: string | null) => {
    if (!isAdmin) return
    const id = dragId ?? pickedId
    if (id != null) moveTo(id, rank, null)
    setDragId(null)
    setPickedId(null)
  }

  // Бросок/клик на КОНКРЕТНУЮ карточку — вставка перед ней.
  const dropOnCard = (target: TierItem) => {
    if (!isAdmin) return
    const id = dragId ?? pickedId
    if (id != null && id !== target.id) moveTo(id, target.tier_rank, target.id)
    setDragId(null)
    setPickedId(null)
  }

  // Клик по карточке: админ — если выбрана другая карточка, вставляем её ПЕРЕД этой;
  // иначе выбираем/снимаем выбор. Гость — открывает товар.
  const onCardClick = (it: TierItem) => {
    if (!isAdmin) { navigate(`/product/${it.id}`); return }
    if (pickedId != null && pickedId !== it.id) { dropOnCard(it); return }
    setPickedId(prev => prev === it.id ? null : it.id)
  }

  const TierCard = ({ it }: { it: TierItem }) => {
    const picked = pickedId === it.id
    return (
      <div
        draggable={isAdmin}
        onDragStart={e => { setPickedId(null); setDragId(it.id); e.dataTransfer.effectAllowed = "move" }}
        onDragEnd={() => setDragId(null)}
        onDragOver={e => { if (isAdmin && dragId != null && dragId !== it.id) e.preventDefault() }}
        onDrop={e => { if (isAdmin) { e.preventDefault(); e.stopPropagation(); dropOnCard(it) } }}
        onClick={() => onCardClick(it)}
        className={`group relative aspect-[16/9] w-40 shrink-0 overflow-hidden rounded-xl border bg-muted transition-transform duration-200 ease-out hover:z-20 hover:scale-[1.03] sm:w-56 ${picked ? "z-20 border-primary ring-2 ring-primary scale-[1.03]" : "border-border"} cursor-pointer active:cursor-grabbing`}
        style={{ WebkitMaskImage: "-webkit-radial-gradient(white, black)" }}
      >
        {it.image_url
          ? <img
              src={it.image_url}
              alt={it.name}
              draggable={false}
              loading="lazy"
              className="h-full w-full rounded-xl object-cover"
              style={{ imageRendering: "auto", backfaceVisibility: "hidden", transform: "translateZ(0)" }}
            />
          : <div className="flex h-full w-full items-center justify-center"><Icon name="Image" size={26} className="text-foreground/30" /></div>}

        {/* Название — отдельное окно поверх превью на весь её размер при наведении */}
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/85 px-2.5 text-center opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
          <p className="text-sm font-semibold leading-snug text-foreground">{it.name}</p>
        </div>

        {picked && (
          <div className="absolute right-1.5 top-1.5 z-30 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Icon name="Check" size={12} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      {/* Шапка */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <NotificationBell />
            <button onClick={() => navigate("/shop")} className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="Package" size={16} />
              <span>Каталог</span>
            </button>
          </div>
        </div>
      </header>

      <CatalogTabs />

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Тир-листы железа</h1>
          <p className="mt-1 text-sm text-foreground/60">
            Рейтинг комплектующих по рядам — от лучших (S) до спорных (F).
          </p>
          {isAdmin && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground/70">
              <Icon name="Info" size={15} className="mt-0.5 shrink-0 text-primary" />
              <span>
                Режим редактирования: <b>нажмите на карточку</b> (она подсветится),
                затем <b>нажмите на нужный ряд</b> — товар переместится. Можно и
                перетаскивать мышью. Расстановка сохраняется автоматически.
                {pickedId != null && <span className="ml-1 font-medium text-primary">Выбран товар — кликните по ряду.</span>}
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-20 text-center text-foreground/40">Загрузка…</div>
        ) : categories.length === 0 ? (
          <div className="py-20 text-center text-foreground/40">Нет товаров с фото для тир-листа.</div>
        ) : (
          <>
            {/* Категория — выпадающий список (как в каталоге товаров) */}
            <div className="relative mb-4 inline-block">
              <button onClick={() => setCatOpen(o => !o)}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${catOpen ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground/70 hover:border-primary hover:text-foreground"}`}
                style={{ cursor: "pointer" }}>
                <Icon name="AlignLeft" size={16} />
                <span>{categories.find(c => c.slug === activeCat)?.name || "Категория"}</span>
                <Icon name={catOpen ? "ChevronUp" : "ChevronDown"} size={14} className="text-foreground/40" />
              </button>
              {catOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCatOpen(false)} style={{ cursor: "auto" }} />
                  <div className="absolute left-0 top-full z-50 mt-2 max-h-80 w-64 overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-2xl">
                    {categories.map(c => (
                      <button key={c.id} onClick={() => { setActiveCat(c.slug); setCatOpen(false) }}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${activeCat === c.slug ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-muted hover:text-foreground"}`}
                        style={{ cursor: "pointer" }}>
                        {c.name}
                        {activeCat === c.slug && <Icon name="Check" size={14} />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {saving && (
              <div className="mb-3 flex items-center gap-1.5 text-xs text-foreground/50">
                <Icon name="Loader" size={12} className="animate-spin" /> Сохранение…
              </div>
            )}

            {/* Контент: фильтр слева + тир-лист справа (как в каталоге) */}
            <div className="flex flex-col gap-6 sm:flex-row">
              <ShopFilters
                attributes={catAttrs}
                products={asShopProducts}
                state={filterState}
                setState={setFilterState}
                openAttr={openAttr}
                setOpenAttr={setOpenAttr}
              />

              <div className="min-w-0 flex-1">
                {/* Таблица рядов */}
                <div className="overflow-hidden rounded-2xl border border-border">
                  {TIERS.map((t, idx) => (
                    <div key={t.rank}
                      onDragOver={e => { if (isAdmin) e.preventDefault() }}
                      onDrop={() => dropToRank(t.rank)}
                      onClick={() => { if (isAdmin && pickedId != null) dropToRank(t.rank) }}
                      className={`flex items-stretch ${idx > 0 ? "border-t border-border" : ""} ${isAdmin && pickedId != null ? "cursor-pointer hover:bg-primary/5" : ""}`}>
                      <div className="flex w-16 shrink-0 items-center justify-center sm:w-20" style={{ backgroundColor: t.color }}>
                        <span className="text-2xl font-black text-white drop-shadow">{t.rank}</span>
                      </div>
                      <div className="flex min-h-[7rem] flex-1 flex-wrap content-start gap-2 bg-card/40 p-3">
                        {byRank.map[t.rank].map(it => <TierCard key={it.id} it={it} />)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Не распределённые товары */}
                {byRank.unranked.length > 0 && (
                  <div className="mt-6">
                    <p className="mb-2 text-sm font-semibold text-foreground/70">
                      {isAdmin ? "Без оценки — выберите карточку и кликните ряд (или перетащите)" : "Без оценки"}
                    </p>
                    <div
                      onDragOver={e => { if (isAdmin) e.preventDefault() }}
                      onDrop={() => dropToRank(null)}
                      onClick={() => { if (isAdmin && pickedId != null) dropToRank(null) }}
                      className={`flex flex-wrap gap-2 rounded-2xl border border-dashed border-border bg-card/30 p-3 ${isAdmin && pickedId != null ? "cursor-pointer hover:bg-primary/5" : ""}`}>
                      {byRank.unranked.map(it => <TierCard key={it.id} it={it} />)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <Footer />
    </div>
  )
}