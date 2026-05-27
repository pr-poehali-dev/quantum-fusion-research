import { useState } from "react"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"
import { CableBody } from "./cable-configurator-body"
import { PinColors } from "./cable-configurator.types"

export { CableBody } from "./cable-configurator-body"

// ─── Экспорт ──────────────────────────────────────────────────────────────────
export function CableConfigurator({ standalone = false }: { standalone?: boolean }) {
  const { addItem } = useCart()
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState(false)

  const handleAddToCart = async (name: string, summary: string, pinColors: PinColors, cpuType: string, gpuType: string) => {
    // Сохраняем конфигурацию в БД
    try {
      await api.cables.create({ name, cpu_type: cpuType, gpu_type: gpuType, pin_colors: pinColors })
    } catch {
      // Не блокируем добавление в корзину если БД недоступна
    }
    addItem({ id: Date.now(), name: `Кастомные кабели C-Cables: ${name}`, price: 0, type: "config" })
    setAdded(true)
    setTimeout(() => setAdded(false), 3000)
  }

  if (standalone) return <CableBody addToCart={handleAddToCart} added={added} />

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between p-5" style={{ cursor: "pointer" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name="Cable" size={16} />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-foreground">Кастомные кабели</p>
            <p className="text-xs text-foreground/50">C-Cables · настрой каждый пин</p>
          </div>
        </div>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} className="text-foreground/40" />
      </button>
      {open && (
        <div className="border-t border-border px-5 pb-5 pt-4">
          <CableBody addToCart={handleAddToCart} added={added} />
        </div>
      )}
    </div>
  )
}
