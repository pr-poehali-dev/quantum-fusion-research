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
  source_id?: number; image_url?: string; image_urls?: string[]; description?: string; specs?: Record<string, string>
}

interface Build {
  id: number; name: string; description: string; components: Component[]
  parts_total: number; assembly_fee: number; total_price: number
  assembly_type: string; client_token: string | null; client_user_id: number | null; image_urls: string[]
  parent_id: number | null
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

// ── Карусель фото сборки справа на hero (без рамки, на весь блок) ──
function HeroBuildCarousel({ images, active }: { images: string[]; active: boolean }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!active || images.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 6000)
    return () => clearInterval(t)
  }, [active, images.length])

  return (
    <div
      className={`absolute right-0 top-0 bottom-0 hidden lg:block transition-all duration-1000 ${active ? "opacity-100 translate-x-0" : "opacity-0 translate-x-16"}`}
      style={{ width: "50%" }}
    >
      <div className="absolute inset-0">
        {images.map((src, i) => (
          <img key={i} src={src} alt=""
            className="absolute inset-0 w-full h-full object-contain transition-opacity duration-700"
            style={{ opacity: i === idx ? 1 : 0 }}
          />
        ))}
      </div>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "linear-gradient(to right, hsl(var(--background)) 0%, hsl(var(--background) / 0.4) 25%, transparent 55%)"
      }} />
      {images.length > 1 && (
        <div className="absolute bottom-8 right-6 flex gap-1.5">
          {images.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{ cursor: "pointer" }}
              className={`rounded-full transition-all ${i === idx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/30 hover:bg-foreground/60"}`} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Карусель фото для финальной секции ──
function BuildImageCarousel({ images, autoPlay }: { images: string[]; autoPlay?: boolean }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!autoPlay || images.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 5000 + Math.random() * 2000)
    return () => clearInterval(t)
  }, [autoPlay, images.length])
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length)
  const next = () => setIdx(i => (i + 1) % images.length)
  if (!images.length) return null
  return (
    <div className="relative overflow-hidden rounded-2xl bg-muted" style={{ aspectRatio: "16/7" }}>
      {images.map((src, i) => (
        <img key={i} src={src} alt="" className="absolute inset-0 h-full w-full object-contain transition-opacity duration-700"
          style={{ opacity: i === idx ? 1 : 0 }} />
      ))}
      {images.length > 1 && (
        <>
          <button onClick={prev} style={{ cursor: "pointer" }}
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 border border-border/50 backdrop-blur hover:border-primary transition-all">
            <Icon name="ChevronLeft" size={16} />
          </button>
          <button onClick={next} style={{ cursor: "pointer" }}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 border border-border/50 backdrop-blur hover:border-primary transition-all">
            <Icon name="ChevronRight" size={16} />
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} style={{ cursor: "pointer" }}
                className={`rounded-full transition-all ${i === idx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/40 hover:bg-foreground/70"}`} />
            ))}
          </div>
          <div className="absolute top-3 left-3 rounded-full bg-background/70 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur">
            {idx + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  )
}

// ── Карусель фото компонента (справа, на весь блок) ──
function ComponentPhotoCarousel({ photos, name, active }: { photos: string[]; name: string; active: boolean }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => { setIdx(0) }, [name])
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
      <div className="absolute inset-0">
        {photos.map((src, i) => (
          <img key={i} src={src} alt={name}
            className="absolute inset-0 w-full h-full object-contain transition-opacity duration-700"
            style={{ opacity: i === idx ? 1 : 0 }}
          />
        ))}
      </div>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "linear-gradient(to right, hsl(var(--background)) 0%, hsl(var(--background) / 0.4) 25%, transparent 55%)"
      }} />
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

// ── Иконка слота ──
function ComponentIcon({ slot }: { slot: string }) {
  const icons: Record<string, string> = {
    cpu: "Cpu", gpu: "Monitor", ram: "MemoryStick", storage: "HardDrive",
    psu: "Zap", case: "Box", motherboard: "CircuitBoard",
  }
  return <Icon name={icons[slot] || "Package"} size={12} />
}

