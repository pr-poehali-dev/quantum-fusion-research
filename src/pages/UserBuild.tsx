import { useEffect, useRef, useState, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"

const SLOT_NAMES: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "Оперативная память",
  storage: "Накопитель", psu: "Блок питания", case: "Корпус",
  motherboard: "Материнская плата", cooling: "Охлаждение", fan: "Вентилятор",
}

const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

interface Component {
  slot: string
  name: string
  price: number
  qty?: number
  link?: string
  description?: string
  image_urls?: string[]
}

interface BuildData {
  id: number
  name: string
  description: string
  components: Component[]
  parts_total: number
  assembly_fee: number
  total_price: number
  share_token: string
  short_code?: string
  is_public: boolean
  created_at: string
  username: string
  author_avatar: string
  author_tag: string
  image_urls: string[]
}

function ComponentIcon({ slot }: { slot: string }) {
  const icons: Record<string, string> = {
    cpu: "Cpu", gpu: "Monitor", ram: "MemoryStick", storage: "HardDrive",
    psu: "Zap", case: "Box", motherboard: "CircuitBoard", cooling: "Wind", fan: "Fan",
  }
  return <Icon name={(icons[slot] || "Package") as "Cpu"} size={12} />
}

function HeroBuildCarousel({ images, active }: { images: string[]; active: boolean }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!active || images.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 4000)
    return () => clearInterval(t)
  }, [active, images.length])
  return (
    <div className="absolute inset-0 hidden lg:block pointer-events-none">
      {images.map((src, i) => (
        <div key={i} className={`absolute inset-0 transition-opacity duration-1000 ${i === idx ? "opacity-100" : "opacity-0"}`}>
          <img src={src} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to right, hsl(var(--background)) 30%, transparent 70%)" }} />
        </div>
      ))}
    </div>
  )
}

