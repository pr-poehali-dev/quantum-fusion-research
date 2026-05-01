import { useEffect, useRef, useState, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор",
  gpu: "Видеокарта",
  ram: "Оперативная память",
  storage: "Накопитель",
  psu: "Блок питания",
  case: "Корпус",
  motherboard: "Материнская плата",
}

interface Component {
  slot: string
  name: string
  price: number
  current_price?: number
  source_id?: number
  image_url?: string
  description?: string
  specs?: Record<string, string>
}

interface Build {
  id: number
  name: string
  description: string
  components: Component[]
  parts_total: number
  assembly_fee: number
  total_price: number
  assembly_type: string
  image_urls: string[]
  is_featured: boolean
  status: string
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

export default function BuildPreview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addItem } = useCart()

  const [build, setBuild] = useState<Build | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [buildImgIdx, setBuildImgIdx] = useState(0)
  const [enrichedComponents, setEnrichedComponents] = useState<Component[]>([])

  const [currentSection, setCurrentSection] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const wheelLockRef = useRef(false)
  const touchStartY = useRef(0)

  useEffect(() => {
    if (!id) { setError("Сборка не найдена"); setLoading(false); return }
    api.builds.getById(Number(id)).then(async (data) => {
      if (data.error || !data.id) { setError("Сборка не найдена"); setLoading(false); return }
      setBuild(data)

      const comps = (data.components || []).map((c: Component & { product_description?: string; product_images?: string[] }) => ({
        ...c,
        description: c.description || c.product_description || undefined,
        image_url: c.image_url || (c.product_images && c.product_images[0]) || undefined,
      }))
      setEnrichedComponents(comps)
      setLoading(false)
    }).catch(() => { setError("Не удалось загрузить сборку"); setLoading(false) })
  }, [id])

  const components = enrichedComponents.length > 0 ? enrichedComponents : (build?.components || [])
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
    const onTouchStart = (e: TouchEvent) => { touchStartY.current = e.touches[0].clientY }
    const onTouchEnd = (e: TouchEvent) => {
      const delta = touchStartY.current - e.changedTouches[0].clientY
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
  }, [currentSection, scrollToSection])

  const orderBuild = () => {
    if (!build) return
    addItem({ id: build.id, name: build.name, price: build.total_price, type: "config" })
    navigate("/cart")
  }

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-foreground/40">Загружаем сборку...</p>
      </div>
    </div>
  )

  if (error || !build) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <Icon name="MonitorOff" size={48} className="mb-4 text-foreground/20" />
      <h1 className="mb-2 text-xl font-medium text-foreground">{error || "Сборка не найдена"}</h1>
      <button onClick={() => navigate("/shop")} className="mt-6 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        Все сборки
      </button>
    </div>
  )

  const buildImages = build.image_urls || []

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">

      {/* Точки навигации */}
      <nav className="fixed right-4 top-1/2 z-50 -translate-y-1/2 hidden sm:flex flex-col gap-2.5">
        {Array.from({ length: totalSections }).map((_, i) => (
          <button key={i} onClick={() => scrollToSection(i)} style={{ cursor: "pointer" }}
            className={`rounded-full transition-all duration-300 ${i === currentSection ? "h-6 w-2 bg-primary" : "h-2 w-2 bg-foreground/20 hover:bg-foreground/50"}`}
          />
        ))}
      </nav>

      {/* Хедер */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-8 py-4">
        <button onClick={() => navigate("/shop")} className="flex items-center gap-2 text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="ArrowLeft" size={16} />
          <span className="text-sm">Все сборки</span>
        </button>
        <button onClick={orderBuild} style={{ cursor: "pointer" }}
          className="rounded-full bg-primary px-4 sm:px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
          <span className="hidden sm:inline">Заказать — </span>{fmt(build.total_price)}
        </button>
      </header>

      {/* Скролл-контейнер */}
      <div ref={scrollContainerRef} className="h-screen w-screen overflow-y-hidden" style={{ scrollSnapType: "y mandatory" }}>

        {/* ── СЕКЦИЯ 0: Обзор ── */}
        <div className="h-screen w-screen shrink-0 relative" style={{ scrollSnapAlign: "start" }}>
          <div className="relative flex h-full w-full items-center overflow-hidden">
            {buildImages.length > 0 && (
              <div className="absolute inset-0">
                <img src={buildImages[buildImgIdx]} alt={build.name} className="h-full w-full object-cover" style={{ filter: "brightness(0.2)" }} />
                <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(10,10,10,0.98) 40%, rgba(10,10,10,0.4) 100%)" }} />
              </div>
            )}
            {buildImages.length === 0 && (
              <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 60% 50%, hsl(var(--primary) / 0.08) 0%, transparent 70%)" }} />
            )}

            <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 sm:px-16 lg:flex-row lg:items-center pt-20 pb-16">
              <div className="flex-1">
                <div className={`transition-all duration-700 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                  <p className="mb-3 font-mono text-xs uppercase tracking-widest text-primary">
                    BeGraphics · Готовая сборка
                  </p>
                  <h1 className="mb-4 font-light leading-tight tracking-tight text-foreground" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
                    {build.name}
                  </h1>
                  {build.description && (
                    <p className="mb-6 max-w-lg text-sm sm:text-base leading-relaxed text-foreground/60">
                      {build.description}
                    </p>
                  )}
                  <div className="mb-6 flex flex-wrap items-end gap-4 sm:gap-6">
                    <div>
                      <p className="text-xs text-foreground/40 mb-1">Итоговая стоимость</p>
                      <p className="font-bold text-foreground" style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)" }}>{fmt(build.total_price)}</p>
                    </div>
                    <div className="mb-0.5 flex flex-col gap-0.5">
                      <p className="text-xs text-foreground/40">Железо: <span className="text-foreground/60">{fmt(build.parts_total)}</span></p>
                      <p className="text-xs text-foreground/40">Сборка: <span className="text-foreground/60">{fmt(build.assembly_fee)}</span></p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => scrollToSection(1)} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full bg-primary px-5 sm:px-7 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all">
                      Изучить состав <Icon name="ArrowDown" size={15} />
                    </button>
                    <button onClick={orderBuild} style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full border border-border px-5 sm:px-7 py-3 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-all">
                      Заказать сейчас
                    </button>
                  </div>
                </div>
              </div>

              {/* Список компонентов */}
              <div className={`w-full lg:max-w-sm transition-all duration-700 delay-200 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                <p className="mb-2 text-xs font-mono uppercase tracking-widest text-foreground/30">Состав</p>
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 space-y-2.5">
                  {components.map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 shrink-0 rounded flex items-center justify-center bg-primary/20 text-primary">
                          <ComponentIcon slot={c.slot} />
                        </span>
                        <div className="min-w-0">
                          <p className="hidden sm:block text-xs text-foreground/40 leading-none mb-0.5">{SLOT_NAMES[c.slot] || c.slot}</p>
                          <p className="text-xs sm:text-sm text-foreground/80 truncate">{c.name}</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs sm:text-sm font-medium text-foreground">{fmt(c.current_price ?? c.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 transition-all duration-500 ${currentSection === 0 ? "opacity-50" : "opacity-0"}`}>
              <p className="text-xs text-foreground/40">Прокрутите вниз</p>
              <Icon name="ChevronDown" size={16} className="text-foreground/30 animate-bounce" />
            </div>
          </div>
        </div>

        {/* ── СЕКЦИИ 1..N: Компоненты ── */}
        {components.map((comp, idx) => (
          <div key={idx} className="h-screen w-screen shrink-0 relative" style={{ scrollSnapAlign: "start" }}>
            <ComponentSection
              comp={comp}
              index={idx}
              total={components.length}
              active={currentSection === idx + 1}
              onNext={() => scrollToSection(idx + 2)}
              onPrev={() => scrollToSection(idx)}
            />
          </div>
        ))}

        {/* ── Последняя секция: Заказ ── */}
        <div className="h-screen w-screen shrink-0 relative" style={{ scrollSnapAlign: "start" }}>
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 60% at 50% 50%, hsl(var(--primary) / 0.1) 0%, transparent 70%)" }} />

            <div className={`relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-8 pt-20 pb-8 transition-all duration-700 ${currentSection === totalSections - 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>

              {buildImages.length > 0 && (
                <div className="mb-6 sm:mb-8">
                  <BuildImageCarousel images={buildImages} />
                </div>
              )}

              <div className="flex flex-col items-center text-center">
                <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">Готова к заказу</p>
                <h2 className="mb-2 font-light text-foreground" style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)" }}>{build.name}</h2>
                <p className="mb-6 text-foreground/50 text-sm">{components.length} компонентов · Сборка включена</p>

                <div className="mb-6 w-full max-w-lg flex items-center justify-center gap-4 sm:gap-8 rounded-2xl border border-border bg-card/50 px-4 sm:px-10 py-4 sm:py-6 backdrop-blur">
                  <div className="text-center">
                    <p className="text-xs text-foreground/40 mb-0.5">Железо</p>
                    <p className="text-base sm:text-xl font-semibold text-foreground">{fmt(build.parts_total)}</p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div className="text-center">
                    <p className="text-xs text-foreground/40 mb-0.5">Сборка</p>
                    <p className="text-base sm:text-xl font-semibold text-foreground">{fmt(build.assembly_fee)}</p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div className="text-center">
                    <p className="text-xs text-foreground/40 mb-0.5">Итого</p>
                    <p className="text-xl sm:text-2xl font-bold text-primary">{fmt(build.total_price)}</p>
                  </div>
                </div>

                <button onClick={orderBuild} style={{ cursor: "pointer" }}
                  className="flex items-center justify-center gap-2 rounded-full bg-primary px-10 py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
                  <Icon name="ShoppingCart" size={17} />
                  Заказать сборку
                </button>

                <button onClick={() => scrollToSection(0)} style={{ cursor: "pointer" }}
                  className="mt-6 flex items-center gap-1.5 text-xs text-foreground/30 hover:text-foreground/60 transition-colors">
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
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20" style={{ maxHeight: "35vh" }}>
      <img src={images[idx]} alt="" className="w-full object-cover" style={{ maxHeight: "35vh" }} />
      {images.length > 1 && (
        <>
          <button onClick={() => setIdx(i => (i - 1 + images.length) % images.length)} style={{ cursor: "pointer" }}
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70 transition-all">
            <Icon name="ChevronLeft" size={16} />
          </button>
          <button onClick={() => setIdx(i => (i + 1) % images.length)} style={{ cursor: "pointer" }}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70 transition-all">
            <Icon name="ChevronRight" size={16} />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} style={{ cursor: "pointer" }}
                className={`rounded-full transition-all ${i === idx ? "w-5 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/40"}`} />
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
    <div className="relative flex h-full w-full items-center overflow-hidden">
      {comp.image_url && (
        <div className="absolute inset-0 overflow-hidden">
          <img src={comp.image_url} alt="" className="h-full w-full object-cover scale-110" style={{ filter: "blur(60px) brightness(0.12)" }} />
        </div>
      )}
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(10,10,10,0.97) 0%, rgba(10,10,10,0.75) 100%)" }} />

      <div className={`absolute top-16 sm:top-24 left-4 sm:left-16 transition-all duration-500 delay-100 ${active ? "opacity-100" : "opacity-0"}`}>
        <span className="font-mono font-bold leading-none text-foreground/[0.03] select-none" style={{ fontSize: "clamp(80px, 15vw, 140px)" }}>
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center gap-8 sm:gap-16 px-5 sm:px-16 pt-20 pb-16">
        <div className="flex-1 min-w-0">
          <div className={`transition-all duration-700 ${active ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
            <p className="mb-1.5 font-mono text-xs uppercase tracking-widest text-primary/70">
              {SLOT_NAMES[comp.slot] || comp.slot} · {index + 1} / {total}
            </p>
            <h2 className="mb-3 font-light leading-tight text-foreground" style={{ fontSize: "clamp(1.5rem, 4vw, 3rem)" }}>
              {comp.name}
            </h2>
            <p className="mb-4 font-bold text-primary" style={{ fontSize: "clamp(1.25rem, 3vw, 2rem)" }}>
              {fmt(price)}
            </p>
            {comp.description && (
              <p className="mb-5 text-sm sm:text-base leading-relaxed text-foreground/55 max-w-md">
                {comp.description}
              </p>
            )}
            {comp.specs && Object.keys(comp.specs).length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 mt-3 max-w-sm">
                {Object.entries(comp.specs).slice(0, 4).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-white/5 border border-white/[0.08] px-3 py-2">
                    <p className="text-xs text-foreground/30 mb-0.5 truncate">{k}</p>
                    <p className="text-xs sm:text-sm text-foreground/80 font-medium truncate">{v}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {comp.image_url && (
          <div className={`hidden md:block w-56 lg:w-80 shrink-0 transition-all duration-700 delay-150 ${active ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 aspect-square">
              <img src={comp.image_url} alt={comp.name} className="h-full w-full object-contain p-6" />
            </div>
          </div>
        )}
        {comp.image_url && !comp.description && (
          <div className={`md:hidden w-24 h-24 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5 transition-all duration-700 delay-150 ${active ? "opacity-100" : "opacity-0"}`}>
            <img src={comp.image_url} alt={comp.name} className="h-full w-full object-contain p-2" />
          </div>
        )}
      </div>

      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-5 transition-all duration-500 ${active ? "opacity-100" : "opacity-0"}`}>
        <button onClick={onPrev} style={{ cursor: "pointer" }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground/40 hover:border-foreground/40 hover:text-foreground transition-all">
          <Icon name="ChevronUp" size={16} />
        </button>
        <span className="text-xs font-mono text-foreground/30">{index + 1} / {total}</span>
        <button onClick={onNext} style={{ cursor: "pointer" }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground/40 hover:border-foreground/40 hover:text-foreground transition-all">
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