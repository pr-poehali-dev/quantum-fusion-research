import { useEffect, useRef, useState, useCallback } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "Оперативная память",
  storage: "Накопитель", psu: "Блок питания", case: "Корпус", motherboard: "Материнская плата",
}

interface Component {
  slot: string; name: string; price: number; current_price?: number
  source_id?: number; image_url?: string; description?: string; specs?: Record<string, string>
}

interface Build {
  id: number; name: string; description: string; components: Component[]
  parts_total: number; assembly_fee: number; total_price: number
  assembly_type: string; client_token: string | null; client_user_id: number | null; image_urls: string[]
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

export default function ClientBuild() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isAuthed, sessionId, user } = useAuth()
  const { addItem } = useCart()

  const token = searchParams.get("token")

  // Все варианты сборки по одному токену
  const [variants, setVariants] = useState<Build[]>([])
  const [activeVariant, setActiveVariant] = useState(0)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [enrichedComponents, setEnrichedComponents] = useState<Component[]>([])
  const [currentSection, setCurrentSection] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const wheelLockRef = useRef(false)
  const touchStartY = useRef(0)
  const touchStartX = useRef(0)

  useEffect(() => {
    if (!token) { setError("Ссылка недействительна"); setLoading(false); return }
    api.builds.getByClientToken(token).then(async (data) => {
      if (data.error) { setError(data.error); setLoading(false); return }

      // Бэкенд может вернуть один объект или массив — нормализуем
      const list: Build[] = Array.isArray(data) ? data : [data]
      setVariants(list)

      const b = list[0]
      if (b.client_user_id && user && b.client_user_id === user.id) setClaimed(true)
      setEnrichedComponents(enrichComponents(b.components))
      setLoading(false)
    }).catch(() => { setError("Не удалось загрузить сборку"); setLoading(false) })
  }, [token, user])

  // При смене варианта — обновляем компоненты и прокручиваем к секции обзора
  useEffect(() => {
    if (!variants[activeVariant]) return
    setEnrichedComponents(enrichComponents(variants[activeVariant].components))
    const offset = variants.length > 1 ? 1 : 0
    setCurrentSection(offset)
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: window.innerHeight * offset, behavior: "smooth" })
    }
  }, [activeVariant, variants])

  function enrichComponents(comps: (Component & { product_description?: string; product_images?: string[] })[]) {
    return comps.map(c => ({
      ...c,
      description: c.description || c.product_description || undefined,
      image_url: c.image_url || (c.product_images && c.product_images[0]) || undefined,
    }))
  }

  const build = variants[activeVariant] ?? null
  const components = enrichedComponents.length > 0 ? enrichedComponents : (build?.components || [])
  // Если несколько вариантов — добавляем вводную секцию (секция 0)
  const hasMultipleVariants = variants.length > 1
  const introOffset = hasMultipleVariants ? 1 : 0
  const totalSections = components.length + 2 + introOffset

  const scrollToSection = useCallback((index: number) => {
    if (index < 0 || index >= totalSections || isTransitioning) return
    setIsTransitioning(true)
    setCurrentSection(index)
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: window.innerHeight * index, behavior: "smooth" })
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
      // Горизонтальный свайп — переключаем вариант (только если вариантов > 1)
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60) {
        if (deltaX > 0) setActiveVariant(i => Math.min(i + 1, variants.length - 1))
        else setActiveVariant(i => Math.max(i - 1, 0))
        return
      }
      if (Math.abs(deltaY) > 50) {
        if (deltaY > 0) scrollToSection(currentSection + 1)
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
  }, [currentSection, scrollToSection])

  const claimBuild = async () => {
    if (!isAuthed() || !sessionId) { navigate(`/auth?redirect=/build?token=${token}`); return }
    setClaiming(true)
    await api.builds.claimBuild(token!, sessionId)
    setClaimed(true)
    setClaiming(false)
  }

  const orderBuild = () => {
    if (!build) return
    addItem({ id: build.id, name: build.name, price: build.total_price, type: "config" })
    navigate("/cart")
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Загружаем вашу сборку...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <Icon name="LinkOff" size={48} className="mb-4 text-muted-foreground/40" />
      <h1 className="mb-2 text-xl font-medium text-foreground">{error}</h1>
      <p className="mb-6 text-sm text-muted-foreground">Возможно ссылка устарела или была деактивирована</p>
      <button onClick={() => navigate("/")} className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        На главную
      </button>
    </div>
  )

  if (!build) return null

  const buildImages = build.image_urls || []

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">

      {/* Точки навигации */}
      <nav className="fixed right-4 top-1/2 z-50 -translate-y-1/2 hidden sm:flex flex-col gap-2.5">
        {Array.from({ length: totalSections }).map((_, i) => (
          <button key={i} onClick={() => scrollToSection(i)} style={{ cursor: "pointer" }}
            className={`rounded-full transition-all duration-300 ${i === currentSection ? "h-6 w-2 bg-primary" : "h-2 w-2 bg-foreground/20 hover:bg-foreground/40"}`}
          />
        ))}
      </nav>

      {/* Хедер */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-8 py-3 bg-background/80 backdrop-blur-sm border-b border-border/50">
        <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">B</div>
          <span className="hidden sm:block text-sm font-medium text-foreground/80">BeGraphics</span>
        </button>

        {/* Счётчик вариантов — по центру */}
        {variants.length > 1 && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/80 backdrop-blur px-3 py-1.5">
            <Icon name="GitBranch" size={12} className="text-primary" />
            <span className="text-xs text-muted-foreground">
              Вариант <span className="font-semibold text-foreground">{activeVariant + 1}</span> из {variants.length}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {claimed ? (
            <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">
              <Icon name="Check" size={12} /> Сохранено
            </span>
          ) : (
            <button onClick={claimBuild} disabled={claiming} style={{ cursor: "pointer" }}
              className="hidden sm:block rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all">
              {claiming ? "Сохранение..." : "Сохранить в профиль"}
            </button>
          )}
          <button onClick={orderBuild} style={{ cursor: "pointer" }}
            className="rounded-full bg-primary px-4 sm:px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            <span className="hidden sm:inline">Заказать — </span>{fmt(build.total_price)}
          </button>
        </div>
      </header>

      <div ref={scrollContainerRef} className="h-screen w-screen overflow-y-hidden" style={{ scrollSnapType: "y mandatory" }}>

        {/* ── ВВОДНАЯ СЕКЦИЯ: показывается только если вариантов > 1 ── */}
        {hasMultipleVariants && (
          <div className="h-screen w-screen shrink-0 relative flex flex-col items-center justify-center px-6 text-center" style={{ scrollSnapAlign: "start" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 60% at 50% 50%, hsl(var(--primary) / 0.07) 0%, transparent 70%)" }} />
            <div className={`relative z-10 transition-all duration-700 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
              <div className="mb-6 flex items-center justify-center gap-2">
                <div className="h-px w-12 bg-primary/40" />
                <span className="font-mono text-xs uppercase tracking-widest text-primary">Варианты сборки</span>
                <div className="h-px w-12 bg-primary/40" />
              </div>
              <h1 className="mb-4 font-light text-foreground" style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", lineHeight: 1.1 }}>
                Для вас подготовлено<br />
                <span className="text-primary">{variants.length} варианта</span> сборки
              </h1>
              <p className="mb-10 max-w-md text-sm sm:text-base leading-relaxed text-muted-foreground mx-auto">
                Листайте вниз чтобы посмотреть первый вариант.<br />
                Листайте вправо или свайпайте влево/вправо чтобы переключаться между вариантами.
              </p>
              {/* Превью вариантов */}
              <div className="flex items-stretch justify-center gap-3 mb-10 flex-wrap">
                {variants.map((v, i) => (
                  <button
                    key={v.id}
                    onClick={() => { setActiveVariant(i); scrollToSection(introOffset) }}
                    style={{ cursor: "pointer" }}
                    className={`flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-all ${i === activeVariant ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/50"}`}
                  >
                    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Вариант {i + 1}{i === 0 ? " · Рекомендуемый" : ""}</span>
                    <span className="text-sm font-medium text-foreground">{v.name}</span>
                    <span className="text-xs text-primary font-semibold">{fmt(v.total_price)}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => scrollToSection(introOffset)}
                style={{ cursor: "pointer" }}
                className="flex items-center gap-2 mx-auto rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Icon name="ArrowDown" size={15} />
                Смотреть первый вариант
              </button>
            </div>
            {/* Подсказка скролла */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 animate-bounce opacity-50">
              <Icon name="ChevronDown" size={16} className="text-muted-foreground" />
            </div>
          </div>
        )}

        {/* ── СЕКЦИЯ обзора (0 или 1 в зависимости от наличия intro) ── */}
        <div className="h-screen w-screen shrink-0 relative" style={{ scrollSnapAlign: "start" }}>
          <div className="relative flex h-full w-full overflow-hidden">

            {/* Фото сборки — справа, полная высота */}
            {buildImages.length > 0 && (
              <div className="absolute inset-y-0 right-0 w-1/2 hidden lg:block pointer-events-none">
                <img src={buildImages[0]} alt={build.name} className="h-full w-full object-contain object-right" />
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/50 to-transparent" />
              </div>
            )}
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 60% at 30% 50%, hsl(var(--primary) / 0.05) 0%, transparent 70%)" }} />

            {/* Баннер */}
            <div className={`absolute top-20 left-0 right-0 px-5 sm:px-16 z-10 transition-all duration-500 ${currentSection === introOffset ? "opacity-100" : "opacity-0"}`}>
              <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 max-w-md">
                <Icon name="Sparkles" size={15} className="text-primary shrink-0" />
                <p className="text-xs text-foreground/70">Персональная сборка, подготовлена специально для вас</p>
              </div>
            </div>

            {/* Стрелки переключения вариантов — только если вариантов > 1 */}
            {variants.length > 1 && (
              <>
                <button
                  onClick={() => setActiveVariant(i => Math.max(i - 1, 0))}
                  disabled={activeVariant === 0}
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-background/80 backdrop-blur border border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-all disabled:opacity-20"
                  style={{ cursor: activeVariant === 0 ? "default" : "pointer" }}>
                  <Icon name="ChevronLeft" size={18} />
                </button>
                <button
                  onClick={() => setActiveVariant(i => Math.min(i + 1, variants.length - 1))}
                  disabled={activeVariant === variants.length - 1}
                  className="absolute right-14 sm:right-20 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-background/80 backdrop-blur border border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-all disabled:opacity-20"
                  style={{ cursor: activeVariant === variants.length - 1 ? "default" : "pointer" }}>
                  <Icon name="ChevronRight" size={18} />
                </button>
                {/* Индикатор точек вариантов */}
                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
                  {variants.map((_, i) => (
                    <button key={i} onClick={() => setActiveVariant(i)} style={{ cursor: "pointer" }}
                      className={`rounded-full transition-all ${i === activeVariant ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/20 hover:bg-foreground/40"}`} />
                  ))}
                </div>
              </>
            )}

            <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center gap-8 px-5 sm:px-16 pt-32 pb-16">
              <div className="flex-1 min-w-0">
                <div className={`transition-all duration-700 ${currentSection === introOffset ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                  <p className="mb-3 font-mono text-xs uppercase tracking-widest text-primary">Персональная сборка · BeGraphics</p>
                  <h1 className="mb-4 font-light leading-tight tracking-tight text-foreground" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
                    {build.name}
                  </h1>
                  {build.description && (
                    <p className="mb-6 max-w-lg text-sm sm:text-base leading-relaxed text-muted-foreground">{build.description}</p>
                  )}
                  {buildImages.length > 0 && (
                    <div className="lg:hidden mb-6">
                      <img src={buildImages[0]} alt={build.name} className="w-full rounded-2xl object-contain max-h-52 border border-border bg-muted" />
                    </div>
                  )}
                  <div className="mb-6 flex flex-wrap items-end gap-4 sm:gap-6">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Итоговая стоимость</p>
                      <p className="font-bold text-foreground" style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)" }}>{fmt(build.total_price)}</p>
                    </div>
                    <div className="mb-0.5 flex flex-col gap-0.5">
                      <p className="text-xs text-muted-foreground">Железо: <span className="text-foreground/70">{fmt(build.parts_total)}</span></p>
                      <p className="text-xs text-muted-foreground">Сборка: <span className="text-foreground/70">{fmt(build.assembly_fee)}</span></p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => scrollToSection(introOffset + 1)} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full bg-primary px-5 sm:px-7 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all">
                      Изучить подробнее <Icon name="ArrowDown" size={15} />
                    </button>

                    <button onClick={orderBuild} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full border border-border px-5 sm:px-7 py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all">
                      Заказать сейчас
                    </button>
                  </div>
                </div>
              </div>

              {/* Список компонентов — десктоп */}
              <div className={`hidden xl:block w-80 shrink-0 transition-all duration-700 delay-200 ${currentSection === introOffset ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                <p className="mb-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">Состав</p>
                <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-4 space-y-2.5">
                  {components.map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 shrink-0 rounded flex items-center justify-center bg-primary/10 text-primary">
                          <ComponentIcon slot={c.slot} />
                        </span>
                        <div className="min-w-0">
                          <p className="hidden sm:block text-xs text-muted-foreground leading-none mb-0.5">{SLOT_NAMES[c.slot] || c.slot}</p>
                          <p className="text-sm text-foreground truncate">{c.name}</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-medium text-foreground">{fmt(c.current_price ?? c.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 transition-all duration-500 ${currentSection === introOffset ? "opacity-40" : "opacity-0"}`}>
              <p className="text-xs text-muted-foreground">Прокрутите вниз</p>
              <Icon name="ChevronDown" size={16} className="text-muted-foreground animate-bounce" />
            </div>
          </div>
        </div>

        {/* ── СЕКЦИИ компонентов ── */}
        {components.map((comp, idx) => (
          <div key={`${build.id}-${idx}`} className="h-screen w-screen shrink-0" style={{ scrollSnapAlign: "start" }}>
            <ComponentSection comp={comp} index={idx} total={components.length}
              active={currentSection === idx + 1 + introOffset}
              onNext={() => scrollToSection(idx + 2 + introOffset)}
              onPrev={() => scrollToSection(idx + introOffset)}
            />
          </div>
        ))}

        {/* ── Последняя секция: Заказ ── */}
        <div className="h-screen w-screen shrink-0 relative" style={{ scrollSnapAlign: "start" }}>
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(var(--primary) / 0.06) 0%, transparent 70%)" }} />
            <div className={`relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-8 pt-20 pb-8 transition-all duration-700 ${currentSection === totalSections - 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>

              {buildImages.length > 0 && (
                <div className="mb-6 sm:mb-8">
                  <BuildImageCarousel images={buildImages} />
                </div>
              )}

              <div className="flex flex-col items-center text-center">
                <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">Готово к заказу</p>
                <h2 className="mb-2 font-light text-foreground" style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)" }}>{build.name}</h2>
                <p className="mb-6 text-muted-foreground text-sm">{components.length} компонентов · Сборка включена</p>

                <div className="mb-6 w-full max-w-lg flex items-center justify-center gap-4 sm:gap-8 rounded-2xl border border-border bg-card px-4 sm:px-10 py-4 sm:py-6">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">Железо</p>
                    <p className="text-base sm:text-xl font-semibold text-foreground">{fmt(build.parts_total)}</p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">Сборка</p>
                    <p className="text-base sm:text-xl font-semibold text-foreground">{fmt(build.assembly_fee)}</p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">Итого</p>
                    <p className="text-xl sm:text-2xl font-bold text-primary">{fmt(build.total_price)}</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm sm:max-w-none sm:justify-center">
                  <button onClick={orderBuild} style={{ cursor: "pointer" }}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-full bg-primary px-8 sm:px-10 py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
                    <Icon name="ShoppingCart" size={17} />
                    Оформить заказ
                  </button>
                  {!claimed && (
                    <button onClick={claimBuild} disabled={claiming} style={{ cursor: "pointer" }}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-full border border-border px-7 py-3.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all">
                      <Icon name="BookmarkPlus" size={15} />
                      {claiming ? "Сохранение..." : "Сохранить в профиль"}
                    </button>
                  )}
                </div>
                {claimed && (
                  <p className="mt-4 flex items-center gap-1.5 text-sm text-primary">
                    <Icon name="Check" size={14} /> Сборка сохранена в профиле
                  </p>
                )}
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

function BuildImageCarousel({ images }: { images: string[] }) {
  const [idx, setIdx] = useState(0)
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
      <img src={images[idx]} alt="" className="w-full object-contain rounded-2xl" style={{ maxHeight: "38vh" }} />
      {images.length > 1 && (
        <>
          <button onClick={() => setIdx(i => (i - 1 + images.length) % images.length)} style={{ cursor: "pointer" }}
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 border border-border backdrop-blur hover:bg-background transition-all">
            <Icon name="ChevronLeft" size={16} />
          </button>
          <button onClick={() => setIdx(i => (i + 1) % images.length)} style={{ cursor: "pointer" }}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 border border-border backdrop-blur hover:bg-background transition-all">
            <Icon name="ChevronRight" size={16} />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} style={{ cursor: "pointer" }}
                className={`rounded-full transition-all ${i === idx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/30"}`} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ComponentSection({ comp, index, total, active, onNext, onPrev }: {
  comp: Component; index: number; total: number; active: boolean; onNext: () => void; onPrev: () => void
}) {
  const price = comp.current_price ?? comp.price
  return (
    <div className="relative flex h-full w-full items-center overflow-hidden bg-background">

      {/* Фото — на весь фон */}
      {comp.image_url && (
        <div className={`absolute inset-0 transition-all duration-1000 ${active ? "opacity-100 scale-100" : "opacity-0 scale-105"}`}>
          <img src={comp.image_url} alt={comp.name}
            className="h-full w-full object-cover object-center"
            style={{ filter: "brightness(0.75)" }}
          />
          <div className="absolute inset-0" style={{
            background: "linear-gradient(to right, var(--tw-gradient-from, hsl(var(--background))) 35%, hsl(var(--background) / 0.6) 60%, transparent 100%)"
          }} />
          <div className="absolute inset-0 bg-gradient-to-t from-background/60 via-transparent to-transparent" />
        </div>
      )}
      {!comp.image_url && (
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 50% at 30% 50%, hsl(var(--primary) / 0.04) 0%, transparent 70%)" }} />
      )}

      {/* Большой номер */}
      <div className="absolute top-16 sm:top-20 left-4 sm:left-16 pointer-events-none select-none">
        <span className="font-mono font-bold leading-none" style={{
          fontSize: "clamp(80px, 15vw, 160px)",
          color: comp.image_url ? "rgba(255,255,255,0.06)" : "hsl(var(--foreground) / 0.04)"
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
          </h2>
          <p className="mb-5 font-bold text-primary" style={{ fontSize: "clamp(1.3rem, 3vw, 2rem)" }}>{fmt(price)}</p>
          {comp.description && (
            <p className="mb-5 text-sm sm:text-base leading-relaxed text-muted-foreground">{comp.description}</p>
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