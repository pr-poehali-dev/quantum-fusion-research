import { useReveal } from "@/hooks/use-reveal"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { useNavigate } from "react-router-dom"

interface Build {
  id: number
  name: string
  description: string
  total_price: number
  parts_total: number
  assembly_fee: number
  components: Array<{ name: string; slot: string; current_price: number }>
  status: string
  parent_id: number | null
}

interface Product {
  id: number
  name: string
  price: number
  category: { name: string } | null
}

export function WorkSection() {
  const { ref, isVisible } = useReveal(0.3)
  const [builds, setBuilds] = useState<Build[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    api.builds.getAll({ status: "catalog" }).then(d => {
      const list = Array.isArray(d) ? d : (d.builds || [])
      // Показываем только корневые сборки (без parent_id)
      setBuilds(list.filter((b: Build) => !b.parent_id).slice(0, 3))
    })
    api.products.getAll({ featured: "true" }).then(d => setProducts((d.products || []).slice(0, 3)))
  }, [])

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const items = builds.length > 0
    ? builds.map((b, i) => ({
        number: String(i + 1).padStart(2, "0"),
        title: b.name,
        category: b.components.slice(0, 2).map(c => c.name).join(" · "),
        price: fmt(b.total_price),
        direction: i % 2 === 0 ? "left" : "right",
        onClick: () => navigate(`/shop?build=${b.id}`),
      }))
    : products.map((p, i) => ({
        number: String(i + 1).padStart(2, "0"),
        title: p.name,
        category: p.category?.name || "Комплектующее",
        price: fmt(p.price),
        direction: i % 2 === 0 ? "left" : "right",
        onClick: () => navigate("/shop"),
      }))

  return (
    <section
      ref={ref}
      className="flex h-screen w-screen shrink-0 snap-start items-center px-6 pt-20 md:px-12 md:pt-0 lg:px-16"
    >
      <div className="mx-auto w-full max-w-7xl">
        <div
          className={`mb-12 transition-all duration-700 md:mb-16 ${
            isVisible ? "translate-x-0 opacity-100" : "-translate-x-12 opacity-0"
          }`}
        >
          <h2 className="mb-2 font-sans text-5xl font-light tracking-tight text-foreground md:text-6xl lg:text-7xl">
            Сборки
          </h2>
          <p className="font-mono text-sm text-foreground/60 md:text-base">/ Популярные конфигурации</p>
        </div>

        <div className="space-y-6 md:space-y-8">
          {items.map((item, i) => (
            <ProjectCard key={i} item={item} index={i} isVisible={isVisible} />
          ))}
        </div>

        <div
          className={`mt-10 transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
          style={{ transitionDelay: "600ms" }}
        >
          <button
            onClick={() => navigate("/shop")}
            className="font-mono text-sm text-foreground/50 hover:text-foreground transition-colors border-b border-foreground/20 hover:border-foreground/50 pb-0.5"
          >
            Смотреть все сборки →
          </button>
        </div>
      </div>
    </section>
  )
}

function ProjectCard({
  item,
  index,
  isVisible,
}: {
  item: { number: string; title: string; category: string; price: string; direction: string; onClick: () => void }
  index: number
  isVisible: boolean
}) {
  const getRevealClass = () => {
    if (!isVisible) return item.direction === "left" ? "-translate-x-16 opacity-0" : "translate-x-16 opacity-0"
    return "translate-x-0 opacity-100"
  }

  return (
    <button
      onClick={item.onClick}
      className={`group flex w-full items-center justify-between border-b border-foreground/10 py-6 transition-all duration-700 hover:border-primary/40 text-left md:py-8 ${getRevealClass()}`}
      style={{
        transitionDelay: `${index * 150}ms`,
        marginLeft: index % 2 === 0 ? "0" : "auto",
        maxWidth: index % 2 === 0 ? "85%" : "90%",
        cursor: "pointer",
      }}
    >
      <div className="flex items-baseline gap-4 md:gap-8">
        <span className="font-mono text-sm text-foreground/30 transition-colors group-hover:text-primary/60 md:text-base">
          {item.number}
        </span>
        <div>
          <h3 className="mb-1 font-sans text-2xl font-light text-foreground transition-transform duration-300 group-hover:translate-x-2 group-hover:text-primary/90 md:text-3xl lg:text-4xl">
            {item.title}
          </h3>
          <p className="font-mono text-xs text-foreground/50 md:text-sm line-clamp-1">{item.category}</p>
        </div>
      </div>
      <span className="font-mono text-xs text-foreground/40 group-hover:text-primary md:text-sm transition-colors">{item.price}</span>
    </button>
  )
}