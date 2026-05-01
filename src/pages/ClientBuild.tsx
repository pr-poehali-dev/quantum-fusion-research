import { useEffect, useRef, useState, useCallback } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
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
  client_token: string | null
  client_user_id: number | null
  image_urls: string[]
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

export default function ClientBuild() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isAuthed, sessionId, user } = useAuth()
  const { addItem } = useCart()

  const token = searchParams.get("token")
  const [build, setBuild] = useState<Build | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)

  // Секции: 0 = главная (обзор), 1..N = компоненты, N+1 = заказ
  const [currentSection, setCurrentSection] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const wheelLockRef = useRef(false)
  const touchStartY = useRef(0)

  // Загрузка данных продуктов для компонентов
  const [enrichedComponents, setEnrichedComponents] = useState<Component[]>([])

  useEffect(() => {
    if (!token) { setError("Ссылка недействительна"); setLoading(false); return }
    api.builds.getByClientToken(token).then(async (data) => {
      if (data.error) { setError(data.error); setLoading(false); return }
      setBuild(data)
      if (data.client_user_id && user && data.client_user_id === user.id) setClaimed(true)

      // Обогащаем компоненты данными из каталога
      const comps: Component[] = data.components || []
      const enriched = await Promise.all(
        comps.map(async (c: Component) => {
          if (c.source_id) {
            try {
              const prod = await api.products.getById(c.source_id)
              return { ...c, image_url: prod.image_url, description: prod.description, specs: prod.specs }
            } catch { return c }
          }
          return c
        })
      )
      setEnrichedComponents(enriched)
      setLoading(false)
    }).catch(() => { setError("Не удалось загрузить сборку"); setLoading(false) })
  }, [token, user])

  const totalSections = enrichedComponents.length + 2 // overview + components + order

  const scrollToSection = useCallback((index: number) => {
    if (index < 0 || index >= totalSections || isTransitioning) return
    setIsTransitioning(true)
    setCurrentSection(index)
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: window.innerHeight * index, behavior: "smooth" })
    }
    setTimeout(() => setIsTransitioning(false), 800)
  }, [totalSections, isTransitioning])

  // Колесо мыши
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

  // Тач
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
        <p className="text-sm text-foreground/40">Загружаем вашу сборку...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <Icon name="LinkOff" size={48} className="mb-4 text-foreground/20" />
      <h1 className="mb-2 text-xl font-medium text-foreground">{error}</h1>
      <p className="mb-6 text-sm text-foreground/50">Возможно ссылка устарела или была деактивирована</p>
      <button onClick={() => navigate("/")} className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        На главную
      </button>
    </div>
  )

  if (!build) return null

  const components = enrichedComponents.length > 0 ? enrichedComponents : build.components

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">

      {/* Навигация — точки */}
      <nav className="fixed right-6 top-1/2 z-50 -translate-y-1/2 flex flex-col gap-2.5">
        {Array.from({ length: totalSections }).map((_, i) => (
          <button
            key={i}
            onClick={() => scrollToSection(i)}
            style={{ cursor: "pointer" }}
            className={`rounded-full transition-all duration-300 ${
              i === currentSection
                ? "h-6 w-2 bg-primary"
                : "h-2 w-2 bg-foreground/20 hover:bg-foreground/50"
            }`}
          />
        ))}
      </nav>

      {/* Хедер */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5" style={{ cursor: "pointer" }}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">B</div>
          <span className="text-sm font-medium text-foreground/80">BeGraphics</span>
        </button>
        <div className="flex items-center gap-3">
          {!claimed && (
            <button
              onClick={claimBuild}
              disabled={claiming}
              style={{ cursor: "pointer" }}
              className="rounded-full border border-border bg-background/80 backdrop-blur px-4 py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-all"
            >
              {claiming ? "Сохранение..." : "Сохранить в профиль"}
            </button>
          )}
          {claimed && (
            <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">
              <Icon name="Check" size={12} /> Сохранено
            </span>
          )}
          <button
            onClick={orderBuild}
            style={{ cursor: "pointer" }}
            className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Заказать — {fmt(build.total_price)}
          </button>
        </div>
      </header>

      {/* Скролл-контейнер */}
      <div
        ref={scrollContainerRef}
        className="h-screen w-screen overflow-y-hidden"
        style={{ scrollSnapType: "y mandatory" }}
      >

        {/* ─── СЕКЦИЯ 0: Обзор сборки ─── */}
        <Section active={currentSection === 0}>
          <div className="relative flex h-full w-full items-center overflow-hidden">
            {/* Фоновая картинка сборки */}
            {build.image_urls?.length > 0 && (
              <div className="absolute inset-0">
                <img
                  src={build.image_urls[0]}
                  alt={build.name}
                  className="h-full w-full object-cover"
                  style={{ filter: "brightness(0.25)" }}
                />
                <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(10,10,10,0.95) 45%, rgba(10,10,10,0.3) 100%)" }} />
              </div>
            )}
            {/* Если нет фото — просто градиент */}
            {(!build.image_urls || build.image_urls.length === 0) && (
              <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 60% 50%, hsl(var(--primary) / 0.08) 0%, transparent 70%)" }} />
            )}

            <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-10 px-16 lg:flex-row lg:items-center">
              {/* Левая часть */}
              <div className="flex-1">
                <div className={`transition-all duration-700 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                  <p className="mb-3 font-mono text-xs uppercase tracking-widest text-primary">
                    Персональная сборка от BeGraphics
                  </p>
                  <h1 className="mb-5 text-5xl font-light leading-tight tracking-tight text-foreground lg:text-6xl">
                    {build.name}
                  </h1>
                  {build.description && (
                    <p className="mb-8 max-w-lg text-base leading-relaxed text-foreground/60">
                      {build.description}
                    </p>
                  )}

                  {/* Итоговая стоимость */}
                  <div className="mb-8 flex items-end gap-6">
                    <div>
                      <p className="text-xs text-foreground/40 mb-1">Итоговая стоимость</p>
                      <p className="text-4xl font-bold text-foreground">{fmt(build.total_price)}</p>
                    </div>
                    <div className="mb-1 flex flex-col gap-0.5">
                      <p className="text-xs text-foreground/40">Комплектующие: <span className="text-foreground/60">{fmt(build.parts_total)}</span></p>
                      <p className="text-xs text-foreground/40">Сборка: <span className="text-foreground/60">{fmt(build.assembly_fee)}</span></p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => scrollToSection(1)}
                      style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all"
                    >
                      Изучить подробнее
                      <Icon name="ArrowDown" size={16} />
                    </button>
                    <button
                      onClick={orderBuild}
                      style={{ cursor: "pointer" }}
                      className="flex items-center gap-2 rounded-full border border-border px-7 py-3.5 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-all"
                    >
                      Заказать сейчас
                    </button>
                  </div>
                </div>
              </div>

              {/* Правая часть — список компонентов (краткий) */}
              <div className={`w-full max-w-sm transition-all duration-700 delay-200 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
                <p className="mb-3 text-xs font-mono uppercase tracking-widest text-foreground/30">Состав</p>
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 space-y-3">
                  {components.map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-5 h-5 shrink-0 rounded flex items-center justify-center bg-primary/20 text-primary">
                          <ComponentIcon slot={c.slot} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs text-foreground/40 leading-none mb-0.5">{SLOT_NAMES[c.slot] || c.slot}</p>
                          <p className="text-sm text-foreground/80 truncate">{c.name}</p>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-medium text-foreground">{fmt(c.current_price ?? c.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Скролл-подсказка */}
            <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 transition-all duration-500 ${currentSection === 0 ? "opacity-60" : "opacity-0"}`}>
              <p className="text-xs text-foreground/40">Прокрутите вниз</p>
              <div className="flex flex-col gap-1">
                <div className="h-1 w-1 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="h-1 w-1 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="h-1 w-1 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        </Section>

        {/* ─── СЕКЦИИ 1..N: Компоненты ─── */}
        {components.map((comp, idx) => (
          <Section key={idx} active={currentSection === idx + 1}>
            <ComponentSection
              comp={comp}
              index={idx}
              total={components.length}
              active={currentSection === idx + 1}
              onNext={() => scrollToSection(idx + 2)}
              onPrev={() => scrollToSection(idx)}
            />
          </Section>
        ))}

        {/* ─── Последняя секция: Оформление заказа ─── */}
        <Section active={currentSection === totalSections - 1}>
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 60% at 50% 50%, hsl(var(--primary) / 0.12) 0%, transparent 70%)" }} />
            <div className={`relative z-10 flex flex-col items-center text-center px-6 transition-all duration-700 ${currentSection === totalSections - 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 border border-primary/30">
                <Icon name="ShoppingCart" size={36} className="text-primary" />
              </div>
              <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">Готово к заказу</p>
              <h2 className="mb-3 text-5xl font-light text-foreground">{build.name}</h2>
              <p className="mb-2 text-foreground/50 text-base">{components.length} компонентов · Сборка включена</p>

              <div className="mb-10 mt-6 flex items-center gap-8 rounded-2xl border border-border bg-card/50 px-10 py-6 backdrop-blur">
                <div className="text-center">
                  <p className="text-xs text-foreground/40 mb-1">Комплектующие</p>
                  <p className="text-xl font-semibold text-foreground">{fmt(build.parts_total)}</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-xs text-foreground/40 mb-1">Сборка</p>
                  <p className="text-xl font-semibold text-foreground">{fmt(build.assembly_fee)}</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-xs text-foreground/40 mb-1">Итого</p>
                  <p className="text-2xl font-bold text-primary">{fmt(build.total_price)}</p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <button
                  onClick={orderBuild}
                  style={{ cursor: "pointer" }}
                  className="flex items-center gap-2 rounded-full bg-primary px-10 py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                >
                  <Icon name="ShoppingCart" size={18} />
                  Оформить заказ
                </button>
                {!claimed && (
                  <button
                    onClick={claimBuild}
                    disabled={claiming}
                    style={{ cursor: "pointer" }}
                    className="flex items-center gap-2 rounded-full border border-border px-8 py-4 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-all"
                  >
                    <Icon name="BookmarkPlus" size={16} />
                    {claiming ? "Сохранение..." : "Сохранить в профиль"}
                  </button>
                )}
              </div>

              {claimed && (
                <p className="mt-5 flex items-center gap-1.5 text-sm text-primary">
                  <Icon name="Check" size={14} /> Сборка сохранена в вашем профиле
                </p>
              )}

              <button
                onClick={() => scrollToSection(0)}
                style={{ cursor: "pointer" }}
                className="mt-8 flex items-center gap-1.5 text-xs text-foreground/30 hover:text-foreground/60 transition-colors"
              >
                <Icon name="ArrowUp" size={13} />
                Вернуться к обзору
              </button>
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}

// ─── Секция-обёртка ───
function Section({ children, active }: { children: React.ReactNode; active: boolean }) {
  return (
    <div
      className="h-screen w-screen shrink-0 relative"
      style={{ scrollSnapAlign: "start" }}
    >
      {children}
    </div>
  )
}

// ─── Секция компонента ───
function ComponentSection({
  comp, index, total, active, onNext, onPrev
}: {
  comp: Component
  index: number
  total: number
  active: boolean
  onNext: () => void
  onPrev: () => void
}) {
  const price = comp.current_price ?? comp.price
  const [imgIdx, setImgIdx] = useState(0)
  const images = comp.image_url ? [comp.image_url] : []

  return (
    <div className="relative flex h-full w-full items-center overflow-hidden">
      {/* Фоновый блюр от картинки */}
      {images[0] && (
        <div className="absolute inset-0 overflow-hidden">
          <img src={images[0]} alt="" className="h-full w-full object-cover scale-110"
            style={{ filter: "blur(60px) brightness(0.15)" }} />
        </div>
      )}
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(10,10,10,0.97) 0%, rgba(10,10,10,0.7) 100%)" }} />

      {/* Номер компонента */}
      <div className={`absolute top-24 left-16 transition-all duration-500 delay-100 ${active ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"}`}>
        <span className="font-mono text-[120px] font-bold leading-none text-foreground/[0.04] select-none">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center gap-16 px-16">
        {/* Левая часть — текст */}
        <div className="flex-1 max-w-xl">
          <div className={`transition-all duration-700 ${active ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
            <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary/70">
              {SLOT_NAMES[comp.slot] || comp.slot} · {index + 1} / {total}
            </p>
            <h2 className="mb-4 text-4xl font-light leading-tight text-foreground lg:text-5xl">
              {comp.name}
            </h2>
            <p className="mb-6 text-3xl font-bold text-primary">{fmt(price)}</p>

            {comp.description && (
              <p className="mb-6 text-base leading-relaxed text-foreground/55 max-w-md">
                {comp.description}
              </p>
            )}

            {comp.specs && Object.keys(comp.specs).length > 0 && (
              <div className="grid grid-cols-2 gap-2 mt-4">
                {Object.entries(comp.specs).slice(0, 6).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-white/5 border border-white/8 px-4 py-2.5">
                    <p className="text-xs text-foreground/30 mb-0.5">{k}</p>
                    <p className="text-sm text-foreground/80 font-medium">{v}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Правая часть — фото */}
        <div className={`w-full max-w-md transition-all duration-700 delay-150 ${active ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-8 scale-95"}`}>
          {images.length > 0 ? (
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 aspect-square">
              <img
                src={images[imgIdx]}
                alt={comp.name}
                className="h-full w-full object-contain p-8 transition-opacity duration-300"
              />
            </div>
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <div className="flex flex-col items-center gap-4 text-foreground/20">
                <ComponentIcon slot={comp.slot} size={64} />
                <p className="text-xs font-mono uppercase tracking-widest">{SLOT_NAMES[comp.slot] || comp.slot}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Навигация вперёд/назад */}
      <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 transition-all duration-500 ${active ? "opacity-100" : "opacity-0"}`}>
        <button onClick={onPrev} style={{ cursor: "pointer" }}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground/40 hover:border-foreground/40 hover:text-foreground transition-all">
          <Icon name="ChevronUp" size={18} />
        </button>
        <span className="text-xs font-mono text-foreground/30">{index + 1} / {total}</span>
        <button onClick={onNext} style={{ cursor: "pointer" }}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground/40 hover:border-foreground/40 hover:text-foreground transition-all">
          <Icon name="ChevronDown" size={18} />
        </button>
      </div>
    </div>
  )
}

// ─── Иконка по типу слота ───
function ComponentIcon({ slot, size = 14 }: { slot: string; size?: number }) {
  const icons: Record<string, string> = {
    cpu: "Cpu", gpu: "Monitor", ram: "MemoryStick", storage: "HardDrive",
    psu: "Zap", case: "Box", motherboard: "CircuitBoard",
  }
  return <Icon name={icons[slot] || "Package"} size={size} />
}
