import { useState, useEffect, useMemo, useRef, memo } from "react"
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

// Ряды тир-листа: буква + цвет фона ярлыка + описание (показывается по двойному клику)
const TIERS: Array<{ rank: string; color: string; title: string; desc: string }> = [
  { rank: "S", color: "#ef4444", title: "Эталон",
    desc: "Лучшее в своём классе. Минимум огрехов или безальтернативное решение под конкретную задачу либо бюджет. Берём не задумываясь — переплата (если она есть) полностью оправдана." },
  { rank: "A", color: "#f97316", title: "Отличный выбор",
    desc: "Почти топ: отличное соотношение цены и возможностей. Есть мелкие компромиссы, но для подавляющего большинства сборок это лучший разумный вариант." },
  { rank: "B", color: "#eab308", title: "Крепкий середняк",
    desc: "Хорошее, сбалансированное решение без явных слабых мест. Не вершина, но честно отрабатывает свои деньги. Подойдёт, если нужен надёжный вариант без переплат." },
  { rank: "C", color: "#22c55e", title: "На любителя",
    desc: "Рабочий вариант, но с заметными компромиссами — по цене, нагреву, шуму или функциям. Брать стоит по акции или под узкую задачу, когда устраивают его минусы." },
  { rank: "D", color: "#3b82f6", title: "Так себе",
    desc: "Слабая позиция: за эти деньги почти всегда есть варианты лучше. Рассматривать только при сильной скидке или если ничего другого реально нет в наличии." },
  { rank: "F", color: "#a855f7", title: "Не рекомендуем",
    desc: "Категорически не советуем: завышенная цена, устаревшая или проблемная конструкция, плохая надёжность либо совместимость. Почти всегда есть более выгодная альтернатива." },
]
const RANKS = TIERS.map(t => t.rank)

