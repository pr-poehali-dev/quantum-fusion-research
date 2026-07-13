import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { useParams, useSearchParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"
import Seo, { SITE_URL } from "@/components/Seo"
import PromoBanner from "@/components/PromoBanner"
import {
  Component, Build, WipInfo,
  SLOT_NAMES, SLOT_TO_WIP, COMPONENT_STATUS_LABELS, DELIVERY_DESCRIPTIONS,
  WIP_STAGE_COLORS_CLIENT, TAG_COLOR_MAP,
  compPoints, withVat, fmt, enrichVariants,
} from "./build-preview/shared"
import {
  BuildImageCarousel, HeroBuildCarousel, BuildShowcaseSlide,
  ComponentSection, ComponentIcon,
} from "./build-preview/components"

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
  const [tagsExpanded, setTagsExpanded] = useState(false)
  // На телефоне (<640px) добавляется отдельный слайд «Состав» (список) между
  // обзором и покомпонентными секциями → индексы секций сдвигаются.
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)")
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
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

  // При смене варианта (компоненты уже обогащены при загрузке списка).
  // НЕ сбрасываем на титульный слайд — пользователь остаётся на текущем.
  useEffect(() => {
    const v = variants[activeVariant]
    if (!v) return
    setComponents(v.components || [])
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
  // Новый первый слайд «Витрина» (фото ПК с подписями по бокам) — только для
  // десктопа, при наличии фото И если у железок заданы точки на фото (в админке).
  // На телефоне и без заданных точек слайд пропускается, сразу показываем обзор.
  // introOffset сдвигает индексы всех остальных секций на +1, когда витрина есть.
  const heroImages = build?.image_urls || []
  const hasHotspots = components.some(c => compPoints(c).length > 0)
  const introOffset = (!isMobile && heroImages.length > 0 && hasHotspots) ? 1 : 0
  // Смещение индекса первого компонента: на ПК сразу после обзора,
  // на телефоне после обзора и слайда «Состав». Плюс витрина (introOffset).
  const compOffset = (isMobile ? 2 : 1) + introOffset
  const totalSections = components.length + (isMobile ? 3 : 2) + introOffset

  // Метка текущего слайда — для верхней панели на телефоне (экономит место в теле).
  const sectionLabel = (() => {
    if (introOffset && currentSection === 0) return "Витрина"
    if (currentSection === introOffset) return "Обзор"
    if (currentSection === totalSections - 1) return "Заказ"
    if (isMobile && currentSection === introOffset + 1) return "Состав"
    const comp = components[currentSection - compOffset]
    return comp ? (SLOT_NAMES[comp.slot] || comp.slot) : ""
  })()

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
        // Если свайп идёт внутри прокручиваемой секции (напр. «Состав») и она ещё
        // может прокручиваться в нужную сторону — отдаём жест нативному скроллу,
        // не переключаем секцию (иначе длинный список «улистывается» и низ не виден).
        const scrollable = (e.target as HTMLElement)?.closest?.("[data-scrollable]") as HTMLElement | null
        if (scrollable) {
          const atTop = scrollable.scrollTop <= 1
          const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1
          if (delta > 0 && !atBottom) return  // ещё есть куда скроллить вниз
          if (delta < 0 && !atTop) return     // ещё есть куда скроллить вверх
        }
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
  }, [components.length, isMobile])

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

  // Назад — возвращаемся на предыдущую страницу (категорию/каталог, откуда пришли).
  // Если истории нет (открыли по прямой ссылке) — разумный fallback.
  const goBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate(isTokenMode ? "/" : "/builds")
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
      <button onClick={goBack} className="mt-6 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        Назад
      </button>
    </div>
  )

  const buildImages = build.image_urls || []

  return (
    <div className="relative w-screen overflow-hidden bg-background text-foreground" style={{ height: "100dvh", overscrollBehavior: "none" }}>
      <Seo
        title={build.name}
        description={`Готовая сборка ПК «${build.name}»: ${components.length} комплектующих, сборка и настройка включены. Итоговая цена ${calcTotalPrice.toLocaleString("ru-RU")} ₽.`}
        image={buildImages[0]}
        path={`/build-preview/${build.id}`}
        type="product"
        noindex={isTokenMode}
        jsonLd={isTokenMode ? undefined : {
          "@context": "https://schema.org",
          "@type": "Product",
          name: build.name,
          image: buildImages,
          description: `Готовая сборка ПК «${build.name}» с профессиональной сборкой и настройкой.`,
          brand: { "@type": "Brand", name: "BeGraphics" },
          offers: {
            "@type": "Offer",
            price: Math.round(calcTotalPrice),
            priceCurrency: "RUB",
            availability: "https://schema.org/InStock",
            url: `${SITE_URL}/build-preview/${build.id}`,
          },
        }}
      />

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
          <button onClick={goBack} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={16} />
            <span className="text-sm hidden sm:inline">Назад</span>
          </button>
        </div>
        {/* Метка текущего слайда — по центру, только телефон */}
        {sectionLabel && (
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate max-w-[45%] text-center font-mono text-xs uppercase tracking-widest text-muted-foreground sm:hidden">
            {sectionLabel}
          </span>
        )}
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
            className="btn-tilt rounded-full bg-primary px-4 sm:px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            <span className="hidden sm:inline">Заказать — </span>{fmt(calcTotalPrice)}
          </button>
        </div>
      </header>

      <div ref={scrollContainerRef} className="w-screen overflow-y-hidden" style={{ scrollSnapType: "y mandatory", height: "100dvh", overscrollBehavior: "none", touchAction: "none" }}>

        {/* ── СЕКЦИЯ «Витрина» — новый первый слайд: фото ПК на весь экран
              с плавно появляющимися подписями комплектующих и стрелками ── */}
        {introOffset > 0 && (
          <div ref={el => { sectionRefs.current[0] = el }} className="w-screen shrink-0 relative" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
            <BuildShowcaseSlide
              images={buildImages}
              components={components}
              active={currentSection === 0}
              buildName={build.name}
              onNext={() => scrollToSection(1)}
            />
          </div>
        )}

        {/* ── СЕКЦИЯ: Обзор ── */}
        <div ref={el => { sectionRefs.current[introOffset] = el }} className="w-screen shrink-0 relative" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
          <div className="relative flex h-full w-full overflow-hidden">

            {/* Карусель фото сборки — справа, автосмена */}
            {buildImages.length > 0 && (
              <HeroBuildCarousel images={buildImages} active={currentSection === introOffset} />
            )}
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 60% at 30% 50%, hsl(var(--primary) / 0.05) 0%, transparent 70%)" }} />

            <div className="relative z-10 mx-auto flex w-full max-w-7xl items-start gap-8 px-5 sm:px-16 pt-24 pb-16 sm:items-center sm:pt-20">
              {/* Левая часть — текст */}
              <div className="flex-1 min-w-0">
                <div className={`transition-all duration-700 ${currentSection === introOffset ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                  {/* Мобайл: фото сборки первым блоком */}
                  {buildImages.length > 0 && (
                    <div className="mb-5 sm:hidden">
                      <BuildImageCarousel images={buildImages} autoPlay={currentSection === introOffset} />
                    </div>
                  )}
                  <p className="mb-3 font-mono text-xs uppercase tracking-widest text-primary">BeGraphics · Готовая сборка</p>
                  <h1 className="mb-4 font-light leading-tight tracking-tight text-foreground" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
                    {build.name}
                  </h1>
                  {(build.tags || []).length > 0 && (
                    <>
                      {/* Десктоп — все теги */}
                      <div className="mb-4 hidden flex-wrap gap-2 sm:flex">
                        {(build.tags || []).map(t => (
                          <span key={t.id} className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${TAG_COLOR_MAP[t.color] || TAG_COLOR_MAP.primary}`}>
                            {t.name}
                          </span>
                        ))}
                      </div>
                      {/* Мобайл — сжатые теги: первые 3 + «Посмотреть все» */}
                      <div className="mb-4 flex flex-wrap items-center gap-1.5 sm:hidden">
                        {(tagsExpanded ? (build.tags || []) : (build.tags || []).slice(0, 3)).map(t => (
                          <span key={t.id} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TAG_COLOR_MAP[t.color] || TAG_COLOR_MAP.primary}`}>
                            {t.name}
                          </span>
                        ))}
                        {!tagsExpanded && (build.tags || []).length > 3 && (
                          <button onClick={() => setTagsExpanded(true)} style={{ cursor: "pointer" }}
                            className="inline-flex items-center gap-0.5 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-foreground/60 hover:text-foreground hover:border-primary transition-colors">
                            Посмотреть все +{(build.tags || []).length - 3}
                          </button>
                        )}
                      </div>
                    </>
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
                  {/* Фото — карусель для планшета (на телефоне фото уже сверху) */}
                  {buildImages.length > 0 && (
                    <div className="mb-6 hidden sm:block lg:hidden">
                      <BuildImageCarousel images={buildImages} autoPlay={currentSection === introOffset} />
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
                  {/* Акция на эту сборку (если есть публичная) */}
                  {id && /^\d+$/.test(id) && (
                    <div className="mb-6"><PromoBanner buildId={Number(id)} /></div>
                  )}
                  {/* Выбор варианта конфигурации — под итоговой стоимостью.
                      На телефоне скрыт: выбор есть на слайде «Состав». */}
                  {hasMultipleVariants && (
                    <div className="mb-6 hidden sm:block">
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
                    <button onClick={() => scrollToSection(introOffset + 1)} style={{ cursor: "pointer" }}
                      className="btn-tilt flex items-center gap-2 rounded-full bg-primary px-5 sm:px-7 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all">
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
              <div className={`hidden xl:block w-80 shrink-0 transition-all duration-700 delay-200 ${currentSection === introOffset ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
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

            <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 transition-all duration-500 ${currentSection === introOffset ? "opacity-40" : "opacity-0"}`}>
              <p className="text-xs text-muted-foreground">Прокрутите вниз</p>
              <Icon name="ChevronDown" size={16} className="text-muted-foreground animate-bounce" />
            </div>
          </div>
        </div>

        {/* ── СЕКЦИЯ «Состав» — ТОЛЬКО телефон (после обзора, список) ── */}
        {isMobile && (
          <div ref={el => { sectionRefs.current[introOffset + 1] = el }} data-scrollable className="w-screen shrink-0 relative overflow-y-auto overscroll-contain" style={{ scrollSnapAlign: "start", height: "100dvh", touchAction: "pan-y", overscrollBehavior: "contain" }}>
            <div className="relative flex min-h-full w-full flex-col px-5 pt-20 pb-28">
              <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-4 space-y-2.5">
                {components.map((c, i) => {
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

              {/* ИТОГ */}
              <div className="mt-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Железо</span>
                  <span className="font-medium text-foreground">{fmt(calcPartsTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Сборка</span>
                  <span className="font-medium text-foreground">{fmt(calcAssemblyFee)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-primary/20 pt-2">
                  <span className="text-sm font-semibold text-foreground">Итого</span>
                  <span className="text-lg font-bold text-primary">{fmt(calcTotalPrice)}</span>
                </div>
              </div>

              {/* Вариации конфигурации — под итогом */}
              {hasMultipleVariants && (
                <div className="mt-3">
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
            </div>
          </div>
        )}

        {/* ── СЕКЦИИ: покомпонентные ── */}
        {components.map((comp, idx) => (
          <div key={idx} ref={el => { sectionRefs.current[idx + compOffset] = el }} className="w-screen shrink-0" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
            <ComponentSection comp={comp} index={idx} total={components.length}
              active={currentSection === idx + compOffset}
              onNext={() => scrollToSection(idx + compOffset + 1)}
              onPrev={() => scrollToSection(idx + compOffset - 1)}
            />
          </div>
        ))}

        {/* ── Последняя секция: Заказ ── */}
        <div ref={el => { sectionRefs.current[totalSections - 1] = el }} className="w-screen shrink-0 relative" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
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
                    className="btn-tilt flex items-center justify-center gap-2 rounded-full bg-primary px-10 py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
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