// ── Секция компонента ──
function ComponentSection({ comp, index, total, active, onNext, onPrev }: {
  comp: Component; index: number; total: number; active: boolean; onNext: () => void; onPrev: () => void
}) {
  const photos = comp.image_urls?.length ? comp.image_urls : (comp.image_url ? [comp.image_url] : [])
  return (
    <div className="relative h-full w-full overflow-hidden flex items-center">
      {photos.length > 0 && <ComponentPhotoCarousel photos={photos} name={comp.name} active={active} />}
      <div className={`absolute inset-0 pointer-events-none ${photos.length === 0 ? "hidden" : ""}`}
        style={{ background: "radial-gradient(ellipse 60% 80% at 20% 50%, hsl(var(--primary) / 0.04) 0%, transparent 70%)" }} />

      <div className={`relative z-10 w-full max-w-xl px-5 sm:px-16 pt-20 pb-16 transition-all duration-700 ${active ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"}`}>
        <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">
          {index + 1} / {total} · {SLOT_NAMES[comp.slot] || comp.slot}
        </p>
        <h2 className="mb-3 font-light leading-tight text-foreground" style={{ fontSize: "clamp(1.4rem, 3.5vw, 2.5rem)" }}>
          {comp.name}
        </h2>
        {comp.description && (
          <p className="mb-5 text-sm leading-relaxed text-muted-foreground whitespace-pre-line max-w-md">{comp.description}</p>
        )}
        {comp.specs && Object.keys(comp.specs).length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-2 max-w-sm">
            {Object.entries(comp.specs).slice(0, 6).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-card border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground truncate">{k}</p>
                <p className="text-sm font-medium text-foreground truncate">{v}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-1">Стоимость</p>
          <p className="text-2xl font-bold text-foreground">{fmt(comp.current_price ?? comp.price)}</p>
        </div>

        {/* Фото — мобайл */}
        {photos.length > 0 && (
          <div className="lg:hidden mb-6 rounded-xl overflow-hidden border border-border bg-muted" style={{ aspectRatio: "4/3" }}>
            <img src={photos[0]} alt={comp.name} className="h-full w-full object-contain" />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={onPrev} style={{ cursor: "pointer" }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-primary hover:text-foreground transition-all">
            <Icon name="ArrowUp" size={16} />
          </button>
          <button onClick={onNext} style={{ cursor: "pointer" }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-primary hover:text-foreground transition-all">
            <Icon name="ArrowDown" size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ClientBuild() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isAuthed, sessionId, user } = useAuth()
  const { addItem } = useCart()

  const token = searchParams.get("token")

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
      if (data?.error) { setError(data.error); setLoading(false); return }
      const rawList: Build[] = Array.isArray(data) ? data : [data]
      if (!rawList.length) { setError("Сборка не найдена"); setLoading(false); return }
      const root = rawList.find(b => !b.parent_id) ?? rawList[0]
      const variantsRaw = await api.builds.getVariants(root.id).catch(() => [])
      const children: Build[] = Array.isArray(variantsRaw) ? variantsRaw : []
      const list: Build[] = [root, ...children]
      setVariants(list)
      if (root.client_user_id && user && root.client_user_id === user.id) setClaimed(true)
      setEnrichedComponents(root.components || [])
      setLoading(false)
    }).catch(() => { setError("Не удалось загрузить сборку"); setLoading(false) })
  }, [token, user])

  useEffect(() => {
    if (!variants[activeVariant]) return
    setEnrichedComponents(variants[activeVariant].components || [])
    setCurrentSection(0)
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: "smooth" })
    }
  }, [activeVariant, variants])

  const build = variants[activeVariant] ?? null
  const components = enrichedComponents.length > 0 ? enrichedComponents : (build?.components || [])
  const hasMultipleVariants = variants.length > 1
  const totalSections = components.length + 2

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
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60 && hasMultipleVariants) {
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
  }, [currentSection, scrollToSection, hasMultipleVariants, variants.length])

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
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-8 py-4 bg-background/80 backdrop-blur-sm border-b border-border/50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={16} />
            <span className="text-sm hidden sm:inline">Главная</span>
          </button>
          {/* Переключатель вариантов */}
          {hasMultipleVariants && (
            <div className="flex items-center gap-1.5 ml-2">
              {variants.map((v, i) => (
                <button key={i} onClick={() => setActiveVariant(i)} style={{ cursor: "pointer" }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${i === activeVariant ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"}`}>
                  {i === 0 ? "Основная" : `Вариант ${i + 1}`}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!claimed && (
            <button onClick={claimBuild} disabled={claiming} style={{ cursor: "pointer" }}
              className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all disabled:opacity-50">
              <Icon name="Bookmark" size={14} />
              <span className="hidden sm:inline">{claiming ? "Сохраняем..." : "Сохранить"}</span>
            </button>
          )}
          {claimed && (
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <Icon name="BookmarkCheck" size={14} /> Сохранено
            </span>
          )}
          <button onClick={orderBuild} style={{ cursor: "pointer" }}
            className="rounded-full bg-primary px-4 sm:px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            <span className="hidden sm:inline">Заказать — </span>{fmt(build.total_price)}
          </button>
        </div>
      </header>

      <div ref={scrollContainerRef} className="h-screen w-screen overflow-y-hidden" style={{ scrollSnapType: "y mandatory" }}>

        {/* ── СЕКЦИЯ 0: Обзор ── */}
        <div className="h-screen w-screen shrink-0 relative" style={{ scrollSnapAlign: "start" }}>
          <div className="relative flex h-full w-full overflow-hidden">

            {buildImages.length > 0 && (
              <HeroBuildCarousel images={buildImages} active={currentSection === 0} />
            )}
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 60% at 30% 50%, hsl(var(--primary) / 0.05) 0%, transparent 70%)" }} />

            <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center gap-8 px-5 sm:px-16 pt-20 pb-16">
              <div className="flex-1 min-w-0">
                <div className={`transition-all duration-700 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                  <p className="mb-3 font-mono text-xs uppercase tracking-widest text-primary">BeGraphics · Персональная сборка</p>
                  <h1 className="mb-4 font-light leading-tight tracking-tight text-foreground" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
                    {build.name}
                  </h1>
                  {build.description && (
                    <p className="mb-6 max-w-lg text-sm sm:text-base leading-relaxed text-muted-foreground whitespace-pre-line">{build.description}</p>
                  )}
                  {/* Фото — мобайл */}
                  {buildImages.length > 0 && (
                    <div className="lg:hidden mb-6">
                      <BuildImageCarousel images={buildImages} autoPlay={currentSection === 0} />
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
                    <button onClick={() => scrollToSection(1)} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full bg-primary px-5 sm:px-7 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all">
                      Изучить состав <Icon name="ArrowDown" size={15} />
                    </button>
                    <button onClick={orderBuild} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full border border-border px-5 sm:px-7 py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all">
                      Заказать сейчас
                    </button>
                  </div>
                </div>
              </div>

              {/* Список компонентов — десктоп справа */}
              <div className={`hidden xl:block w-80 shrink-0 transition-all duration-700 delay-200 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                <p className="mb-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">Состав</p>
                <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm p-4 space-y-2.5">
                  {components.map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 shrink-0 rounded flex items-center justify-center bg-primary/10 text-primary">
                          <ComponentIcon slot={c.slot} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground leading-none mb-0.5 truncate">{SLOT_NAMES[c.slot] || c.slot}</p>
                          <p className="text-sm text-foreground truncate">{c.name}</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-medium text-foreground">{fmt(c.current_price ?? c.price)}</span>
                    </div>
                  ))}
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
          <div key={idx} className="h-screen w-screen shrink-0" style={{ scrollSnapAlign: "start" }}>
            <ComponentSection comp={comp} index={idx} total={components.length}
              active={currentSection === idx + 1}
              onNext={() => scrollToSection(idx + 2)}
              onPrev={() => scrollToSection(idx)}
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
                <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">Готова к заказу</p>
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
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button onClick={orderBuild} style={{ cursor: "pointer" }}
                    className="flex items-center justify-center gap-2 rounded-full bg-primary px-10 py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
                    <Icon name="ShoppingCart" size={17} />
                    Заказать сборку
                  </button>
                  {!claimed && (
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