// Карточка тир-листа. Вынесена наружу и мемоизирована, чтобы при ререндере
// страницы (сохранение, перестановка) DOM-узлы не пересоздавались — иначе
// сбивается drag&drop (захват) и страницу «дёргает».
const TierCard = memo(function TierCard({
  it, isAdmin, picked, dragOver,
  onCardClick, onDragStartCard, onDragEndCard, onDragOverCard, onDropCard,
}: {
  it: TierItem
  isAdmin: boolean
  picked: boolean
  dragOver: boolean
  onCardClick: (it: TierItem) => void
  onDragStartCard: (id: number) => void
  onDragEndCard: () => void
  onDragOverCard: (id: number) => void
  onDropCard: (it: TierItem) => void
}) {
  return (
    <div className="relative flex shrink-0 items-stretch">
      {/* Полоса-индикатор места вставки (слева, при наведении перетаскиванием) */}
      <div className={`mr-1 w-1 self-stretch rounded-full transition-all duration-150 ${dragOver ? "bg-primary" : "bg-transparent"}`} />
      <div
        draggable={isAdmin}
        onDragStart={e => { onDragStartCard(it.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(it.id)) }}
        onDragEnd={onDragEndCard}
        onDragOver={e => { if (isAdmin) { e.preventDefault(); onDragOverCard(it.id) } }}
        onDrop={e => { if (isAdmin) { e.preventDefault(); e.stopPropagation(); onDropCard(it) } }}
        onClick={() => onCardClick(it)}
        className={`group relative aspect-[16/9] w-40 overflow-hidden rounded-xl border bg-muted transition-[border-color] sm:w-56 ${picked ? "border-primary ring-2 ring-primary" : "border-border"} cursor-pointer active:cursor-grabbing`}
        style={{ WebkitMaskImage: "-webkit-radial-gradient(white, black)" }}
      >
        {it.image_url
          ? <img
              src={it.image_url}
              alt={it.name}
              draggable={false}
              loading="lazy"
              className="h-full w-full rounded-xl object-cover"
            />
          : <div className="flex h-full w-full items-center justify-center"><Icon name="Image" size={26} className="text-foreground/30" /></div>}

        {/* Название — отдельное окно поверх превью при наведении (десктоп)
            или при выборе карточки тапом (телефон — первый тап). */}
        <div className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/85 px-2.5 text-center backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 ${picked ? "opacity-100" : "opacity-0"}`}>
          <p className="text-sm font-semibold leading-snug text-foreground">{it.name}</p>
        </div>

        {picked && isAdmin && (
          <div className="absolute right-1.5 top-1.5 z-30 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Icon name="Check" size={12} />
          </div>
        )}
      </div>
    </div>
  )
})

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
  const [filtersOpen, setFiltersOpen] = useState(false)  // сайдбар фильтров (свёрнут по умолчанию)
  const [filterState, setFilterState] = useState<ShopFilterState>(emptyFilterState())
  const [openAttr, setOpenAttr] = useState<Record<number | string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)  // карточка, перед которой будет вставка (для полосы)
  const [pickedId, setPickedId] = useState<number | null>(null)  // выбранная карточка (клик-режим)
  const [openTier, setOpenTier] = useState<string | null>(null)  // ряд с раскрытым описанием (по клику)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  // Подсказка слева «ряды кликабельны» — через 10 сек бездействия, если юзер ещё не пользовался фичей
  const [showTierHint, setShowTierHint] = useState(false)
  const tierHintUsed = useRef<boolean>(typeof window !== "undefined" && localStorage.getItem("tier_hint_used") === "1")

  useEffect(() => {
    if (tierHintUsed.current) return
    const t = setTimeout(() => { if (!tierHintUsed.current) setShowTierHint(true) }, 10000)
    return () => clearTimeout(t)
  }, [])

  // Открытие описания тира = пользователь воспользовался фичей → больше не показывать подсказку
  const openTierDesc = (rank: string) => {
    if (!tierHintUsed.current) {
      tierHintUsed.current = true
      try { localStorage.setItem("tier_hint_used", "1") } catch { /* ignore */ }
    }
    setShowTierHint(false)
    setOpenTier(o => o === rank ? null : rank)
  }

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

  // Есть ли активные фильтры (для индикатора на кнопке «Фильтры»)
  const hasActiveFilters = filterState.onlyStock || !!filterState.priceMin || !!filterState.priceMax
    || filterState.brands.size > 0 || Object.values(filterState.attrs).some(s => s.size > 0)

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
  // На телефоне (нет hover) гостю первый тап показывает название (подсветка),
  // второй тап по той же карточке — переход на товар. На десктопе — сразу товар.
  const onCardClick = (it: TierItem) => {
    if (!isAdmin) {
      const isTouch = typeof window !== "undefined" && window.matchMedia("(hover: none)").matches
      if (isTouch && pickedId !== it.id) { setPickedId(it.id); return }
      navigate(`/product/${it.id}`); return
    }
    if (pickedId != null && pickedId !== it.id) { dropOnCard(it); return }
    setPickedId(prev => prev === it.id ? null : it.id)
  }

  const renderCard = (it: TierItem) => (
    <TierCard
      key={it.id}
      it={it}
      isAdmin={isAdmin}
      picked={pickedId === it.id}
      dragOver={dragOverId === it.id && dragId != null && dragId !== it.id}
      onCardClick={onCardClick}
      onDragStartCard={(id) => { setPickedId(null); setDragId(id) }}
      onDragEndCard={() => { setDragId(null); setDragOverId(null) }}
      onDragOverCard={(id) => { if (dragId != null && dragId !== id) setDragOverId(id) }}
      onDropCard={(target) => { dropOnCard(target); setDragOverId(null) }}
    />
  )

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
            <span className="sm:hidden"> Дважды кликните на букву ряда, чтобы узнать, что она означает.</span>
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
            {/* Категория (дропдаун) + кнопка раскрытия фильтров правее */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative inline-block">
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

              {/* Кнопка раскрытия фильтров — выпадающей плашкой, правее категории */}
              <div className="relative inline-block">
                <button onClick={() => setFiltersOpen(o => !o)}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${filtersOpen ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground/70 hover:border-primary hover:text-foreground"}`}
                  style={{ cursor: "pointer" }}>
                  <Icon name="SlidersHorizontal" size={16} />
                  <span>Фильтры</span>
                  {hasActiveFilters && <span className="h-2 w-2 rounded-full bg-primary" />}
                  <Icon name={filtersOpen ? "ChevronUp" : "ChevronDown"} size={14} className="text-foreground/40" />
                </button>
                {filtersOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setFiltersOpen(false)} style={{ cursor: "auto" }} />
                    <div className="absolute left-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-3rem)] rounded-2xl shadow-2xl">
                      <ShopFilters
                        attributes={catAttrs}
                        products={asShopProducts}
                        state={filterState}
                        setState={setFilterState}
                        openAttr={openAttr}
                        setOpenAttr={setOpenAttr}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Сброс фильтров — рядом, когда фильтры скрыты и есть активные */}
              {hasActiveFilters && !filtersOpen && (
                <button onClick={() => setFilterState(emptyFilterState())}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground/60 transition-colors hover:border-red-400 hover:text-red-400"
                  style={{ cursor: "pointer" }}>
                  <Icon name="X" size={15} />
                  <span>Сбросить</span>
                </button>
              )}
            </div>

            {saving && (
              <div className="mb-3 flex items-center gap-1.5 text-xs text-foreground/50">
                <Icon name="Loader" size={12} className="animate-spin" /> Сохранение…
              </div>
            )}

            {/* Контент: тир-лист на всю ширину (фильтры теперь в дропдауне) */}
            <div className="flex flex-col gap-6">
              <div className="relative min-w-0 flex-1">
                {/* Подсказка: ряды кликабельны (через 10 сек бездействия) */}
                {showTierHint && (
                  <div className="hidden items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground/70 xl:absolute xl:right-full xl:top-0 xl:mr-4 xl:flex xl:w-44 xl:flex-col xl:items-start xl:text-center">
                    <Icon name="MousePointerClick" size={16} className="shrink-0 text-primary" />
                    <span className="leading-snug">Нажмите на букву ряда (S, A, B…) — узнаете, что она означает</span>
                  </div>
                )}
                {/* Таблица рядов */}
                <div className="overflow-hidden rounded-2xl border border-border">
                  {TIERS.map((t, idx) => (
                    <div key={t.rank}
                      onDragOver={e => { if (isAdmin) { e.preventDefault() } }}
                      onDrop={() => dropToRank(t.rank)}
                      onClick={() => { if (isAdmin && pickedId != null) dropToRank(t.rank) }}
                      className={`flex items-stretch ${idx > 0 ? "border-t border-border" : ""} ${isAdmin && pickedId != null ? "cursor-pointer hover:bg-primary/5" : ""}`}>
                      {/* Ярлык ряда. Клик — показать/скрыть описание тира */}
                      <div
                        onClick={e => { if (!(isAdmin && pickedId != null)) { e.stopPropagation(); openTierDesc(t.rank) } }}
                        title="Нажмите, чтобы узнать про этот ряд"
                        className="flex w-16 shrink-0 flex-col items-center justify-center sm:w-20"
                        style={{ backgroundColor: t.color, cursor: "pointer" }}>
                        <span className="text-2xl font-black text-white drop-shadow">{t.rank}</span>
                        <Icon name="Info" size={11} className="mt-0.5 text-white/70" />
                      </div>
                      <div className="flex min-h-[7rem] flex-1 flex-col gap-2 bg-card/40 p-3">
                        {/* Описание тира (раскрывается по двойному клику на букву) */}
                        {openTier === t.rank && (
                          <div className="flex items-start gap-2 rounded-lg border px-3 py-2"
                            style={{ borderColor: `${t.color}55`, backgroundColor: `${t.color}14` }}>
                            <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: t.color }}>{t.rank}</span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">{t.title}</p>
                              <p className="mt-0.5 text-xs leading-snug text-foreground/70">{t.desc}</p>
                            </div>
                            <button onClick={() => setOpenTier(null)} className="ml-auto shrink-0 text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                              <Icon name="X" size={14} />
                            </button>
                          </div>
                        )}
                        <div className="flex flex-wrap content-start gap-2">
                          {byRank.map[t.rank].map(it => renderCard(it))}
                        </div>
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
                      {byRank.unranked.map(it => renderCard(it))}
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