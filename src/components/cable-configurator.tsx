import { useState } from "react"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"

const PALETTE = [
  { id: "black",              label: "Чёрный",             hex: "#1a1a1a" },
  { id: "white",              label: "Белый",              hex: "#f0f0f0" },
  { id: "gray",               label: "Серый",              hex: "#6b7280" },
  { id: "red",                label: "Красный",            hex: "#dc2626" },
  { id: "crimson",            label: "Бордовый",           hex: "#7f1d1d" },
  { id: "orange",             label: "Оранжевый",          hex: "#ea580c" },
  { id: "yellow",             label: "Жёлтый",             hex: "#ca8a04" },
  { id: "green",              label: "Зелёный",            hex: "#16a34a" },
  { id: "teal",               label: "Бирюзовый",          hex: "#0d9488" },
  { id: "blue",               label: "Синий",              hex: "#2563eb" },
  { id: "indigo",             label: "Индиго",             hex: "#4f46e5" },
  { id: "purple",             label: "Фиолетовый",         hex: "#7c3aed" },
  { id: "pink",               label: "Розовый",            hex: "#db2777" },
  { id: "sleeved-white-black",label: "Бело-чёрная оплётка",hex: "#d4d4d4", pattern: true },
  { id: "sleeved-red-black",  label: "Красно-чёрная оплётка", hex: "#b91c1c", pattern: true },
]

const PALETTE_12V = [
  { id: "black",  label: "Чёрный",  hex: "#1a1a1a" },
  { id: "white",  label: "Белый",   hex: "#f0f0f0" },
  { id: "gray",   label: "Серый",   hex: "#6b7280" },
  { id: "yellow", label: "Жёлтый", hex: "#ca8a04" },
  { id: "green",  label: "Зелёный", hex: "#16a34a" },
]

const CPU_TYPES = ["8-pin", "8+4-pin", "8+8-pin"] as const
const GPU_TYPES = ["8-pin", "8+8-pin", "8+8+8-pin", "12V-2x6"] as const

type CpuType = typeof CPU_TYPES[number]
type GpuType = typeof GPU_TYPES[number]

interface CableState {
  cpu: CpuType; gpu: GpuType
  cpuColor: string; gpuColor: string; atxColor: string
}

function CableConnector({ label, color, pattern }: { label: string; color: string; pattern?: boolean }) {
  return (
    <g>
      <rect width={36} height={14} rx={3} fill={color} opacity={0.95} />
      {pattern && <rect width={36} height={14} rx={3} fill="url(#stripe)" opacity={0.3} />}
      <rect width={36} height={14} rx={3} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={0.8} />
      <text x={18} y={9.5} textAnchor="middle" fontSize={5.5} fill="rgba(255,255,255,0.7)" fontFamily="monospace">{label}</text>
    </g>
  )
}

function CpuCables({ type, hexColor, onClick }: { type: CpuType; hexColor: string; onClick: () => void }) {
  const cables = type === "8-pin" ? ["8-pin"] : type === "8+4-pin" ? ["8-pin", "4-pin"] : ["8-pin", "8-pin"]
  return (
    <g onClick={onClick} style={{ cursor: "pointer" }} className="group">
      {cables.map((label, i) => (
        <g key={i} transform={`translate(${i * 44}, 0)`}>
          <line x1={18} y1={0} x2={18} y2={-28} stroke={hexColor} strokeWidth={4} strokeLinecap="round" opacity={0.8} />
          <line x1={22} y1={0} x2={22} y2={-28} stroke={hexColor} strokeWidth={2.5} strokeLinecap="round" opacity={0.5} />
          <CableConnector label={label} color={hexColor} />
        </g>
      ))}
      <rect x={-4} y={-32} width={cables.length === 1 ? 44 : 88} height={50}
        rx={6} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeDasharray="4 3"
        opacity={0} className="group-hover:opacity-60 transition-opacity" />
    </g>
  )
}

