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

interface TierItem {
  id: number
  name: string
  image_url: string | null
  category: { id: number; name: string; slug: string } | null
  brand: string | null
  tier_rank: string | null
  tier_pos: number
}
interface TierCategory { id: number; name: string; slug: string; sort_order?: number }

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
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [activeBrands, setActiveBrands] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [pickedId, setPickedId] = useState<number | null>(null)  // выбранная карточка (клик-режим)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    api.tier.getAll().then(d => {
      setItems(d.items || [])
      // Категории — только те, у которых есть товары с фото
      const usedSlugs = new Set((d.items || []).map((i: TierItem) => i.category?.slug).filter(Boolean))
      const cats = (d.categories || []).filter((c: TierCategory) => usedSlugs.has(c.slug))
      setCategories(cats)
      if (cats.length) setActiveCat(cats[0].slug)
      setLoading(false)
    })
  }, [])

  // Сброс выбранных брендов при смене категории
  useEffect(() => { setActiveBrands(new Set()) }, [activeCat])

  // Товары текущей категории
  const catItems = useMemo(
    () => items.filter(i => i.category?.slug === activeCat),
    [items, activeCat])

  // Список брендов категории
  const brandList = useMemo(() => {
    const s = new Set<string>()
    catItems.forEach(i => { if (i.brand) s.add(i.brand) })
    return Array.from(s).sort()
  }, [catItems])

  const toggleBrand = (b: string) => setActiveBrands(prev => {
    const next = new Set(prev)
    if (next.has(b)) next.delete(b); else next.add(b)
    return next
  })

  // Товары с учётом фильтра брендов
  const filtered = useMemo(
    () => activeBrands.size === 0 ? catItems : catItems.filter(i => i.brand && activeBrands.has(i.brand)),
    [catItems, activeBrands])

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

  // Перемещение товара в ряд (rank=null — снять оценку)
  const moveTo = (id: number, rank: string | null) => {
    if (!isAdmin) return
    setItems(prev => {
      const moving = prev.find(i => i.id === id)
      if (!moving) return prev
      const sameRow = prev.filter(i => i.category?.slug === moving.category?.slug && i.tier_rank === rank && i.id !== id)
      const maxPos = sameRow.reduce((m, i) => Math.max(m, i.tier_pos), -1)
      const next = prev.map(i => i.id === id ? { ...i, tier_rank: rank, tier_pos: maxPos + 1 } : i)
      persist([{ ...moving, tier_rank: rank, tier_pos: maxPos + 1 }])
      return next
    })
  }

  // Перемещение в ряд: и для drag&drop, и для клик-режима.
  const dropToRank = (rank: string | null) => {
    if (!isAdmin) return
    const id = dragId ?? pickedId
    if (id != null) moveTo(id, rank)
    setDragId(null)
    setPickedId(null)
  }

  // Клик по карточке: админ — выбирает/снимает выбор; гость — открывает товар.
  const onCardClick = (it: TierItem) => {
    if (!isAdmin) { navigate(`/product/${it.id}`); return }
    setPickedId(prev => prev === it.id ? null : it.id)
  }

  const TierCard = ({ it }: { it: TierItem }) => {
    const picked = pickedId === it.id
    return (
      <div
        draggable={isAdmin}
        onDragStart={e => { setPickedId(null); setDragId(it.id); e.dataTransfer.effectAllowed = "move" }}
        onDragEnd={() => setDragId(null)}
        onClick={() => onCardClick(it)}
        title={isAdmin ? "Нажмите, чтобы выбрать, затем нажмите на нужный ряд" : it.name}
        className={`group relative aspect-[16/9] w-32 shrink-0 overflow-visible rounded-lg border bg-muted transition-transform hover:z-20 hover:scale-105 sm:w-44 ${picked ? "z-20 border-primary ring-2 ring-primary scale-105" : "border-border"} cursor-pointer active:cursor-grabbing`}
      >
        {/* Всплывающий бокс с названием — над верхней границей фото при наведении */}
        <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-max max-w-[200px] -translate-x-1/2 scale-95 rounded-lg border border-border bg-card px-2.5 py-1.5 text-center opacity-0 shadow-xl transition-all duration-150 group-hover:scale-100 group-hover:opacity-100">
          <p className="text-xs font-medium leading-snug text-foreground">{it.name}</p>
          <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-b border-r border-border bg-card" />
        </div>

        <div className="h-full w-full overflow-hidden rounded-lg">
          {it.image_url
            ? <img src={it.image_url} alt={it.name} draggable={false} className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center"><Icon name="Image" size={22} className="text-foreground/30" /></div>}
        </div>

        {picked && (
          <div className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
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
            {/* Фильтр категории */}
            <div className="mb-4 flex flex-wrap gap-2">
              {categories.map(c => (
                <button key={c.id} onClick={() => setActiveCat(c.slug)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${activeCat === c.slug ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary/50"}`}
                  style={{ cursor: "pointer" }}>
                  {c.name}
                </button>
              ))}
            </div>

            {/* Фильтр брендов */}
            {brandList.length > 0 && (
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground/40">Бренды:</span>
                {brandList.map(b => {
                  const on = activeBrands.has(b)
                  return (
                    <button key={b} onClick={() => toggleBrand(b)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary/50"}`}
                      style={{ cursor: "pointer" }}>
                      <Icon name={on ? "CheckSquare" : "Square"} size={14} />
                      {b}
                    </button>
                  )
                })}
                {activeBrands.size > 0 && (
                  <button onClick={() => setActiveBrands(new Set())}
                    className="text-xs text-foreground/50 hover:text-foreground" style={{ cursor: "pointer" }}>
                    Сбросить
                  </button>
                )}
              </div>
            )}

            {saving && (
              <div className="mb-3 flex items-center gap-1.5 text-xs text-foreground/50">
                <Icon name="Loader" size={12} className="animate-spin" /> Сохранение…
              </div>
            )}

            {/* Таблица рядов */}
            <div className="overflow-hidden rounded-2xl border border-border">
              {TIERS.map((t, idx) => (
                <div key={t.rank}
                  onDragOver={e => { if (isAdmin) e.preventDefault() }}
                  onDrop={() => dropToRank(t.rank)}
                  onClick={() => { if (isAdmin && pickedId != null) dropToRank(t.rank) }}
                  className={`flex items-stretch ${idx > 0 ? "border-t border-border" : ""} ${isAdmin && pickedId != null ? "cursor-pointer hover:bg-primary/5" : ""}`}>
                  <div className="flex w-20 shrink-0 items-center justify-center" style={{ backgroundColor: t.color }}>
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
          </>
        )}
      </div>

      <Footer />
    </div>
  )
}