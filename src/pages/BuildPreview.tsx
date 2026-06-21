import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { useParams, useSearchParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "Оперативная память",
  storage: "Накопитель", psu: "Блок питания", case: "Корпус", motherboard: "Материнская плата",
  cooling: "Охлаждение", extra: "Доп. комплектующие",
}

// Маппинг слот → поле статуса в wip_builds
const SLOT_TO_WIP: Record<string, string> = {
  cpu: "cpu", gpu: "gpu", ram: "ram", storage: "storage",
  psu: "psu", case: "case", motherboard: "motherboard",
  cooling: "cooling", extra: "extra",
}

const COMPONENT_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:         { label: "Обрабатывается",     cls: "bg-muted/60 text-foreground/50" },
  need_order:      { label: "Надо заказать",       cls: "bg-orange-500/15 text-orange-400" },
  ordered_delay:   { label: "Заказано, задержка",  cls: "bg-yellow-500/15 text-yellow-400" },
  ordered_transit: { label: "Едет к нам",          cls: "bg-blue-500/15 text-blue-400" },
  ready:           { label: "Готово / в наличии",  cls: "bg-green-600/20 text-green-400" },
}

interface Component {
  slot: string; name: string; price: number; current_price?: number; qty?: number
  source_id?: number; image_url?: string; image_urls?: string[]; description?: string; specs?: Record<string, string>
}

interface BuildTag { id: number; name: string; color: string }

interface WipInfo {
  stage: string
  received_at?: string
  issued_at?: string
  delivery_type?: string
  cpu_status?: string; motherboard_status?: string; ram_status?: string; gpu_status?: string
  storage_status?: string; psu_status?: string; case_status?: string; cooling_status?: string; extra_status?: string
  total?: number
  prepayment_amount?: number
  prepayment_confirmed_amount?: number
  remaining_amount?: number
}

interface Build {
  id: number; name: string; description: string; components: Component[]
  parts_total: number; assembly_fee: number; total_price: number
  assembly_type: string; image_urls: string[]
  is_featured?: boolean; status?: string
  client_token?: string | null; client_user_id?: number | null; parent_id?: number | null
  sell_with_vat?: boolean
  tags?: BuildTag[]
}

// Продажа с НДС: +22% и округление вверх до 250 ₽ (единая формула проекта)
const withVat = (base: number, vat?: boolean) => vat ? Math.ceil(base * 1.22 / 250) * 250 : base

const DELIVERY_DESCRIPTIONS: Record<string, { title: string; desc: string }> = {
  "Самовывоз Беляево":    { title: "Самовывоз · Беляево", desc: "м. Беляево, Профсоюзная ул. Уточним адрес при подтверждении." },
  "Самовывоз Новокосино": { title: "Самовывоз · Новокосино", desc: "м. Новокосино. Уточним адрес при подтверждении." },
  "СДЭК (за счёт клиента)":                    { title: "Доставка СДЭК", desc: "Отправим по всей России. Стоимость доставки за счёт получателя." },
  "Курьер Яндекс по МСК (за счёт клиента)":   { title: "Курьер по Москве", desc: "Доставка курьером Яндекс. Стоимость доставки за счёт получателя." },
}

const WIP_STAGE_COLORS_CLIENT: Record<string, string> = {
  "Согласование":           "bg-muted/60 text-foreground/50",
  "Заказ":                  "bg-blue-500/15 text-blue-400",
  "Ожидание железа":        "bg-yellow-500/15 text-yellow-400",
  "Ожидание сборки":        "bg-orange-500/15 text-orange-400",
  "Сборка":                 "bg-blue-600/15 text-blue-300",
  "Настройка":              "bg-blue-700/15 text-blue-300",
  "Тесты":                  "bg-purple-500/15 text-purple-400",
  "Досборать":              "bg-red-500/15 text-red-400",
  "Проверка перед выдачей": "bg-teal-500/15 text-teal-400",
  "Ожидание упаковки":      "bg-cyan-500/15 text-cyan-400",
  "Готов, можно забрать":   "bg-green-600/20 text-green-400",
  "Отнести в сдэк":         "bg-green-700/15 text-green-300",
  "Забрали":                "bg-muted/40 text-foreground/30",
}