function AtxCable({ hexColor, onClick }: { hexColor: string; onClick: () => void }) {
  return (
    <g onClick={onClick} style={{ cursor: "pointer" }} className="group">
      {[0, 5, 10, 15, 20, 25].map((offset, i) => (
        <line key={i} x1={0} y1={offset + 5} x2={-36} y2={offset + 5}
          stroke={hexColor} strokeWidth={3} strokeLinecap="round" opacity={0.7 - i * 0.05} />
      ))}
      <g transform="translate(-72, 0)">
        <rect width={36} height={44} rx={3} fill={hexColor} opacity={0.95} />
        <rect width={36} height={44} rx={3} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={0.8} />
        <text x={18} y={26} textAnchor="middle" fontSize={5.5} fill="rgba(255,255,255,0.7)" fontFamily="monospace">24-pin</text>
      </g>
      <rect x={-76} y={-4} width={80} height={52} rx={6} fill="none"
        stroke="hsl(var(--primary))" strokeWidth={1.5} strokeDasharray="4 3"
        opacity={0} className="group-hover:opacity-60 transition-opacity" />
    </g>
  )
}

function GpuCables({ type, hexColor, onClick }: { type: GpuType; hexColor: string; onClick: () => void }) {
  const is12v = type === "12V-2x6"
  const cables = type === "8-pin" ? ["8-pin"] : type === "8+8-pin" ? ["8-pin", "8-pin"]
    : type === "8+8+8-pin" ? ["8-pin", "8-pin", "8-pin"] : ["12V-2x6"]
  return (
    <g onClick={onClick} style={{ cursor: "pointer" }} className="group">
      {cables.map((label, i) => (
        <g key={i} transform={`translate(${i * 44}, 0)`}>
          <line x1={18} y1={14} x2={18} y2={44} stroke={hexColor} strokeWidth={4} strokeLinecap="round" opacity={0.8} />
          <line x1={22} y1={14} x2={22} y2={44} stroke={hexColor} strokeWidth={2.5} strokeLinecap="round" opacity={0.5} />
          <CableConnector label={is12v ? "12V-2x6" : label} color={hexColor} />
          <rect x={2} y={40} width={32} height={8} rx={2} fill="rgba(255,255,255,0.08)" />
        </g>
      ))}
      <rect x={-4} y={-4} width={cables.length === 1 ? 44 : cables.length === 2 ? 88 : 132} height={56}
        rx={6} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeDasharray="4 3"
        opacity={0} className="group-hover:opacity-60 transition-opacity" />
    </g>
  )
}

