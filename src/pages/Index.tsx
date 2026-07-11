import { lazy, Suspense } from "react"
import { CustomCursor } from "@/components/custom-cursor"
import { GrainOverlay } from "@/components/grain-overlay"
import { WorkSection } from "@/components/sections/work-section"
import { ShopSection } from "@/components/sections/shop-section"
import { ServicesSection } from "@/components/sections/services-section"
import { AboutSection } from "@/components/sections/about-section"
import { ContactSection } from "@/components/sections/contact-section"
import { ArticlesSection } from "@/components/sections/articles-section"
import { FaqSection } from "@/components/sections/faq-section"
import { ConfiguratorSection } from "@/components/sections/configurator-section"
import { MagneticButton } from "@/components/magnetic-button"
import { useRef, useEffect, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import NotificationBell from "@/components/NotificationBell"
import { useTheme } from "@/store/theme"
import { useGpuDetection } from "@/hooks/useGpuDetection"

// Тяжёлый WebGL-фон грузится отдельным чанком только когда включён (см. ниже).
const ShaderBackground = lazy(() => import("@/components/ShaderBackground"))

export default function Index() {
  const navigate = useNavigate()
  const { getShaderColors } = useTheme()
  const shaderColors = getShaderColors()
  const mode = "dark" as const
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [currentSection, setCurrentSection] = useState(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const [mouseIntensity, setMouseIntensity] = useState(0)
  const mouseTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const touchStartY = useRef(0)
  const touchStartX = useRef(0)
  const shaderContainerRef = useRef<HTMLDivElement>(null)
  const scrollThrottleRef = useRef<number>()
  const { shaderEnabled, detecting } = useGpuDetection()

  const handleMouseMove = useCallback(() => {
    setMouseIntensity(1)
    clearTimeout(mouseTimerRef.current)
    mouseTimerRef.current = setTimeout(() => setMouseIntensity(0), 2000)
  }, [])

  useEffect(() => {
    // Если шейдер выключен или ещё определяется — просто ждём конца detecting
    if (!detecting && !shaderEnabled) {
      setIsLoaded(true)
      return
    }

    if (detecting) return

    const checkShaderReady = () => {
      if (shaderContainerRef.current) {
        const canvas = shaderContainerRef.current.querySelector("canvas")
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          setIsLoaded(true)
          return true
        }
      }
      return false
    }

    if (checkShaderReady()) return

    const intervalId = setInterval(() => {
      if (checkShaderReady()) {
        clearInterval(intervalId)
      }
    }, 100)

    const fallbackTimer = setTimeout(() => {
      setIsLoaded(true)
    }, 1500)

    return () => {
      clearInterval(intervalId)
      clearTimeout(fallbackTimer)
    }
  }, [detecting, shaderEnabled])

  const scrollToSection = (index: number) => {
    if (scrollContainerRef.current) {
      const sectionHeight = scrollContainerRef.current.offsetHeight
      scrollContainerRef.current.scrollTo({
        top: sectionHeight * index,
        behavior: "smooth",
      })
      setCurrentSection(index)
    }
  }

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0].clientY
      touchStartX.current = e.touches[0].clientX
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (Math.abs(e.touches[0].clientY - touchStartY.current) > 10) {
        e.preventDefault()
      }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndY = e.changedTouches[0].clientY
      const touchEndX = e.changedTouches[0].clientX
      const deltaY = touchStartY.current - touchEndY
      const deltaX = touchStartX.current - touchEndX

      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 50) {
        if (deltaY > 0 && currentSection < 8) {
          scrollToSection(currentSection + 1)
        } else if (deltaY < 0 && currentSection > 0) {
          scrollToSection(currentSection - 1)
        }
      }
    }

    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener("touchstart", handleTouchStart, { passive: true })
      container.addEventListener("touchmove", handleTouchMove, { passive: false })
      container.addEventListener("touchend", handleTouchEnd, { passive: true })
    }

    return () => {
      if (container) {
        container.removeEventListener("touchstart", handleTouchStart)
        container.removeEventListener("touchmove", handleTouchMove)
        container.removeEventListener("touchend", handleTouchEnd)
      }
    }
  }, [currentSection])

  const wheelLockRef = useRef(false)

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (wheelLockRef.current) return
      if (Math.abs(e.deltaY) < 10) return

      wheelLockRef.current = true
      setTimeout(() => { wheelLockRef.current = false }, 900)

      if (e.deltaY > 0 && currentSection < 8) {
        scrollToSection(currentSection + 1)
      } else if (e.deltaY < 0 && currentSection > 0) {
        scrollToSection(currentSection - 1)
      }
    }

    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false })
    }

    return () => {
      if (container) {
        container.removeEventListener("wheel", handleWheel)
      }
    }
  }, [currentSection])

  useEffect(() => {
    const handleScroll = () => {
      if (scrollThrottleRef.current) return

      scrollThrottleRef.current = requestAnimationFrame(() => {
        if (!scrollContainerRef.current) {
          scrollThrottleRef.current = undefined
          return
        }

        const sectionHeight = scrollContainerRef.current.offsetHeight
        const scrollTop = scrollContainerRef.current.scrollTop
        const newSection = Math.round(scrollTop / sectionHeight)

        if (newSection !== currentSection && newSection >= 0 && newSection <= 8) {
          setCurrentSection(newSection)
        }

        scrollThrottleRef.current = undefined
      })
    }

    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true })
    }

    return () => {
      if (container) {
        container.removeEventListener("scroll", handleScroll)
      }
      if (scrollThrottleRef.current) {
        cancelAnimationFrame(scrollThrottleRef.current)
      }
    }
  }, [currentSection])

  return (
    <main className="relative h-screen w-full overflow-hidden" style={{ background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}>
      <GrainOverlay />

      {/* Фон: слои снизу вверх */}
      <div
        ref={shaderContainerRef}
        className={`fixed inset-0 z-0 transition-opacity duration-700 ${(isLoaded && !detecting) ? "opacity-100" : "opacity-0"}`}
        style={{ contain: "strict" }}
        onMouseMove={handleMouseMove}
      >
        <div
          className="absolute inset-0 transition-colors duration-500"
          style={{ background: "hsl(var(--background))" }}
        />

        {shaderEnabled && (
          <>
            <Suspense fallback={null}>
              <ShaderBackground shaderColors={shaderColors} mode={mode} />
            </Suspense>

            <div
              className="absolute inset-0 transition-opacity duration-500"
              style={{
                background: `radial-gradient(ellipse 90% 70% at 50% 45%, ${shaderColors.glow.replace("88", "50")} 0%, transparent 70%)`,
                opacity: mode === "light" ? 0.5 : 0.8,
              }}
            />

            <div
              className="absolute inset-0 pointer-events-none transition-opacity duration-500"
              style={{
                opacity: mouseIntensity * (mode === "light" ? 0.4 : 1),
                background: `radial-gradient(ellipse 75% 55% at 50% 45%, ${shaderColors.glow} 0%, transparent 80%)`,
                mixBlendMode: "screen",
              }}
            />
          </>
        )}

        {!shaderEnabled && !detecting && (
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 80% 60% at 50% 40%, ${shaderColors.glow.replace("88", "25")} 0%, transparent 70%)`,
            }}
          />
        )}

        {mode === "light" && (
          <div
            className="absolute inset-0 transition-opacity duration-500"
            style={{ background: "rgba(255,255,255,0.35)" }}
          />
        )}
      </div>

      <nav
        className={`fixed left-0 right-0 top-0 z-50 flex items-center justify-between px-6 py-6 transition-opacity duration-700 md:px-12 ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          onClick={() => scrollToSection(0)}
          className="flex items-center gap-2 transition-transform hover:scale-105"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground/15 backdrop-blur-md transition-all duration-300 hover:scale-110 hover:bg-foreground/25">
            <span className="font-sans text-xl font-bold text-foreground">B</span>
          </div>
          <span className="font-sans text-xl font-semibold tracking-tight text-foreground">BeGraphics</span>
        </button>

        <div className="hidden items-center gap-8 md:flex">
          {["Главная", "Сборки", "Магазин", "Услуги", "Конфигуратор", "О нас", "Статьи", "Вопрос-ответ", "Контакты"].map((item, index) => (
            <button
              key={item}
              onClick={() => scrollToSection(index)}
              className={`group relative font-sans text-sm font-medium transition-colors ${
                currentSection === index ? "text-foreground" : "text-foreground/80 hover:text-foreground"
              }`}
            >
              {item}
              <span
                className={`absolute -bottom-1 left-0 h-px bg-foreground transition-all duration-300 ${
                  currentSection === index ? "w-full" : "w-0 group-hover:w-full"
                }`}
              />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <NotificationBell />
          <MagneticButton variant="secondary" onClick={() => navigate("/shop")}>
            Каталог
          </MagneticButton>
          <button
            onClick={() => navigate("/admin")}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/10 backdrop-blur-md transition-all hover:bg-foreground/20"
            title="Панель управления"
          >
            <Icon name="Settings" size={16} className="text-foreground/60" />
          </button>
        </div>
      </nav>

      {/* Вертикальные точки-индикаторы */}
      <div className={`fixed right-6 top-1/2 z-50 -translate-y-1/2 flex flex-col gap-2 transition-opacity duration-700 ${isLoaded ? "opacity-100" : "opacity-0"}`}>
        {Array.from({ length: 9 }).map((_, i) => (
          <button
            key={i}
            onClick={() => scrollToSection(i)}
            className={`h-2 w-2 rounded-full transition-all duration-300 ${
              currentSection === i ? "bg-foreground scale-125" : "bg-foreground/30 hover:bg-foreground/60"
            }`}
          />
        ))}
      </div>

      <div
        ref={scrollContainerRef}
        data-scroll-container
        className={`relative z-10 h-screen overflow-x-hidden overflow-y-auto transition-opacity duration-700 ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none", scrollSnapType: "y mandatory" }}
      >
        {/* Hero Section */}
        <section className="flex h-screen w-full flex-col justify-end px-6 pb-16 pt-24 md:px-12 md:pb-24" style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}>
          <div className="max-w-3xl">
            <div className="mb-4 inline-block animate-in fade-in slide-in-from-bottom-4 rounded-full border border-foreground/20 bg-foreground/15 px-4 py-1.5 backdrop-blur-md duration-700">
              <p className="font-mono text-xs text-foreground/90">Сборка ПК на заказ и продажа комплектующих</p>
            </div>
            <h1 className="mb-6 animate-in fade-in slide-in-from-bottom-8 font-sans text-6xl font-light leading-[1.1] tracking-tight text-foreground duration-1000 md:text-7xl lg:text-8xl">
              <span className="text-balance">Решение именно
под ваши задачи</span>
            </h1>
            <p className="mb-8 max-w-xl animate-in fade-in slide-in-from-bottom-4 text-lg leading-relaxed text-foreground/90 duration-1000 delay-200 md:text-xl">
              <span className="text-pretty">
                Собираем ПК на заказ и продаём комплектующие. Игровые станции, рабочие машины, серверы — под любой бюджет и задачу.
              </span>
            </p>
            <div className="flex animate-in fade-in slide-in-from-bottom-4 flex-col gap-4 duration-1000 delay-300 sm:flex-row sm:items-center">
              <MagneticButton
                size="lg"
                variant="primary"
                onClick={() => navigate("/shop")}
              >
                Открыть каталог
              </MagneticButton>
              <MagneticButton size="lg" variant="secondary" onClick={() => navigate("/configurator")}>
                Конфигуратор ПК
              </MagneticButton>
            </div>
          </div>

          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-in fade-in duration-1000 delay-500">
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs text-foreground/80">Листайте вниз</p>
              <div className="flex h-6 w-6 items-center justify-center rounded-full border border-foreground/20 bg-foreground/15 backdrop-blur-md">
                <div className="h-2 w-2 animate-bounce rounded-full bg-foreground/80" />
              </div>
            </div>
          </div>
        </section>

        <WorkSection />
        <ShopSection />
        <ServicesSection />
        <ConfiguratorSection />
        <AboutSection scrollToSection={scrollToSection} />
        <ArticlesSection />
        <FaqSection />
        <ContactSection />
      </div>

      <style>{`
        div::-webkit-scrollbar {
          display: none;
        }
        [data-scroll-container] > section {
          scroll-snap-align: start;
          scroll-snap-stop: always;
        }
      `}</style>
    </main>
  )
}