const TAG_COLOR_MAP: Record<string, string> = {
  primary: "border-primary/40 bg-primary/10 text-primary",
  green: "border-green-400/40 bg-green-400/10 text-green-400",
  blue: "border-blue-400/40 bg-blue-400/10 text-blue-400",
  orange: "border-orange-400/40 bg-orange-400/10 text-orange-400",
  purple: "border-purple-400/40 bg-purple-400/10 text-purple-400",
  red: "border-red-400/40 bg-red-400/10 text-red-400",
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

// Подтягивает фото каждого компонента из каталога по source_id.
// livePrice=true — также обновляет цену компонента до актуальной цены продажи
// из каталога (для витринных сборок «на показ»). Для сборок в заказах цена
// остаётся зафиксированной (livePrice=false).
async function enrichComponents(comps: Component[], livePrice = false): Promise<Component[]> {
  const ids = [...new Set(comps.filter(c => c.source_id).map(c => c.source_id!))]
  const products: Record<number, { image_urls?: string[]; image_url?: string; description?: string; price?: number }> = {}
  await Promise.all(ids.map(id =>
    api.products.getById(id).then(p => { if (p?.id) products[id] = p }).catch(() => {})
  ))
  return comps.map(c => {
    if (!c.source_id) return c
    const p = products[c.source_id]
    if (!p) return c
    return {
      ...c,
      image_urls: (p.image_urls && p.image_urls.length > 0) ? p.image_urls : undefined,
      image_url: p.image_url || (p.image_urls && p.image_urls[0]) || c.image_url,
      description: c.description || p.description,
      // Актуальная цена каталога — только для витринных сборок
      current_price: livePrice && typeof p.price === "number" ? p.price : c.current_price,
    }
  })
}

// Обогащает компоненты ВСЕХ вариантов актуальными ценами каталога,
// чтобы корректно считать разницу цен между вариантами (а не по устаревшей price из БД).
// ВАЖНО: livePrice определяется по статусу КОРНЯ (list[0]) и применяется ко всем
// вариантам одинаково — иначе варианты-копии (status=draft/client) считаются
// по устаревшей price из БД, а корень (catalog) — по актуальной, и разница врёт.
async function enrichVariants(list: Build[]): Promise<Build[]> {
  const livePrice = list[0]?.status === "catalog"
  return Promise.all(list.map(async (b) => ({
    ...b,
    components: await enrichComponents(b.components || [], livePrice),
  })))
}

export default function BuildPreview() {
  const { id, code } = useParams<{ id: string; code: string }>()
  const [searchParams] = useSearchParams()
  const queryToken = searchParams.get("token")
  const navigate = useNavigate()
  const { isAuthed, sessionId, user } = useAuth()
  const { addItem } = useCart()

  // короткий код /b/:code резолвится в client_token
  const [codeToken, setCodeToken] = useState<string | null>(null)
  useEffect(() => {
    if (!code) { setCodeToken(null); return }
    api.builds.getByShortCode(code).then(d => {
      if (d?.client_token) { setCodeToken(d.client_token) }
      else { setError("Сборка не найдена"); setLoading(false) }
    }).catch(() => { setError("Не удалось загрузить сборку"); setLoading(false) })
  }, [code])

  const token = queryToken || codeToken
  const isTokenMode = !!token || !!code

  const [variants, setVariants] = useState<Build[]>([])
  const [activeVariant, setActiveVariant] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [components, setComponents] = useState<Component[]>([])
  const [currentSection, setCurrentSection] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [wipInfo, setWipInfo] = useState<WipInfo | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const wheelLockRef = useRef(false)
  const touchStartY = useRef(0)
  const touchStartX = useRef(0)

  // Загрузка по ID (публичная)
  useEffect(() => {
    if (isTokenMode || !id) return
    api.builds.getById(Number(id)).then(async (data) => {
      if (data.error || !data.id) { setError("Сборка не найдена"); setLoading(false); return }
      // Корень сборки (если открыли вариант — берём родителя), затем подтягиваем все варианты
      const root = data.parent_id ? (await api.builds.getById(data.parent_id).catch(() => data)) : data
      const rootBuild: Build = (root && root.id) ? root : data
      const variantsRaw = await api.builds.getVariants(rootBuild.id).catch(() => [])
      const children: Build[] = Array.isArray(variantsRaw) ? variantsRaw : []
      // Обогащаем все варианты актуальными ценами — для корректной разницы цен
      const list = await enrichVariants([rootBuild, ...children])
      setVariants(list)
      setComponents(list[0]?.components || [])
      setLoading(false)
    }).catch(() => { setError("Не удалось загрузить сборку"); setLoading(false) })
    // Подгружаем статус сборки в процессе (если есть)
    api.wipBuilds.getByOrderId(Number(id)).then(d => {
      if (d && d.stage) setWipInfo({ stage: d.stage, received_at: d.received_at, issued_at: d.issued_at, delivery_type: d.delivery_type,
        cpu_status: d.cpu_status, motherboard_status: d.motherboard_status, ram_status: d.ram_status, gpu_status: d.gpu_status,
        storage_status: d.storage_status, psu_status: d.psu_status, case_status: d.case_status, cooling_status: d.cooling_status, extra_status: d.extra_status,
        total: d.total, prepayment_amount: d.prepayment_amount, prepayment_confirmed_amount: d.prepayment_confirmed_amount, remaining_amount: d.remaining_amount })
    }).catch(() => {})
  }, [id, isTokenMode])

  // Загрузка по токену (клиентская)
  useEffect(() => {
    if (!isTokenMode || !token) return
    api.builds.getByClientToken(token).then(async (data) => {
      if (data?.error) { setError(data.error); setLoading(false); return }
      const rawList: Build[] = Array.isArray(data) ? data : [data]
      if (!rawList.length) { setError("Сборка не найдена"); setLoading(false); return }
      const root = rawList.find(b => !b.parent_id) ?? rawList[0]
      const variantsRaw = await api.builds.getVariants(root.id).catch(() => [])
      const children: Build[] = Array.isArray(variantsRaw) ? variantsRaw : []
      // Обогащаем все варианты актуальными ценами — для корректной разницы цен
      const list = await enrichVariants([root, ...children])
      setVariants(list)
      setComponents(list[0]?.components || [])
      if (root.client_user_id && user && root.client_user_id === user.id) setClaimed(true)
      setLoading(false)
    }).catch(() => { setError("Не удалось загрузить сборку"); setLoading(false) })
    // Подгружаем статус сборки в процессе по токену
    api.wipBuilds.getByClientToken(token).then(d => {
      if (d && d.stage) setWipInfo({ stage: d.stage, received_at: d.received_at, issued_at: d.issued_at, delivery_type: d.delivery_type,
        cpu_status: d.cpu_status, motherboard_status: d.motherboard_status, ram_status: d.ram_status, gpu_status: d.gpu_status,
        storage_status: d.storage_status, psu_status: d.psu_status, case_status: d.case_status, cooling_status: d.cooling_status, extra_status: d.extra_status,
        total: d.total, prepayment_amount: d.prepayment_amount, prepayment_confirmed_amount: d.prepayment_confirmed_amount, remaining_amount: d.remaining_amount })
    }).catch(() => {})
  }, [token, isTokenMode, user])

  // При смене варианта (компоненты уже обогащены при загрузке списка)
  useEffect(() => {
    const v = variants[activeVariant]
    if (!v) return
    setComponents(v.components || [])
    setCurrentSection(0)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }, [activeVariant]) // eslint-disable-line react-hooks/exhaustive-deps

  const build = variants[activeVariant] ?? null
  const hasMultipleVariants = variants.length > 1

  // Слоты, которые ОТЛИЧАЮТСЯ между вариантами — по самой железке (название)
  // ИЛИ по количеству (qty), ИЛИ если в каком-то варианте этой железки нет.
  // Такие комплектующие подсвечиваем зелёным — это и есть разница вариантов.
  const variantDiffSlots = useMemo(() => {
    const diff = new Set<string>()
    if (variants.length <= 1) return diff
    const allSlots = new Set<string>()
    const perVariant = variants.map(v => {
      const map: Record<string, string> = {}
      for (const c of (v.components || [])) {
        allSlots.add(c.slot)
        // ключ железки: название + количество
        map[c.slot] = `${(c.name || "").trim()}__x${c.qty || 1}`
      }
      return map
    })
    for (const slot of allSlots) {
      const keys = new Set(perVariant.map(m => m[slot] ?? "__absent__"))
      if (keys.size > 1) diff.add(slot)
    }
    return diff
  }, [variants])

  // Считаем суммы из компонентов (поля в БД могут быть устаревшими).
  // Для витринных сборок current_price = актуальная цена каталога.
  const calcPartsTotal = components.reduce((s, c) => s + ((c.current_price ?? c.price) || 0) * (c.qty || 1), 0)
  const calcAssemblyFee = build?.assembly_fee || 0
  // Для НДС-сборок применяем +22% с округлением до 250 ₽ (как в админке)
  const calcTotalPrice = withVat(calcPartsTotal + calcAssemblyFee, build?.sell_with_vat)
  const totalSections = components.length + 2

  // ── Разница цен относительно ОСНОВНОГО варианта (variants[0]) ──
  const baseVariant = variants[0] ?? null
  const isBaseActive = activeVariant === 0
  // Итоговая цена основного варианта (по тем же правилам: железо + сборка + НДС)
  const basePartsTotal = (baseVariant?.components || []).reduce(
    (s, c) => s + ((c.current_price ?? c.price) || 0) * (c.qty || 1), 0)
  const baseTotalPrice = withVat(basePartsTotal + (baseVariant?.assembly_fee || 0), baseVariant?.sell_with_vat)
  // Разница итога текущего варианта от основного (>0 дороже, <0 дешевле)
  const totalDiff = isBaseActive ? 0 : (calcTotalPrice - baseTotalPrice)
  // Сумма по слоту в основном варианте — для разницы рядом с конкретной железкой
  const baseSlotTotal = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of (baseVariant?.components || [])) {
      m[c.slot] = (m[c.slot] || 0) + ((c.current_price ?? c.price) || 0) * (c.qty || 1)
    }
    return m
  }, [baseVariant])
  // Формат знаковой разницы: +123 / −123
  const fmtDiff = (n: number) => (n > 0 ? "+" : "−") + fmt(Math.abs(n))

  const sectionRefs = useRef<(HTMLDivElement | null)[]>([])

  const scrollToSection = useCallback((index: number) => {
    if (index < 0 || index >= totalSections || isTransitioning) return
    setIsTransitioning(true)
    setCurrentSection(index)
    const el = sectionRefs.current[index]
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    } else if (scrollContainerRef.current) {
      const h = scrollContainerRef.current.clientHeight || window.innerHeight
      scrollContainerRef.current.scrollTo({ top: h * index, behavior: "smooth" })
    }
    setTimeout(() => setIsTransitioning(false), 800)
  }, [totalSections, isTransitioning])

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (wheelLockRef.current) return
      if (Math.abs(e.deltaY) < 10) return
      wheelLockRef.current = true
      setTimeout(() => { wheelLockRef.current = false }, 900)
      if (e.deltaY > 0) scrollToSection(currentSection + 1)
      else scrollToSection(currentSection - 1)
    }
    const el = scrollContainerRef.current
    if (el) el.addEventListener("wheel", handleWheel, { passive: false })
    return () => { if (el) el.removeEventListener("wheel", handleWheel) }
  }, [currentSection, scrollToSection])

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0].clientY
      touchStartX.current = e.touches[0].clientX
    }
    const onTouchEnd = (e: TouchEvent) => {
      const deltaY = touchStartY.current - e.changedTouches[0].clientY
      const deltaX = touchStartX.current - e.changedTouches[0].clientX
      if (hasMultipleVariants && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60) {
        if (deltaX > 0) setActiveVariant(i => Math.min(i + 1, variants.length - 1))
        else setActiveVariant(i => Math.max(i - 1, 0))
        return
      }
      const delta = deltaY
      if (Math.abs(delta) > 50) {
        if (delta > 0) scrollToSection(currentSection + 1)
        else scrollToSection(currentSection - 1)
      }
    }
    const el = scrollContainerRef.current
    if (el) {
      el.addEventListener("touchstart", onTouchStart, { passive: true })
      el.addEventListener("touchend", onTouchEnd, { passive: true })
    }
    return () => {
      if (el) {
        el.removeEventListener("touchstart", onTouchStart)
        el.removeEventListener("touchend", onTouchEnd)
      }
    }
  }, [currentSection, scrollToSection, hasMultipleVariants, variants.length])

  // IntersectionObserver — обновляем currentSection по реальному скроллу (важно для iOS)
  useEffect(() => {
    if (!sectionRefs.current.length) return
    const observers: IntersectionObserver[] = []
    sectionRefs.current.forEach((el, idx) => {
      if (!el) return
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          setCurrentSection(idx)
        }
      }, { threshold: 0.5 })
      obs.observe(el)
      observers.push(obs)
    })
    return () => observers.forEach(o => o.disconnect())
  }, [components.length])

  const claimBuild = async () => {
    if (!isAuthed() || !sessionId) {
      const redirect = code ? `/b/${code}` : `/build?token=${token}`
      navigate(`/auth?redirect=${encodeURIComponent(redirect)}`); return
    }
    setClaiming(true)
    await api.builds.claimBuild(token!, sessionId)
    setClaimed(true)
    setClaiming(false)
  }

  const orderBuild = () => {
    if (!build) return
    // Цена считается из компонентов: поля parts_total/total_price в БД
    // могут быть устаревшими (0), поэтому используем актуальный расчёт.
    addItem({ id: build.id, name: build.name, price: calcTotalPrice, type: "config" })
    navigate("/cart")
  }

  // Открыть текущую сборку в конфигураторе — клиент сам меняет компоненты
  // и оставляет заявку с нужной конфигурацией.
  const editInConfigurator = () => {
    if (!build) return
    // Нормализуем под формат конфигуратора: актуальная цена + source
    const initialComponents = components.map(c => ({
      slot: c.slot,
      name: c.name,
      price: (c.current_price ?? c.price) || 0,
      qty: c.qty || 1,
      source: (c.source_id ? "catalog" : "custom") as "catalog" | "custom",
      source_id: c.source_id,
      description: c.description,
      image_urls: c.image_urls,
    }))
    navigate("/configurator", { state: { initialComponents, buildName: build.name } })
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Загружаем сборку...</p>
      </div>
    </div>
  )

  if (error || !build) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <Icon name="MonitorOff" size={48} className="mb-4 text-muted-foreground/40" />
      <h1 className="mb-2 text-xl font-medium text-foreground">{error || "Сборка не найдена"}</h1>
      <button onClick={() => navigate(isTokenMode ? "/" : "/shop")} className="mt-6 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        {isTokenMode ? "На главную" : "Все сборки"}
      </button>
    </div>
  )

  const buildImages = build.image_urls || []

  return (
    <div className="relative w-screen overflow-hidden bg-background text-foreground" style={{ height: "100dvh" }}>

      {/* Точки навигации */}
      <nav className="fixed right-4 top-1/2 z-50 -translate-y-1/2 hidden sm:flex flex-col gap-2.5">
        {Array.from({ length: totalSections }).map((_, i) => (
          <button key={i} onClick={() => scrollToSection(i)} style={{ cursor: "pointer" }}
            className={`rounded-full transition-all duration-300 ${i === currentSection ? "h-6 w-2 bg-primary" : "h-2 w-2 bg-foreground/20 hover:bg-foreground/40"}`}
          />
        ))}
      </nav>

      {/* Хедер */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-8 py-4 bg-background/80 backdrop-blur-sm border-b border-border/50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(isTokenMode ? "/" : "/shop")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={16} />
            <span className="text-sm hidden sm:inline">{isTokenMode ? "Главная" : "Все сборки"}</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {isTokenMode && !claimed && (
            <button onClick={claimBuild} disabled={claiming} style={{ cursor: "pointer" }}
              className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all disabled:opacity-50">
              <Icon name="Bookmark" size={14} />
              <span className="hidden sm:inline">{claiming ? "Сохраняем..." : "Сохранить"}</span>
            </button>
          )}
          {isTokenMode && claimed && (
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <Icon name="BookmarkCheck" size={14} /> Сохранено
            </span>
          )}
          <button onClick={orderBuild} style={{ cursor: "pointer" }}
            className="rounded-full bg-primary px-4 sm:px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            <span className="hidden sm:inline">Заказать — </span>{fmt(calcTotalPrice)}
          </button>
        </div>
      </header>

      <div ref={scrollContainerRef} className="w-screen overflow-y-hidden" style={{ scrollSnapType: "y mandatory", height: "100dvh" }}>

        {/* ── СЕКЦИЯ 0: Обзор ── */}
        <div ref={el => { sectionRefs.current[0] = el }} className="w-screen shrink-0 relative" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
          <div className="relative flex h-full w-full overflow-hidden">

            {/* Карусель фото сборки — справа, автосмена */}
            {buildImages.length > 0 && (
              <HeroBuildCarousel images={buildImages} active={currentSection === 0} />
            )}
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 60% at 30% 50%, hsl(var(--primary) / 0.05) 0%, transparent 70%)" }} />

            <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center gap-8 px-5 sm:px-16 pt-20 pb-16">
              {/* Левая часть — текст */}
              <div className="flex-1 min-w-0">
                <div className={`transition-all duration-700 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                  <p className="mb-3 font-mono text-xs uppercase tracking-widest text-primary">BeGraphics · Готовая сборка</p>
                  <h1 className="mb-4 font-light leading-tight tracking-tight text-foreground" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
                    {build.name}
                  </h1>
                  {(build.tags || []).length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-2">
                      {(build.tags || []).map(t => (
                        <span key={t.id} className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${TAG_COLOR_MAP[t.color] || TAG_COLOR_MAP.primary}`}>
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Блок статуса сборки (только если есть wip) */}
                  {wipInfo && (
                    <div className="mb-5 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm p-4 max-w-lg space-y-3">
                      <div className="flex items-center gap-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${WIP_STAGE_COLORS_CLIENT[wipInfo.stage] || "bg-muted text-foreground/50"}`}>
                          {wipInfo.stage}
                        </span>
                        <span className="text-xs text-muted-foreground">Статус вашей сборки</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        {wipInfo.received_at && (
                          <div>
                            <p className="text-muted-foreground mb-0.5">Железо придёт</p>
                            <p className="text-foreground font-medium">{new Date(wipInfo.received_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</p>
                          </div>
                        )}
                        {wipInfo.issued_at && (
                          <div>
                            <p className="text-muted-foreground mb-0.5">Дата выдачи</p>
                            <p className="text-foreground font-medium">{new Date(wipInfo.issued_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</p>
                          </div>
                        )}
                      </div>
                      {wipInfo.delivery_type && (() => {
                        const info = DELIVERY_DESCRIPTIONS[wipInfo.delivery_type]
                        return (
                          <div>
                            <p className="text-foreground font-medium text-xs mb-0.5">{info?.title || wipInfo.delivery_type}</p>
                            {info?.desc && <p className="text-muted-foreground text-xs">{info.desc}</p>}
                          </div>
                        )
                      })()}
                      {/* Статусы по каждой железке */}
                      {(() => {
                        const rows = components.map(c => {
                          const wipField = SLOT_TO_WIP[c.slot]
                          if (!wipField) return null
                          const statusKey = wipInfo[`${wipField}_status` as keyof WipInfo] as string | undefined
                          if (!statusKey || statusKey === "pending") return null
                          const info = COMPONENT_STATUS_LABELS[statusKey]
                          if (!info) return null
                          return { c, info }
                        }).filter(Boolean)
                        if (!rows.length) return null
                        return (
                          <div className="pt-1 border-t border-border/40">
                            <p className="text-xs text-muted-foreground mb-2">Статус комплектующих</p>
                            <div className="space-y-1.5">
                              {rows.map((row, i) => row && (
                                <div key={i} className="flex items-center justify-between gap-2">
                                  <span className="text-xs text-foreground/70 truncate">{row.c.name}</span>
                                  <span className={`shrink-0 rounded-full px-2 py-px text-[10px] font-medium ${row.info.cls}`}>{row.info.label}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                  {build.description && (
                    <div className="mb-6 max-w-lg text-sm sm:text-base leading-relaxed text-muted-foreground rich-content" dangerouslySetInnerHTML={{ __html: build.description }} />
                  )}
                  {/* Фото — мобайл карусель */}
                  {buildImages.length > 0 && (
                    <div className="lg:hidden mb-6">
                      <BuildImageCarousel images={buildImages} autoPlay={currentSection === 0} />
                    </div>
                  )}
                  <div className="mb-6 flex flex-wrap items-end gap-4 sm:gap-6">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Итоговая стоимость</p>
                      <p className="font-bold text-foreground" style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)" }}>{fmt(calcTotalPrice)}</p>
                      {!isBaseActive && totalDiff !== 0 && (
                        <p className={`mt-1 text-sm font-semibold ${totalDiff > 0 ? "text-emerald-500" : "text-rose-500"}`}>
                          {fmtDiff(totalDiff)} к основному
                        </p>
                      )}
                    </div>
                    <div className="mb-0.5 flex flex-col gap-0.5">
                      <p className="text-xs text-muted-foreground">Железо: <span className="text-foreground/70">{fmt(calcPartsTotal)}</span></p>
                      <p className="text-xs text-muted-foreground">Сборка: <span className="text-foreground/70">{fmt(calcAssemblyFee)}</span></p>
                    </div>
                    {wipInfo && (wipInfo.prepayment_confirmed_amount ?? 0) > 0 && wipInfo.remaining_amount != null && (
                      <div className="mb-0.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
                        <p className="text-xs text-muted-foreground">Предоплата внесена: <span className="text-foreground/80 font-medium">{fmt(wipInfo.prepayment_confirmed_amount!)}</span></p>
                        <p className="text-sm font-bold text-primary">{wipInfo.stage === "Забрали" ? "Оплачено полностью" : `К доплате: ${fmt(wipInfo.remaining_amount)}`}</p>
                      </div>
                    )}
                  </div>
                  {/* Выбор варианта конфигурации — под итоговой стоимостью */}
                  {hasMultipleVariants && (
                    <div className="mb-6">
                      <p className="mb-1.5 text-xs text-muted-foreground">Вариант конфигурации</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {variants.map((_, i) => (
                          <button key={i} onClick={() => setActiveVariant(i)} style={{ cursor: "pointer" }}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${i === activeVariant ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"}`}>
                            {i === 0 ? "Основная" : `Вариант ${i + 1}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => scrollToSection(1)} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full bg-primary px-5 sm:px-7 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all">
                      Изучить состав <Icon name="ArrowDown" size={15} />
                    </button>
                    <button onClick={orderBuild} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full border border-border px-5 sm:px-7 py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all">
                      Заказать сейчас
                    </button>
                    <button onClick={editInConfigurator} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full border border-border px-5 sm:px-7 py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all">
                      <Icon name="SlidersHorizontal" size={15} /> Открыть в конфигураторе
                    </button>
                  </div>
                </div>
              </div>

              {/* Список компонентов — десктоп справа */}
              <div className={`hidden xl:block w-80 shrink-0 transition-all duration-700 delay-200 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                <p className="mb-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">Состав</p>
                <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-4 space-y-2.5">
                  {components.map((c, i) => {
                    const wipField = SLOT_TO_WIP[c.slot]
                    const statusKey = wipField ? wipInfo?.[`${wipField}_status` as keyof WipInfo] as string | undefined : undefined
                    const statusInfo = statusKey ? COMPONENT_STATUS_LABELS[statusKey] : null
                    const qty = c.qty && c.qty > 1 ? c.qty : null
                    const isDiff = activeVariant > 0 && variantDiffSlots.has(c.slot)
                    const lineTotal = (c.current_price ?? c.price) * (c.qty || 1)
                    const slotDiff = isDiff ? lineTotal - (baseSlotTotal[c.slot] || 0) : 0
                    return (
                      <div key={i} className={`flex items-start justify-between gap-3 ${isDiff ? "-mx-2 rounded-lg bg-emerald-500/10 px-2 py-1 ring-1 ring-emerald-500/40" : ""}`}>
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <span className={`w-5 h-5 mt-0.5 shrink-0 rounded flex items-center justify-center ${isDiff ? "bg-emerald-500/15 text-emerald-500" : "bg-primary/10 text-primary"}`}>
                            <ComponentIcon slot={c.slot} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground leading-none mb-0.5">{SLOT_NAMES[c.slot] || c.slot}</p>
                            <p className={`text-sm leading-snug break-words ${isDiff ? "font-semibold text-emerald-500" : "text-foreground"}`}>
                              {c.name}
                              {qty ? <span className={`ml-1.5 inline-block rounded-md px-1.5 py-0.5 text-xs font-bold align-middle ${isDiff ? "bg-emerald-500/20 text-emerald-500" : "bg-primary/15 text-primary"}`}>×{qty}</span> : null}
                            </p>
                            {statusInfo && (
                              <span className={`inline-block mt-0.5 rounded-full px-2 py-px text-[10px] font-medium ${statusInfo.cls}`}>
                                {statusInfo.label}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={`block text-sm font-medium ${isDiff ? "text-emerald-500" : "text-foreground"}`}>{fmt(lineTotal)}</span>
                          {isDiff && slotDiff !== 0 && (
                            <span className={`block text-xs font-semibold ${slotDiff > 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtDiff(slotDiff)}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 transition-all duration-500 ${currentSection === 0 ? "opacity-40" : "opacity-0"}`}>
              <p className="text-xs text-muted-foreground">Прокрутите вниз</p>
              <Icon name="ChevronDown" size={16} className="text-muted-foreground animate-bounce" />
            </div>
          </div>
        </div>

        {/* ── СЕКЦИИ 1..N: Компоненты ── */}
        {components.map((comp, idx) => (
          <div key={idx} ref={el => { sectionRefs.current[idx + 1] = el }} className="w-screen shrink-0" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
            <ComponentSection comp={comp} index={idx} total={components.length}
              active={currentSection === idx + 1}
              onNext={() => scrollToSection(idx + 2)}
              onPrev={() => scrollToSection(idx)}
            />
          </div>
        ))}

        {/* ── Последняя секция: Заказ ── */}
        <div ref={el => { sectionRefs.current[components.length + 1] = el }} className="w-screen shrink-0 relative" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(var(--primary) / 0.06) 0%, transparent 70%)" }} />
            <div className={`relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-8 pt-20 pb-8 transition-all duration-700 ${currentSection === totalSections - 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
              {buildImages.length > 0 && (
                <div className="mb-6 sm:mb-8">
                  <BuildImageCarousel images={buildImages} />
                </div>
              )}
              <div className="flex flex-col items-center text-center">
                <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">Готова к заказу</p>
                <h2 className="mb-2 font-light text-foreground" style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)" }}>{build.name}</h2>
                <p className="mb-6 text-muted-foreground text-sm">{components.length} компонентов · Сборка включена</p>
                <div className="mb-6 w-full max-w-lg flex items-center justify-center gap-4 sm:gap-8 rounded-2xl border border-border bg-card px-4 sm:px-10 py-4 sm:py-6">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">Железо</p>
                    <p className="text-base sm:text-xl font-semibold text-foreground">{fmt(calcPartsTotal)}</p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">Сборка</p>
                    <p className="text-base sm:text-xl font-semibold text-foreground">{fmt(calcAssemblyFee)}</p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">Итого</p>
                    <p className="text-xl sm:text-2xl font-bold text-primary">{fmt(calcTotalPrice)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button onClick={orderBuild} style={{ cursor: "pointer" }}
                    className="flex items-center justify-center gap-2 rounded-full bg-primary px-10 py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
                    <Icon name="ShoppingCart" size={17} />
                    Заказать сборку
                  </button>
                  {isTokenMode && !claimed && (
                    <button onClick={claimBuild} disabled={claiming} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full border border-border px-6 py-3.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all disabled:opacity-50">
                      <Icon name="Bookmark" size={16} />
                      {claiming ? "Сохраняем..." : "Сохранить в профиль"}
                    </button>
                  )}
                </div>
                <button onClick={() => scrollToSection(0)} style={{ cursor: "pointer" }}
                  className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Icon name="ArrowUp" size={12} /> Вернуться к обзору
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

// Автоматическая карусель — меняется каждые 5-7 сек, можно листать вручную
function BuildImageCarousel({ images, autoPlay = true }: { images: string[]; autoPlay?: boolean }) {
  const [idx, setIdx] = useState(0)
  const [animating, setAnimating] = useState(false)
  const [dir, setDir] = useState<1 | -1>(1)

  const goTo = (next: number, direction: 1 | -1 = 1) => {
    if (animating || images.length <= 1) return
    setDir(direction)
    setAnimating(true)
    setTimeout(() => {
      setIdx((next + images.length) % images.length)
      setAnimating(false)
    }, 350)
  }

  const prev = () => goTo(idx - 1, -1)
  const next = () => goTo(idx + 1, 1)

  // Авто-прокрутка
  useEffect(() => {
    if (!autoPlay || images.length <= 1) return
    const delay = 5000 + Math.random() * 2000
    const t = setTimeout(() => next(), delay)
    return () => clearTimeout(t)
  }, [idx, autoPlay, images.length])

  if (!images.length) return null

  const nextIdx = (idx + 1) % images.length

  return (
    <div className="relative overflow-hidden rounded-2xl bg-muted border border-border" style={{ minHeight: 220 }}>
      {/* Текущее фото */}
      <img
        key={idx}
        src={images[idx]} alt=""
        className="w-full object-contain transition-all duration-350"
        style={{
          maxHeight: "38vh",
          opacity: animating ? 0 : 1,
          transform: animating ? `translateX(${dir === 1 ? "-40px" : "40px"})` : "translateX(0)",
        }}
      />

      {images.length > 1 && (
        <>
          {/* Превью следующего — маленький справа */}
          <div className="absolute right-3 top-3 w-16 h-12 rounded-lg overflow-hidden border border-white/20 opacity-60 hover:opacity-90 transition-opacity">
            <img src={images[nextIdx]} alt="" className="w-full h-full object-cover" />
          </div>

          <button onClick={prev} style={{ cursor: "pointer" }}
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 border border-border backdrop-blur hover:bg-background hover:border-primary transition-all">
            <Icon name="ChevronLeft" size={16} />
          </button>
          <button onClick={next} style={{ cursor: "pointer" }}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 border border-border backdrop-blur hover:bg-background hover:border-primary transition-all">
            <Icon name="ChevronRight" size={16} />
          </button>

          {/* Точки */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button key={i} onClick={() => goTo(i, i > idx ? 1 : -1)} style={{ cursor: "pointer" }}
                className={`rounded-full transition-all duration-300 ${i === idx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/30 hover:bg-foreground/60"}`} />
            ))}
          </div>

          {/* Счётчик */}
          <div className="absolute top-3 left-3 rounded-full bg-black/50 backdrop-blur px-2.5 py-1 text-xs text-white/80 font-mono">
            {idx + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  )
}

// Карусель-обои для секции обзора — фото меняется каждые 6 сек
function HeroBuildCarousel({ images, active }: { images: string[]; active: boolean }) {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (images.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 6000)
    return () => clearInterval(t)
  }, [images.length])

  return (
    <div className="absolute inset-y-0 right-0 w-1/2 hidden lg:block pointer-events-none overflow-hidden">
      {images.map((src, i) => (
        <img
          key={i} src={src} alt=""
          className="absolute inset-0 h-full w-full object-contain object-right transition-opacity duration-1000"
          style={{ opacity: i === idx && active ? 1 : 0 }}
        />
      ))}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to right, hsl(var(--background)) 0%, hsl(var(--background) / 0.85) 18%, hsl(var(--background) / 0.5) 40%, hsl(var(--background) / 0.2) 62%, transparent 85%)" }} />
      {/* Точки слева снизу */}
      {images.length > 1 && (
        <div className="absolute bottom-8 left-4 flex gap-1.5 pointer-events-auto">
          {images.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{ cursor: "pointer" }}
              className={`rounded-full transition-all duration-300 ${i === idx ? "w-4 h-1.5 bg-white/70" : "w-1.5 h-1.5 bg-white/25 hover:bg-white/50"}`} />
          ))}
        </div>
      )}
    </div>
  )
}

function ComponentPhotoCarousel({ photos, name, active }: { photos: string[]; name: string; active: boolean }) {
  const [idx, setIdx] = useState(0)

  // Сброс при смене компонента
  useEffect(() => { setIdx(0) }, [name])

  // Авто-смена каждые 6 сек
  useEffect(() => {
    if (!active || photos.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % photos.length), 6000)
    return () => clearInterval(t)
  }, [active, photos.length])

  const prev = () => setIdx(i => (i - 1 + photos.length) % photos.length)
  const next = () => setIdx(i => (i + 1) % photos.length)

  return (
    <div
      className={`absolute right-0 top-0 bottom-0 hidden lg:block transition-all duration-1000 ${active ? "opacity-100 translate-x-0" : "opacity-0 translate-x-16"}`}
      style={{ width: "50%" }}
    >
      {/* Стек фото — без рамок, на весь блок, object-contain */}
      <div className="absolute inset-0">
        {photos.map((src, i) => (
          <img
            key={i} src={src} alt={name}
            className="absolute inset-0 w-full h-full object-contain transition-opacity duration-700"
            style={{ opacity: i === idx ? 1 : 0 }}
          />
        ))}
      </div>

      {/* Градиент слева — плавный переход к тексту */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "linear-gradient(to right, hsl(var(--background)) 0%, hsl(var(--background) / 0.4) 25%, transparent 55%)"
      }} />

      {/* Кнопки и точки поверх */}
      {photos.length > 1 && (
        <div className="absolute inset-0 flex flex-col justify-end pb-8 pr-6 items-end gap-3">
          <div className="flex items-center gap-2">
            <button onClick={prev} style={{ cursor: "pointer" }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-background/70 border border-border/50 backdrop-blur hover:border-primary transition-all">
              <Icon name="ChevronLeft" size={14} />
            </button>
            <button onClick={next} style={{ cursor: "pointer" }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-background/70 border border-border/50 backdrop-blur hover:border-primary transition-all">
              <Icon name="ChevronRight" size={14} />
            </button>
          </div>
          <div className="flex gap-1.5">
            {photos.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} style={{ cursor: "pointer" }}
                className={`rounded-full transition-all ${i === idx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/30 hover:bg-foreground/60"}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ComponentSection({ comp, index, total, active, onNext, onPrev }: {
  comp: Component; index: number; total: number; active: boolean; onNext: () => void; onPrev: () => void
}) {
  const price = comp.current_price ?? comp.price
  const photos = comp.image_urls?.length ? comp.image_urls : comp.image_url ? [comp.image_url] : []
  const hasPhoto = photos.length > 0

  return (
    <div className="relative flex h-full w-full items-center overflow-hidden bg-background">

      {/* Тонкий фоновый градиент */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: hasPhoto
          ? "radial-gradient(ellipse 50% 60% at 20% 50%, hsl(var(--primary) / 0.04) 0%, transparent 70%)"
          : "radial-gradient(ellipse 60% 50% at 30% 50%, hsl(var(--primary) / 0.04) 0%, transparent 70%)"
      }} />

      {/* Фото справа — компактная карусель (только десктоп) */}
      {hasPhoto && <ComponentPhotoCarousel photos={photos} name={comp.name} active={active} />}

      {/* Большой номер */}
      <div className="absolute top-16 sm:top-20 left-4 sm:left-16 pointer-events-none select-none">
        <span className="font-mono font-bold leading-none" style={{
          fontSize: "clamp(80px, 15vw, 160px)",
          color: "hsl(var(--foreground) / 0.04)"
        }}>
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      {/* Текст — слева */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-5 sm:px-16 pt-20 pb-24">
        <div className={`max-w-lg transition-all duration-700 ${active ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">
            {SLOT_NAMES[comp.slot] || comp.slot} · {index + 1} / {total}
          </p>
          <h2 className="mb-3 font-light leading-tight text-foreground" style={{ fontSize: "clamp(1.6rem, 4vw, 3.2rem)" }}>
            {comp.name}
            {comp.qty && comp.qty > 1 ? (
              <span className="ml-3 inline-block rounded-lg bg-primary/15 px-2.5 py-1 text-base sm:text-xl font-bold text-primary align-middle">×{comp.qty}</span>
            ) : null}
          </h2>
          <p className="mb-4 font-bold text-primary" style={{ fontSize: "clamp(1.3rem, 3vw, 2rem)" }}>{fmt(price)}</p>
          {comp.description && (
            <div className="mb-5 text-sm sm:text-base leading-relaxed text-muted-foreground max-w-md rich-content" dangerouslySetInnerHTML={{ __html: comp.description }} />
          )}
          {/* Мобайл — фото под текстом */}
          {hasPhoto && (
            <div className="lg:hidden mb-5">
              <div className="relative overflow-hidden rounded-xl border border-border bg-muted" style={{ aspectRatio: "16/9" }}>
                <img src={photos[0]} alt={comp.name} className="w-full h-full object-contain" />
              </div>
            </div>
          )}
          {comp.specs && Object.keys(comp.specs).length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 max-w-sm">
              {Object.entries(comp.specs).slice(0, 4).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-background/70 backdrop-blur-sm border border-border/60 px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-0.5 truncate">{k}</p>
                  <p className="text-xs sm:text-sm text-foreground font-medium truncate">{v}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Навигация */}
      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-5 transition-all duration-500 ${active ? "opacity-100" : "opacity-0"}`}>
        <button onClick={onPrev} style={{ cursor: "pointer" }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-background/70 backdrop-blur border border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-all">
          <Icon name="ChevronUp" size={16} />
        </button>
        <span className="text-xs font-mono text-muted-foreground bg-background/70 backdrop-blur px-2 py-0.5 rounded">{index + 1} / {total}</span>
        <button onClick={onNext} style={{ cursor: "pointer" }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-background/70 backdrop-blur border border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-all">
          <Icon name="ChevronDown" size={16} />
        </button>
      </div>
    </div>
  )
}

function ComponentIcon({ slot, size = 14 }: { slot: string; size?: number }) {
  const icons: Record<string, string> = {
    cpu: "Cpu", gpu: "Monitor", ram: "MemoryStick", storage: "HardDrive",
    psu: "Zap", case: "Box", motherboard: "CircuitBoard",
  }
  return <Icon name={icons[slot] || "Package"} size={size} />
}