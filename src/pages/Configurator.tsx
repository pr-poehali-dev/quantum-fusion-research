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
  brand?: string
  price: number
  specs: Record<string, string>
  source: "catalog" | "custom"
}

interface SelectedComponent {
  slot: string
  name: string
  price: number
  source: "catalog" | "custom"
  source_id?: number
}

export default function Configurator() {
  const [slots, setSlots] = useState<Record<string, Component[]>>({})
  const [selected, setSelected] = useState<Record<string, SelectedComponent | null>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, { name: string; price: string }>>({})
  const [mode, setMode] = useState<"catalog" | "custom">("catalog")
  const [openSlot, setOpenSlot] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [wantAssembly, setWantAssembly] = useState(true)
  const { addItem, count } = useCart()
  const navigate = useNavigate()

  useEffect(() => {
    api.configurator.getSlots().then(data => {
      setSlots(data.slots || {})
      setLoading(false)
    })
  }, [])

  const partsTotal = Object.values(selected).reduce((sum, c) => sum + (c?.price || 0), 0)
  const assemblyFee = wantAssembly ? Math.round(partsTotal * 0.07) : 0
  const total = partsTotal + assemblyFee
  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const requiredSlots = Object.entries(SLOT_LABELS).filter(([, v]) => v.required).map(([k]) => k)
  const isComplete = requiredSlots.every(slot => selected[slot])

  // Проверяем — все ли выбранные компоненты из нашего каталога
  const allFromCatalog = Object.values(selected).filter(Boolean).every(c => c?.source === "catalog")
  const hasComponents = Object.values(selected).some(Boolean)

  const addToCart = () => {
    const components = Object.values(selected).filter(Boolean) as SelectedComponent[]
    const names = components.map(c => c.name).join(", ").substring(0, 80)
    addItem({
      id: Date.now(),
      name: `Сборка: ${names}`,
      price: total,
      type: "config",
    })
    navigate("/cart")
  }

  const selectFromCatalog = (slot: string, comp: Component) => {
    setSelected(s => ({ ...s, [slot]: { slot, name: comp.name, price: comp.price, source: "catalog", source_id: comp.id } }))
    setOpenSlot(null)
  }

  const applyCustom = (slot: string) => {
    const input = customInputs[slot]
    if (!input?.name || !input?.price) return
    setSelected(s => ({ ...s, [slot]: { slot, name: input.name, price: parseFloat(input.price) || 0, source: "custom" } }))
    setOpenSlot(null)
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
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
              <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">{count()}</span>
            )}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-light text-foreground">Конфигуратор ПК</h1>
          <p className="text-sm text-foreground/60">Соберите конфиг из нашего каталога или укажите своё железо</p>
        </div>

        {/* Mode toggle */}
        <div className="mb-6 flex overflow-hidden rounded-xl border border-border">
          <button
            onClick={() => setMode("catalog")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${mode === "catalog" ? "bg-primary text-primary-foreground" : "bg-card text-foreground/70 hover:text-foreground"}`}
            style={{ cursor: "pointer" }}
          >
            <Icon name="ShoppingBag" size={16} />
            Из нашего каталога
          </button>
          <button
            onClick={() => setMode("custom")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${mode === "custom" ? "bg-primary text-primary-foreground" : "bg-card text-foreground/70 hover:text-foreground"}`}
            style={{ cursor: "pointer" }}
          >
            <Icon name="PenLine" size={16} />
            Своё железо
          </button>
        </div>

        {/* Assembly offer banner */}
        {mode === "custom" && hasComponents && allFromCatalog && (
          <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center gap-4">
            <Icon name="Sparkles" size={20} className="text-primary shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Все компоненты из нашего каталога!</p>
              <p className="text-xs text-foreground/60">Мы можем собрать этот ПК за 7% от стоимости железа — {fmt(Math.round(partsTotal * 0.07))}</p>
            </div>
            <button onClick={() => setWantAssembly(true)} className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
              Добавить сборку
            </button>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          {/* Slots */}
          <div className="space-y-3">
            {loading ? (
              [...Array(6)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />)
            ) : (
              Object.entries(SLOT_LABELS).map(([slot, meta]) => {
                const options = slots[slot] || []
                const current = selected[slot]
                const isOpen = openSlot === slot
                const customInput = customInputs[slot] || { name: "", price: "" }

                return (
                  <div key={slot} className={`rounded-xl border bg-card transition-all ${current ? "border-primary/40" : "border-border"}`}>
                    <div className="flex items-center gap-3 p-4">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${current ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/40"}`}>
                        <Icon name={meta.icon as "Cpu"} size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{meta.label}</p>
                        {current ? (
                          <p className="text-xs text-foreground/50 truncate">{current.name} — {fmt(current.price)}</p>
                        ) : (
                          <p className="text-xs text-foreground/30">{meta.required ? "Обязательный" : "Необязательный"}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {current && (
                          <button onClick={() => setSelected(s => ({ ...s, [slot]: null }))} className="text-foreground/30 hover:text-foreground/60" style={{ cursor: "pointer" }}>
                            <Icon name="X" size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => setOpenSlot(isOpen ? null : slot)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${current ? "border-primary/30 text-primary hover:bg-primary/10" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
                          style={{ cursor: "pointer" }}
                        >
                          {current ? "Заменить" : "Выбрать"}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-border p-4">
                        {mode === "catalog" ? (
                          options.length === 0 ? (
                            <p className="text-xs text-foreground/40 text-center py-4">Нет доступных компонентов</p>
                          ) : (
                            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                              {options.map(opt => (
                                <button
                                  key={opt.id}
                                  onClick={() => selectFromCatalog(slot, opt)}
                                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left hover:border-primary transition-colors"
                                  style={{ cursor: "pointer" }}
                                >
                                  <div className="min-w-0 mr-2">
                                    <p className="text-xs font-medium text-foreground truncate">{opt.name}</p>
                                    {opt.brand && <p className="text-xs text-foreground/40">{opt.brand}</p>}
                                  </div>
                                  <p className="shrink-0 text-xs font-bold text-accent">{fmt(opt.price)}</p>
                                </button>
                              ))}
                            </div>
                          )
                        ) : (
                          <div className="flex gap-3">
                            <input
                              type="text"
                              placeholder="Название компонента"
                              value={customInput.name}
                              onChange={e => setCustomInputs(c => ({ ...c, [slot]: { ...customInput, name: e.target.value } }))}
                              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                              style={{ cursor: "text" }}
                            />
                            <input
                              type="number"
                              placeholder="Цена ₽"
                              value={customInput.price}
                              onChange={e => setCustomInputs(c => ({ ...c, [slot]: { ...customInput, price: e.target.value } }))}
                              className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                              style={{ cursor: "text" }}
                            />
                            <button
                              onClick={() => applyCustom(slot)}
                              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                              style={{ cursor: "pointer" }}
                            >
                              OK
                            </button>
                          </div>
                        )}
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
                      <span className={c ? "text-foreground font-medium" : "text-foreground/20"}>{c ? fmt(c.price) : "—"}</span>
                    </div>
                  )
                })}
              </div>

              {/* Assembly toggle */}
              <div className="mb-4 border-t border-border pt-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-foreground">Сборка от PCPRO</p>
                    <p className="text-xs text-foreground/50">7% от стоимости железа</p>
                  </div>
                  <button
                    onClick={() => setWantAssembly(w => !w)}
                    className={`relative h-6 w-11 rounded-full transition-colors ${wantAssembly ? "bg-primary" : "bg-muted"}`}
                    style={{ cursor: "pointer" }}
                  >
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${wantAssembly ? "left-6" : "left-1"}`} />
                  </button>
                </label>
                {wantAssembly && partsTotal > 0 && (
                  <p className="mt-1 text-right text-xs text-primary">+ {fmt(assemblyFee)}</p>
                )}
              </div>

              <div className="mb-6 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-foreground/70">Итого:</span>
                  <span className="text-2xl font-bold text-foreground">{fmt(total)}</span>
                </div>
              </div>

              {hasComponents && allFromCatalog && mode === "custom" && (
                <div className="mb-3 rounded-lg bg-primary/10 border border-primary/20 p-3">
                  <p className="text-xs text-primary font-medium">Всё железо из нашего каталога — мы соберём ПК за вас!</p>
                </div>
              )}

              <button
                onClick={addToCart}
                disabled={!isComplete}
                className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                style={{ cursor: isComplete ? "pointer" : "not-allowed" }}
              >
                {isComplete ? "Добавить в корзину" : "Выберите обязательные компоненты"}
              </button>
              <p className="mt-3 text-center text-xs text-foreground/40">Менеджер свяжется для подтверждения деталей</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