function BuildImageCarousel({ images, autoPlay }: { images: string[]; autoPlay: boolean }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!autoPlay || images.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 3500)
    return () => clearInterval(t)
  }, [autoPlay, images.length])
  return (
    <div className="relative overflow-hidden rounded-2xl aspect-video bg-muted">
      {images.map((src, i) => (
        <img key={i} src={src} alt="" className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${i === idx ? "opacity-100" : "opacity-0"}`} />
      ))}
      {images.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)} className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/50"}`} style={{ cursor: "pointer" }} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function UserBuild() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { isAuthed } = useAuth()
  const { addItem } = useCart()

  const [build, setBuild] = useState<BuildData | null>(null)
  const [components, setComponents] = useState<Component[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [currentSection, setCurrentSection] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [copied, setCopied] = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const wheelLockRef = useRef(false)
  const touchStartY = useRef(0)
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (!token) return
    api.auth.getUserBuild(token).then(data => {
      if (data.error) { setError(data.error); setLoading(false); return }
      setBuild(data)
      setComponents(data.components || [])
      setLoading(false)
    })
  }, [token])

  const totalSections = components.length + 2

  const scrollToSection = useCallback((index: number) => {
    if (index < 0 || index >= totalSections || isTransitioning) return
    setIsTransitioning(true)
    setCurrentSection(index)
    const el = sectionRefs.current[index]
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
    else if (scrollContainerRef.current) {
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

  useEffect(() => {
    if (!sectionRefs.current.length) return
    const observers: IntersectionObserver[] = []
    sectionRefs.current.forEach((el, idx) => {
      if (!el) return
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) setCurrentSection(idx)
      }, { threshold: 0.5 })
      obs.observe(el)
      observers.push(obs)
    })
    return () => observers.forEach(o => o.disconnect())
  }, [components.length])

  const orderBuild = () => {
    if (!build) return
    addItem({ id: build.id, name: build.name, price: build.total_price, type: "config" })
    navigate("/cart")
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
      <button onClick={() => navigate("/community-builds")} className="mt-6 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        Сборки сообщества
      </button>
    </div>
  )

  const buildImages = build.image_urls?.filter(Boolean) || []

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
          <button onClick={() => navigate("/community-builds")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={16} />
            <span className="text-sm hidden sm:inline">Сборки сообщества</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copyLink} style={{ cursor: "pointer" }}
            className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all">
            <Icon name={copied ? "Check" : "Link"} size={14} />
            <span className="hidden sm:inline">{copied ? "Скопировано!" : "Поделиться"}</span>
          </button>
          <button onClick={() => navigate(build.short_code ? `/s/${build.short_code}` : `/configurator?build=${build.share_token}`)} style={{ cursor: "pointer" }}
            className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all">
            <Icon name="Copy" size={14} />
            <span className="hidden sm:inline">В конфигуратор</span>
          </button>
          <button onClick={orderBuild} style={{ cursor: "pointer" }}
            className="rounded-full bg-primary px-4 sm:px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            <span className="hidden sm:inline">Заказать — </span>{fmt(build.total_price)}
          </button>
        </div>
      </header>

      <div ref={scrollContainerRef} className="w-screen overflow-y-hidden" style={{ scrollSnapType: "y mandatory", height: "100dvh" }}>

        {/* ── СЕКЦИЯ 0: Обзор ── */}
        <div ref={el => { sectionRefs.current[0] = el }} className="w-screen shrink-0 relative" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
          <div className="relative flex h-full w-full overflow-hidden">

            {buildImages.length > 0 && <HeroBuildCarousel images={buildImages} active={currentSection === 0} />}
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 60% at 30% 50%, hsl(var(--primary) / 0.05) 0%, transparent 70%)" }} />

            <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center gap-8 px-5 sm:px-16 pt-20 pb-16">
              <div className="flex-1 min-w-0">
                <div className={`transition-all duration-700 ${currentSection === 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>

                  {/* Автор */}
                  <button
                    onClick={() => build.author_tag ? navigate(`/profile/${build.author_tag}`) : undefined}
                    className="mb-4 flex items-center gap-2.5 group"
                    style={{ cursor: build.author_tag ? "pointer" : "default" }}
                  >
                    {build.author_avatar ? (
                      <img src={build.author_avatar} alt={build.username} className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-medium text-primary shrink-0">
                        {build.username?.[0]?.toUpperCase()}
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                      {build.username}
                      {build.author_tag && <span className="ml-1 text-muted-foreground/50">@{build.author_tag}</span>}
                    </span>
                  </button>

                  <h1 className="mb-4 font-light leading-tight tracking-tight text-foreground" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
                    {build.name}
                  </h1>

                  {build.description && build.description !== "<p></p>" && (
                    <div className="mb-6 max-w-lg text-sm sm:text-base leading-relaxed text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: build.description }} />
                  )}

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
                      {build.assembly_fee > 0 && <p className="text-xs text-muted-foreground">Сборка: <span className="text-foreground/70">{fmt(build.assembly_fee)}</span></p>}
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
                    <div key={i} className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <span className="w-5 h-5 mt-0.5 shrink-0 rounded flex items-center justify-center bg-primary/10 text-primary">
                          <ComponentIcon slot={c.slot} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground leading-none mb-0.5">{SLOT_NAMES[c.slot] || c.slot}</p>
                          <p className="text-sm text-foreground leading-snug break-words">
                            {c.name}{c.qty && c.qty > 1 ? <span className="text-muted-foreground"> ×{c.qty}</span> : null}
                          </p>
                        </div>
                      </div>
                      <p className="shrink-0 text-xs font-semibold text-primary tabular-nums">{fmt(c.price * (c.qty || 1))}</p>
                    </div>
                  ))}
                  <div className="border-t border-border/50 pt-2.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Итого</span>
                    <span className="text-sm font-bold text-foreground">{fmt(build.total_price)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── СЕКЦИИ КОМПОНЕНТОВ ── */}
        {components.map((comp, idx) => {
          const sectionIdx = idx + 1
          const images = (comp.image_urls || []).filter(Boolean)
          const hasDesc = comp.description && comp.description !== "<p></p>"
          return (
            <div key={idx} ref={el => { sectionRefs.current[sectionIdx] = el }}
              className="w-screen shrink-0 relative" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
              <div className="relative flex h-full w-full overflow-hidden">

                {/* Фото компонента — справа */}
                {images.length > 0 && (
                  <div className="absolute inset-0 hidden lg:block pointer-events-none">
                    <img src={images[0]} alt="" className="h-full w-full object-cover opacity-30" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to right, hsl(var(--background)) 40%, transparent 75%)" }} />
                  </div>
                )}
                <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 60% at 30% 50%, hsl(var(--primary) / 0.04) 0%, transparent 70%)" }} />

                <div className={`relative z-10 mx-auto flex w-full max-w-7xl flex-col justify-center px-5 sm:px-16 pt-20 pb-16 transition-all duration-700 ${currentSection === sectionIdx ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>

                  <p className="mb-1 font-mono text-xs uppercase tracking-widest text-primary">
                    {sectionIdx} / {components.length} · {SLOT_NAMES[comp.slot] || comp.slot}
                  </p>
                  <h2 className="mb-3 font-light leading-tight text-foreground" style={{ fontSize: "clamp(1.5rem, 4vw, 3rem)" }}>
                    {comp.name}
                  </h2>

                  {comp.qty && comp.qty > 1 && (
                    <p className="mb-3 text-sm text-muted-foreground">Количество: {comp.qty} шт.</p>
                  )}

                  {/* Фото компонента — мобайл */}
                  {images.length > 0 && (
                    <div className="lg:hidden mb-4 max-w-sm">
                      <BuildImageCarousel images={images} autoPlay={currentSection === sectionIdx} />
                    </div>
                  )}

                  {/* Описание компонента */}
                  {hasDesc && (
                    <div className="mb-5 max-w-lg text-sm leading-relaxed text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: comp.description! }} />
                  )}

                  <div className="flex flex-wrap items-center gap-4 mb-6">
                    <p className="font-bold text-foreground" style={{ fontSize: "clamp(1.5rem, 3vw, 2.5rem)" }}>
                      {fmt(comp.price * (comp.qty || 1))}
                    </p>
                    {comp.qty && comp.qty > 1 && (
                      <p className="text-sm text-muted-foreground">{fmt(comp.price)} × {comp.qty}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {comp.link && (
                      <a href={comp.link} target="_blank" rel="noopener noreferrer" style={{ cursor: "pointer" }}
                        className="flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-all">
                        <Icon name="ExternalLink" size={14} />
                        Ссылка на товар
                      </a>
                    )}
                    {sectionIdx < components.length && (
                      <button onClick={() => scrollToSection(sectionIdx + 1)} style={{ cursor: "pointer" }}
                        className="flex items-center gap-2 rounded-full bg-primary/10 border border-primary/20 px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/20 transition-all">
                        Следующий <Icon name="ArrowDown" size={14} />
                      </button>
                    )}
                    {sectionIdx === components.length && (
                      <button onClick={() => scrollToSection(totalSections - 1)} style={{ cursor: "pointer" }}
                        className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-all">
                        Оформить заказ <Icon name="ArrowDown" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {/* ── ПОСЛЕДНЯЯ СЕКЦИЯ: Итог + автор ── */}
        <div ref={el => { sectionRefs.current[totalSections - 1] = el }}
          className="w-screen shrink-0 relative" style={{ scrollSnapAlign: "start", height: "100dvh" }}>
          <div className={`relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col items-center justify-center px-5 sm:px-16 pt-20 pb-16 transition-all duration-700 ${currentSection === totalSections - 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>

            <div className="w-full max-w-lg space-y-6">
              <div className="text-center">
                <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">Итог</p>
                <h2 className="mb-1 text-4xl font-light text-foreground">{fmt(build.total_price)}</h2>
                <p className="text-sm text-muted-foreground">
                  Железо {fmt(build.parts_total)}{build.assembly_fee > 0 ? ` + сборка ${fmt(build.assembly_fee)}` : ""}
                </p>
              </div>

              {/* Автор */}
              <button
                onClick={() => build.author_tag ? navigate(`/profile/${build.author_tag}`) : undefined}
                className="w-full flex items-center gap-4 rounded-2xl border border-border bg-card/80 backdrop-blur-sm px-5 py-4 hover:border-primary transition-colors"
                style={{ cursor: build.author_tag ? "pointer" : "default" }}
              >
                {build.author_avatar ? (
                  <img src={build.author_avatar} alt={build.username} className="h-14 w-14 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/20 text-2xl font-medium text-primary shrink-0">
                    {build.username?.[0]?.toUpperCase()}
                  </div>
                )}
                <div className="text-left">
                  <p className="text-xs text-muted-foreground mb-0.5">Автор сборки</p>
                  <p className="font-semibold text-foreground">{build.username}</p>
                  {build.author_tag && <p className="text-xs text-muted-foreground">@{build.author_tag}</p>}
                </div>
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={orderBuild} style={{ cursor: "pointer" }}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                  <Icon name="ShoppingCart" size={16} />
                  Заказать
                </button>
                <button onClick={() => navigate(build.short_code ? `/s/${build.short_code}` : `/configurator?build=${build.share_token}`)} style={{ cursor: "pointer" }}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-border py-3.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground transition-colors">
                  <Icon name="Copy" size={16} />
                  В конфигуратор
                </button>
                <button onClick={copyLink} style={{ cursor: "pointer" }}
                  className="col-span-2 flex items-center justify-center gap-2 rounded-2xl border border-border py-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors">
                  <Icon name={copied ? "Check" : "Link"} size={14} />
                  {copied ? "Ссылка скопирована!" : "Скопировать ссылку"}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}