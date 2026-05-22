import { useReveal } from "@/hooks/use-reveal"
import { useNavigate } from "react-router-dom"
import { MagneticButton } from "@/components/magnetic-button"

export function ConfiguratorSection() {
  const { ref, isVisible } = useReveal(0.3)
  const navigate = useNavigate()

  const features = [
    {
      icon: "🖥️",
      title: "Из наших комплектующих",
      desc: "Весь ассортимент BeGraphics в одном месте — видеокарты, процессоры, память, корпуса. Подбираем по бюджету и задачам.",
    },
    {
      icon: "🛒",
      title: "Из любых магазинов",
      desc: "Нашли деталь на Ozon, Wildberries или AliExpress? Добавьте в конфигуратор — мы соберём и проверим совместимость.",
    },
    {
      icon: "⚡",
      title: "Готовая сборка за минуты",
      desc: "Конфигуратор автоматически считает итоговую стоимость, стоимость сборки и проверяет совместимость компонентов.",
    },
  ]

  return (
    <section
      ref={ref}
      className="flex h-screen w-full items-center px-6 pt-20 md:px-12 md:pt-0 lg:px-16"
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className={`transition-all duration-700 ${isVisible ? "translate-y-0 opacity-100" : "-translate-y-12 opacity-0"}`}>
          <h2 className="mb-2 font-sans text-5xl font-light tracking-tight text-foreground md:text-6xl lg:text-7xl">
            Конфигуратор
          </h2>
          <p className="mb-10 font-mono text-sm text-foreground/60 md:text-base">/ Соберите ПК мечты</p>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mb-10">
          {features.map((f, i) => (
            <div
              key={i}
              className={`rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-6 transition-all duration-700`}
              style={{ transitionDelay: `${i * 120}ms`, opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(24px)" }}
            >
              <div className="mb-4 text-3xl">{f.icon}</div>
              <h3 className="mb-2 font-sans text-lg font-medium text-foreground">{f.title}</h3>
              <p className="text-sm leading-relaxed text-foreground/60">{f.desc}</p>
            </div>
          ))}
        </div>

        <div
          className="transition-all duration-700"
          style={{ transitionDelay: "400ms", opacity: isVisible ? 1 : 0, transform: isVisible ? "translateY(0)" : "translateY(16px)" }}
        >
          <MagneticButton size="lg" variant="primary" onClick={() => navigate("/configurator")}>
            Открыть конфигуратор →
          </MagneticButton>
        </div>
      </div>
    </section>
  )
}