function CableBody({
  cables, activeCable, setActiveCable, addToCart, added, setCables,
}: {
  cables: CableState
  activeCable: "cpu" | "gpu" | "atx" | null
  setActiveCable: (v: "cpu" | "gpu" | "atx" | null) => void
  addToCart: () => void
  added: boolean
  setCables: React.Dispatch<React.SetStateAction<CableState>>
}) {
  const getPalette = () => activeCable === "gpu" && cables.gpu === "12V-2x6" ? PALETTE_12V : PALETTE
  const getHex = (colorId: string, pal = PALETTE) => pal.find(p => p.id === colorId)?.hex ?? "#1a1a1a"

  const cpuHex = getHex(cables.cpuColor)
  const gpuHex = getHex(cables.gpuColor, cables.gpu === "12V-2x6" ? PALETTE_12V : PALETTE)
  const atxHex = getHex(cables.atxColor)

  const activeColorKey = activeCable === "cpu" ? "cpuColor" : activeCable === "gpu" ? "gpuColor" : activeCable === "atx" ? "atxColor" : null

  const setColor = (colorId: string) => {
    if (!activeCable) return
    const key = activeCable === "cpu" ? "cpuColor" : activeCable === "gpu" ? "gpuColor" : "atxColor"
    setCables(prev => ({ ...prev, [key]: colorId }))
  }

  const gpuCableCount = cables.gpu === "8-pin" ? 1 : cables.gpu === "8+8-pin" ? 2 : cables.gpu === "8+8+8-pin" ? 3 : 1
  const svgWidth = Math.max(240, 60 + gpuCableCount * 44 + 80)

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <p className="text-xs text-foreground/50 mb-1.5">CPU кабель</p>
          <div className="flex flex-wrap gap-1.5">
            {CPU_TYPES.map(t => (
              <button key={t} onClick={() => setCables(p => ({ ...p, cpu: t }))}
                className={`rounded-lg border px-3 py-1 text-xs transition-all ${cables.cpu === t ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}
                style={{ cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-foreground/50 mb-1.5">GPU кабель</p>
          <div className="flex flex-wrap gap-1.5">
            {GPU_TYPES.map(t => (
              <button key={t} onClick={() => setCables(p => ({
                ...p, gpu: t,
                gpuColor: t === "12V-2x6" && !PALETTE_12V.find(c => c.id === p.gpuColor) ? "black" : p.gpuColor,
              }))}
                className={`rounded-lg border px-3 py-1 text-xs transition-all ${cables.gpu === t ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}
                style={{ cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
          {cables.gpu === "12V-2x6" && (
            <p className="mt-1.5 text-[10px] text-yellow-400/80">⚡ Специальный кабель — своя палитра цветов</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-background/40 p-3">
        <p className="mb-3 text-[10px] font-mono uppercase tracking-widest text-foreground/30 text-center">Кликни на кабель для смены цвета</p>
        <div className="flex justify-center overflow-x-auto">
          <svg width={svgWidth} height={220} viewBox={`0 0 ${svgWidth} 220`} style={{ maxWidth: "100%" }}>
            <defs>
              <pattern id="stripe" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                <line x1={0} y1={0} x2={0} y2={6} stroke="rgba(255,255,255,0.4)" strokeWidth={2} />
              </pattern>
              <pattern id="board" patternUnits="userSpaceOnUse" width={10} height={10}>
                <rect width={10} height={10} fill="#1c2332" />
                <rect width={10} height={10} fill="none" stroke="#263147" strokeWidth={0.5} />
              </pattern>
            </defs>

            <rect x={20} y={60} width={svgWidth - 40} height={100} rx={8}
              fill="url(#board)" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
            <text x={svgWidth / 2} y={115} textAnchor="middle" fontSize={7}
              fill="rgba(255,255,255,0.15)" fontFamily="monospace">MOTHERBOARD</text>

            <g transform="translate(36, 90)">
              <CpuCables type={cables.cpu} hexColor={cpuHex}
                onClick={() => setActiveCable(activeCable === "cpu" ? null : "cpu")} />
              {activeCable === "cpu" && (
                <rect x={-6} y={-35} width={cables.cpu === "8-pin" ? 50 : 96} height={55}
                  rx={6} fill="hsl(var(--primary))" opacity={0.07} />
              )}
              <rect x={2} y={10} width={cables.cpu === "8-pin" ? 32 : 76} height={8} rx={2} fill="rgba(255,255,255,0.08)" />
            </g>

            <g transform={`translate(${svgWidth - 20}, 80)`}>
              <AtxCable hexColor={atxHex}
                onClick={() => setActiveCable(activeCable === "atx" ? null : "atx")} />
              {activeCable === "atx" && (
                <rect x={-78} y={-6} width={82} height={54} rx={6} fill="hsl(var(--primary))" opacity={0.07} />
              )}
            </g>

            <g transform={`translate(${svgWidth / 2 - (gpuCableCount * 44) / 2}, 122)`}>
              <GpuCables type={cables.gpu} hexColor={gpuHex}
                onClick={() => setActiveCable(activeCable === "gpu" ? null : "gpu")} />
              {activeCable === "gpu" && (
                <rect x={-6} y={-6} width={gpuCableCount * 44 + 12} height={58}
                  rx={6} fill="hsl(var(--primary))" opacity={0.07} />
              )}
            </g>

            {activeCable && (
              <text x={svgWidth / 2} y={210} textAnchor="middle" fontSize={8}
                fill="hsl(var(--primary))" fontFamily="monospace" opacity={0.8}>
                {activeCable === "cpu" ? `CPU · ${cables.cpu}` : activeCable === "gpu" ? `GPU · ${cables.gpu}` : "ATX 24-pin"}
                {" — выбери цвет ↓"}
              </text>
            )}
          </svg>
        </div>
      </div>

      {activeCable ? (
        <div>
          <p className="text-xs text-foreground/50 mb-2">
            Цвет — <span className="text-foreground/70">
              {activeCable === "cpu" ? `CPU ${cables.cpu}` : activeCable === "gpu" ? `GPU ${cables.gpu}` : "ATX 24-pin"}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {getPalette().map(color => {
              const isActive = activeColorKey ? cables[activeColorKey as keyof CableState] === color.id : false
              return (
                <button key={color.id} title={color.label} onClick={() => setColor(color.id)}
                  className={`h-7 w-7 rounded-full border-2 transition-all ${isActive ? "border-primary scale-110" : "border-transparent hover:border-white/30"}`}
                  style={{ backgroundColor: color.hex, cursor: "pointer" }} />
              )
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-foreground/30">
            {getPalette().find(p => p.id === (activeColorKey ? cables[activeColorKey as keyof CableState] : ""))?.label}
          </p>
        </div>
      ) : (
        <p className="text-xs text-foreground/30 text-center py-1">Кликни на кабель чтобы изменить цвет</p>
      )}

      <div className="space-y-2">
        <div className="flex gap-2 text-xs text-foreground/50">
          <span className="flex-1">CPU: <span className="text-foreground/70">{cables.cpu} · {PALETTE.find(p => p.id === cables.cpuColor)?.label}</span></span>
          <span className="flex-1">ATX: <span className="text-foreground/70">{PALETTE.find(p => p.id === cables.atxColor)?.label}</span></span>
        </div>
        <div className="text-xs text-foreground/50">
          GPU: <span className="text-foreground/70">{cables.gpu} · {(cables.gpu === "12V-2x6" ? PALETTE_12V : PALETTE).find(p => p.id === cables.gpuColor)?.label}</span>
        </div>
        <p className="text-[10px] text-foreground/30">Партнёр: C-Cables · цена согласовывается после заказа</p>
        <button onClick={addToCart}
          className={`w-full rounded-lg py-2.5 text-sm font-medium transition-all ${added ? "bg-green-600/20 text-green-400 border border-green-500/30" : "bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20"}`}
          style={{ cursor: "pointer" }}>
          {added
            ? <span className="flex items-center justify-center gap-2"><Icon name="Check" size={15} />Добавлено в корзину</span>
            : <span className="flex items-center justify-center gap-2"><Icon name="ShoppingCart" size={15} />Добавить к заказу</span>}
        </button>
      </div>
    </div>
  )
}

export function CableConfigurator({ standalone = false }: { standalone?: boolean }) {
  const { addItem } = useCart()
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState(false)
  const [cables, setCables] = useState<CableState>({
    cpu: "8-pin", gpu: "8-pin", cpuColor: "black", gpuColor: "black", atxColor: "black",
  })
  const [activeCable, setActiveCable] = useState<"cpu" | "gpu" | "atx" | null>(null)

  const addToCart = () => {
    const cpuLabel = `CPU ${cables.cpu} — ${PALETTE.find(p => p.id === cables.cpuColor)?.label}`
    const gpuLabel = `GPU ${cables.gpu} — ${(cables.gpu === "12V-2x6" ? PALETTE_12V : PALETTE).find(p => p.id === cables.gpuColor)?.label}`
    const atxLabel = `ATX 24-pin — ${PALETTE.find(p => p.id === cables.atxColor)?.label}`
    addItem({ id: Date.now(), name: `Кастомные кабели C-Cables: ${cpuLabel} / ${gpuLabel} / ${atxLabel}`, price: 0, type: "config" })
    setAdded(true)
    setTimeout(() => setAdded(false), 3000)
  }

  if (standalone) {
    return (
      <CableBody cables={cables} activeCable={activeCable} setActiveCable={setActiveCable}
        addToCart={addToCart} added={added} setCables={setCables} />
    )
  }

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
            <p className="text-xs text-foreground/50">C-Cables · цена согласовывается</p>
          </div>
        </div>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} className="text-foreground/40" />
      </button>
      {open && (
        <div className="border-t border-border px-5 pb-5 pt-4">
          <CableBody cables={cables} activeCable={activeCable} setActiveCable={setActiveCable}
            addToCart={addToCart} added={added} setCables={setCables} />
        </div>
      )}
    </div>
  )
}
