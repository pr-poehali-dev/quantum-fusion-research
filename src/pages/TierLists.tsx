import { useState, useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import NotificationBell from "@/components/NotificationBell"
import Footer from "@/components/Footer"

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
  const isAdmin = user?.role === "admin"

  const [items, setItems] = useState<TierItem[]>([])
  const [categories, setCategories] = useState<TierCategory[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [activeBrands, setActiveBrands] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
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

  const onDrop = (rank: string | null) => {
    if (dragId != null) moveTo(dragId, rank)
    setDragId(null)
  }

  const TierCard = ({ it }: { it: TierItem }) => (
    <div
      draggable={isAdmin}
      onDragStart={() => setDragId(it.id)}
      onDragEnd={() => setDragId(null)}
      onClick={() => navigate(`/product/${it.id}`)}
      title={it.name}
      className={`group relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted transition-transform hover:scale-105 ${isAdmin ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
    >
      {it.image_url
        ? <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center"><Icon name="Image" size={20} className="text-foreground/30" /></div>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-3">
        <p className="truncate text-[10px] font-medium text-white">{it.name}</p>
      </div>
    </div>
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

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Тир-листы железа</h1>
          <p className="mt-1 text-sm text-foreground/60">
            Рейтинг комплектующих по рядам — от лучших (S) до спорных (F).
            {isAdmin && " Перетаскивайте карточки между рядами — расстановка сохраняется автоматически."}
          </p>
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
                  onDrop={() => onDrop(t.rank)}
                  className={`flex items-stretch ${idx > 0 ? "border-t border-border" : ""}`}>
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
                  {isAdmin ? "Без оценки — перетащите в нужный ряд" : "Без оценки"}
                </p>
                <div
                  onDragOver={e => { if (isAdmin) e.preventDefault() }}
                  onDrop={() => onDrop(null)}
                  className="flex flex-wrap gap-2 rounded-2xl border border-dashed border-border bg-card/30 p-3">
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
