import { useState, useEffect } from "react"
import { useCart } from "@/store/cart"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { useNavigate } from "react-router-dom"

const SLOT_LABELS: Record<string, { label: string; icon: string; required: boolean }> = {
  cpu: { label: "Процессор", icon: "Cpu", required: true },
  gpu: { label: "Видеокарта", icon: "Monitor", required: true },
  ram: { label: "Оперативная память", icon: "MemoryStick", required: true },
  storage: { label: "Накопитель", icon: "HardDrive", required: true },
  psu: { label: "Блок питания", icon: "Zap", required: true },
  case: { label: "Корпус", icon: "Box", required: false },
}

interface Component {
  id: number
  slot: string
  name: string
  brand: string
  price: number
  specs: Record<string, string>
}

export default function Configurator() {
  const [slots, setSlots] = useState<Record<string, Component[]>>({})
  const [selected, setSelected] = useState<Record<string, Component | null>>({})
  const [loading, setLoading] = useState(true)
  const { addItem, count } = useCart()
  const navigate = useNavigate()

  useEffect(() => {
    api.configurator.getSlots().then(data => {
      setSlots(data.slots || {})
      setLoading(false)
    })
  }, [])

  const total = Object.values(selected).reduce((sum, c) => sum + (c?.price || 0), 0)
  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const requiredSlots = Object.entries(SLOT_LABELS).filter(([, v]) => v.required).map(([k]) => k)
  const isComplete = requiredSlots.every(slot => selected[slot])

  const addToCart = () => {
    const components = Object.values(selected).filter(Boolean) as Component[]
    const names = components.map(c => c.name).join(" + ")
    addItem({
      id: Date.now(),
      name: `Сборка: ${names.substring(0, 60)}...`,
      price: total,
      type: "config",
    })
    navigate("/cart")
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">P</div>
            <span className="font-semibold text-lg text-foreground">PCPRO</span>
          </button>
          <nav className="hidden items-center gap-6 md:flex">
            <button onClick={() => navigate("/shop")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Каталог</button>
            <button onClick={() => navigate("/configurator")} className="text-sm font-medium text-primary" style={{ cursor: "pointer" }}>Конфигуратор</button>
          </nav>
          <button
            onClick={() => navigate("/cart")}
            className="relative flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:border-primary transition-colors"
            style={{ cursor: "pointer" }}
          >
            <Icon name="ShoppingCart" size={16} />
            <span>Корзина</span>
            {count() > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">
                {count()}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-light text-foreground">Конфигуратор ПК</h1>
          <p className="text-sm text-foreground/60">Выберите компоненты и соберите идеальный ПК</p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          {/* Slots */}
          <div className="space-y-4">
            {loading ? (
              [...Array(6)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />)
            ) : (
              Object.entries(SLOT_LABELS).map(([slot, meta]) => {
                const options = slots[slot] || []
                const current = selected[slot]
                return (
                  <div key={slot} className={`rounded-xl border bg-card p-5 transition-all ${current ? "border-primary/40" : "border-border"}`}>
                    <div className="mb-3 flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${current ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/40"}`}>
                        <Icon name={meta.icon as "Cpu"} size={16} />
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-foreground">{meta.label}</h3>
                        {meta.required && !current && <p className="text-xs text-foreground/40">Обязательный компонент</p>}
                      </div>
                      {current && (
                        <button
                          onClick={() => setSelected(s => ({ ...s, [slot]: null }))}
                          className="ml-auto text-xs text-foreground/40 hover:text-foreground transition-colors"
                          style={{ cursor: "pointer" }}
                        >
                          <Icon name="X" size={14} />
                        </button>
                      )}
                    </div>

                    {current ? (
                      <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{current.name}</p>
                          <p className="text-xs text-foreground/50">{current.brand}</p>
                        </div>
                        <p className="text-sm font-bold text-primary">{fmt(current.price)}</p>
                      </div>
                    ) : (
                      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                        {options.slice(0, 6).map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => setSelected(s => ({ ...s, [slot]: opt }))}
                            className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left hover:border-primary transition-colors group"
                            style={{ cursor: "pointer" }}
                          >
                            <div className="min-w-0 mr-2">
                              <p className="text-xs font-medium text-foreground truncate">{opt.name}</p>
                              <p className="text-xs text-foreground/40">{opt.brand}</p>
                            </div>
                            <p className="shrink-0 text-xs font-bold text-accent">{fmt(opt.price)}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Summary */}
          <div className="lg:sticky lg:top-24 h-fit">
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 text-lg font-medium text-foreground">Итого</h2>
              <div className="mb-4 space-y-2">
                {Object.entries(SLOT_LABELS).map(([slot, meta]) => {
                  const c = selected[slot]
                  return (
                    <div key={slot} className="flex items-center justify-between text-sm">
                      <span className="text-foreground/50">{meta.label}</span>
                      <span className={c ? "text-foreground font-medium" : "text-foreground/20"}>
                        {c ? fmt(c.price) : "—"}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="mb-6 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-foreground/70">Итого:</span>
                  <span className="text-2xl font-bold text-foreground">{fmt(total)}</span>
                </div>
              </div>
              <button
                onClick={addToCart}
                disabled={!isComplete}
                className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                style={{ cursor: isComplete ? "pointer" : "not-allowed" }}
              >
                {isComplete ? "Добавить в корзину" : "Выберите обязательные компоненты"}
              </button>
              <p className="mt-3 text-center text-xs text-foreground/40">
                После оформления менеджер свяжется для подтверждения
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
