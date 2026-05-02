import { useReveal } from "@/hooks/use-reveal"
import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"

interface Product {
  id: number
  name: string
  price: number
  old_price: number | null
  image_url: string | null
  category: { name: string; slug: string } | null
  is_featured: boolean
}

const SLOT_ICONS: Record<string, string> = {
  gpu: "Monitor", cpu: "Cpu", ram: "MemoryStick",
  storage: "HardDrive", psu: "Zap", case: "Package", motherboard: "CircuitBoard",
}

export function ShopSection() {
  const { ref, isVisible } = useReveal(0.2)
  const [products, setProducts] = useState<Product[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    api.products.getAll({ featured: "true" }).then(d => {
      const list = d.products || []
      setProducts(list.slice(0, 6))
    })
  }, [])

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  return (
    <section
      ref={ref}
      className="flex h-screen w-screen shrink-0 snap-start items-center px-6 pt-20 md:px-12 md:pt-0 lg:px-16"
    >
      <div className="mx-auto w-full max-w-7xl">

        {/* Заголовок */}
        <div className={`mb-10 flex items-end justify-between transition-all duration-700 ${isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-12"}`}>
          <div>
            <h2 className="mb-2 font-sans text-5xl font-light tracking-tight text-foreground md:text-6xl lg:text-7xl">
              Магазин
            </h2>
            <p className="font-mono text-sm text-foreground/60 md:text-base">/ Комплектующие в наличии</p>
          </div>
          <button
            onClick={() => navigate("/shop")}
            className="hidden md:flex items-center gap-2 font-mono text-sm text-foreground/50 hover:text-foreground transition-colors border-b border-foreground/20 hover:border-foreground/50 pb-0.5"
            style={{ cursor: "pointer" }}
          >
            Весь каталог →
          </button>
        </div>

        {/* Сетка товаров */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {products.length === 0
            ? [...Array(6)].map((_, i) => (
                <div key={i} className="h-36 rounded-2xl bg-card/60 animate-pulse" style={{ transitionDelay: `${i * 80}ms` }} />
              ))
            : products.map((p, i) => {
                const icon = SLOT_ICONS[p.category?.slug || ""] || "Package"
                return (
                  <button
                    key={p.id}
                    onClick={() => navigate("/shop")}
                    style={{ transitionDelay: `${i * 80}ms`, cursor: "pointer" }}
                    className={`group flex flex-col rounded-2xl border border-foreground/8 bg-card/60 p-4 text-left transition-all duration-700 hover:border-primary/40 hover:bg-card ${
                      isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                    }`}
                  >
                    {/* Фото или иконка */}
                    <div className="mb-3 flex h-20 w-full items-center justify-center overflow-hidden rounded-xl bg-muted/60">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="h-full w-full object-contain p-2 transition-transform duration-500 group-hover:scale-105" />
                      ) : (
                        <Icon name={icon as "Cpu"} size={28} className="text-foreground/20 group-hover:text-primary/40 transition-colors" />
                      )}
                    </div>

                    {/* Категория */}
                    <p className="mb-0.5 font-mono text-[10px] uppercase tracking-widest text-foreground/30">
                      {p.category?.name || "Товар"}
                    </p>

                    {/* Название */}
                    <p className="mb-2 text-xs font-medium text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                      {p.name}
                    </p>

                    {/* Цена */}
                    <div className="mt-auto">
                      {p.old_price && (
                        <p className="font-mono text-[10px] text-foreground/30 line-through">{fmt(p.old_price)}</p>
                      )}
                      <p className="font-mono text-sm font-bold text-primary">{fmt(p.price)}</p>
                    </div>
                  </button>
                )
              })
          }
        </div>

        {/* Кнопка на мобиле */}
        <div className={`mt-8 md:hidden transition-all duration-700 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
          <button
            onClick={() => navigate("/shop")}
            className="font-mono text-sm text-foreground/50 hover:text-foreground transition-colors border-b border-foreground/20 hover:border-foreground/50 pb-0.5"
            style={{ cursor: "pointer" }}
          >
            Весь каталог →
          </button>
        </div>

      </div>
    </section>
  )
}
