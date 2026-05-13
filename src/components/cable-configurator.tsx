import { useState } from "react"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"

// ─── Палитра ─────────────────────────────────────────────────────────────────
const PALETTE = [
  { id: "black",               label: "Чёрный",              hex: "#1a1a1a" },
  { id: "white",               label: "Белый",               hex: "#efefef" },
  { id: "gray",                label: "Серый",               hex: "#6b7280" },
  { id: "red",                 label: "Красный",             hex: "#dc2626" },
  { id: "crimson",             label: "Бордовый",            hex: "#7f1d1d" },
  { id: "orange",              label: "Оранжевый",           hex: "#ea580c" },
  { id: "yellow",              label: "Жёлтый",              hex: "#ca8a04" },
  { id: "green",               label: "Зелёный",             hex: "#16a34a" },
  { id: "teal",                label: "Бирюзовый",           hex: "#0d9488" },
  { id: "blue",                label: "Синий",               hex: "#2563eb" },
  { id: "indigo",              label: "Индиго",              hex: "#4f46e5" },
  { id: "purple",              label: "Фиолетовый",          hex: "#7c3aed" },
  { id: "pink",                label: "Розовый",             hex: "#db2777" },
  { id: "sleeved-white-black", label: "Бело-чёрная оплётка", hex: "#c8c8c8" },
  { id: "sleeved-red-black",   label: "Красно-чёрная оплётка", hex: "#b91c1c" },
]

const PALETTE_12V = [
  { id: "black",  label: "Чёрный",  hex: "#1a1a1a" },
  { id: "white",  label: "Белый",   hex: "#efefef" },
  { id: "gray",   label: "Серый",   hex: "#6b7280" },
  { id: "yellow", label: "Жёлтый", hex: "#ca8a04" },
  { id: "green",  label: "Зелёный", hex: "#16a34a" },
]

const DEFAULT_COLOR = "black"
const DEFAULT_HEX = "#1a1a1a"

const getHex = (id: string, pal: typeof PALETTE = PALETTE) =>
  pal.find(p => p.id === id)?.hex ?? DEFAULT_HEX

// ─── Типы ────────────────────────────────────────────────────────────────────
const CPU_TYPES = ["8-pin", "8+4-pin", "8+8-pin"] as const
const GPU_TYPES = ["8-pin", "8+8-pin", "8+8+8-pin", "12V-2x6"] as const
type CpuType = typeof CPU_TYPES[number]
type GpuType = typeof GPU_TYPES[number]

// Количество видимых (передних) пинов для каждого типа — половина реального
const CPU_PINS: Record<CpuType, number> = { "8-pin": 4, "8+4-pin": 6, "8+8-pin": 8 }
const GPU_PINS: Record<GpuType, number> = { "8-pin": 4, "8+8-pin": 8, "8+8+8-pin": 12, "12V-2x6": 3 }
const ATX_PINS = 6

// Размеры пина
const PIN_W = 22
const PIN_H = 34
const PIN_GAP = 6
const WIRE_LEN = 80

type PinColors = Record<string, string> // pinKey → colorId

// ─── Утилиты ─────────────────────────────────────────────────────────────────
function makePinKey(cable: string, idx: number) { return `${cable}:${idx}` }

function initPins(keys: string[]): PinColors {
  return Object.fromEntries(keys.map(k => [k, DEFAULT_COLOR]))
}

function pinKeys(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => makePinKey(prefix, i))
}

// ─── SVG: один ряд пинов в линию ─────────────────────────────────────────────
interface PinStripProps {
  prefix: string
  count: number
  pinColors: PinColors
  activePin: string | null
  onPinClick: (key: string) => void
  palette: typeof PALETTE
  direction: "up" | "down" | "left"
  label: string
}

function PinStrip({ prefix, count, pinColors, activePin, onPinClick, palette, direction, label }: PinStripProps) {
  const totalW = count * (PIN_W + PIN_GAP) - PIN_GAP
  const connH = PIN_H + 8

  // Корпус разъёма
  const body = (
    <g>
      <rect x={0} y={0} width={totalW} height={connH} rx={5}
        fill="#1e293b" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      {/* Пины */}
      {Array.from({ length: count }, (_, i) => {
        const key = makePinKey(prefix, i)
        const colorId = pinColors[key] ?? DEFAULT_COLOR
        const hex = getHex(colorId, palette)
        const isActive = activePin === key
        const x = i * (PIN_W + PIN_GAP) + 2
        const y = 4
        return (
          <g key={i} onClick={() => onPinClick(key)} style={{ cursor: "pointer" }}>
            {/* Провод/жила */}
            <rect x={x + PIN_W / 2 - 3} y={y} width={6} height={PIN_H - 4} rx={2}
              fill={hex} opacity={0.85} />
            {/* Корпус пина */}
            <rect x={x} y={y} width={PIN_W} height={PIN_H} rx={3}
              fill={hex} opacity={isActive ? 1 : 0.82}
              stroke={isActive ? "white" : "rgba(255,255,255,0.18)"}
              strokeWidth={isActive ? 2 : 0.8} />
            {/* Блик */}
            <rect x={x + 3} y={y + 3} width={PIN_W - 6} height={5} rx={1.5}
              fill="rgba(255,255,255,0.18)" />
          </g>
        )
      })}
      {/* Лейбл */}
      <text x={totalW / 2} y={connH + 11} textAnchor="middle" fontSize={9}
        fill="rgba(255,255,255,0.35)" fontFamily="monospace">{label}</text>
    </g>
  )

  if (direction === "up") {
    return (
      <g>
        {/* Провода вверх */}
        {Array.from({ length: count }, (_, i) => {
          const key = makePinKey(prefix, i)
          const hex = getHex(pinColors[key] ?? DEFAULT_COLOR, palette)
          const cx = i * (PIN_W + PIN_GAP) + 2 + PIN_W / 2
          return (
            <line key={i} x1={cx} y1={0} x2={cx} y2={-WIRE_LEN}
              stroke={hex} strokeWidth={3.5} strokeLinecap="round" opacity={0.75} />
          )
        })}
        <g transform={`translate(0, 0)`}>{body}</g>
      </g>
    )
  }

  if (direction === "down") {
    return (
      <g>
        <g transform={`translate(0, 0)`}>{body}</g>
        {/* Провода вниз */}
        {Array.from({ length: count }, (_, i) => {
          const key = makePinKey(prefix, i)
          const hex = getHex(pinColors[key] ?? DEFAULT_COLOR, palette)
          const cx = i * (PIN_W + PIN_GAP) + 2 + PIN_W / 2
          return (
            <line key={i} x1={cx} y1={connH} x2={cx} y2={connH + WIRE_LEN}
              stroke={hex} strokeWidth={3.5} strokeLinecap="round" opacity={0.75} />
          )
        })}
      </g>
    )
  }

  // direction === "left" (ATX — провода идут влево)
  return (
    <g>
      {/* Провода влево */}
      {Array.from({ length: count }, (_, i) => {
        const key = makePinKey(prefix, i)
        const hex = getHex(pinColors[key] ?? DEFAULT_COLOR, palette)
        const cy = i * (PIN_W + PIN_GAP) + 2 + PIN_W / 2
        return (
          <line key={i} x1={0} y1={cy} x2={-WIRE_LEN} y2={cy}
            stroke={hex} strokeWidth={3.5} strokeLinecap="round" opacity={0.75} />
        )
      })}
      {/* ATX — вертикальный разъём */}
      <g transform="translate(0, 0)">
        <rect x={0} y={0} width={connH} height={totalW} rx={5}
          fill="#1e293b" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        {Array.from({ length: count }, (_, i) => {
          const key = makePinKey(prefix, i)
          const colorId = pinColors[key] ?? DEFAULT_COLOR
          const hex = getHex(colorId, palette)
          const isActive = activePin === key
          const y = i * (PIN_W + PIN_GAP) + 2
          return (
            <g key={i} onClick={() => onPinClick(key)} style={{ cursor: "pointer" }}>
              <rect x={4} y={y + PIN_W / 2 - 3} width={PIN_H - 4} height={6} rx={2}
                fill={hex} opacity={0.85} />
              <rect x={4} y={y} width={PIN_H} height={PIN_W} rx={3}
                fill={hex} opacity={isActive ? 1 : 0.82}
                stroke={isActive ? "white" : "rgba(255,255,255,0.18)"}
                strokeWidth={isActive ? 2 : 0.8} />
              <rect x={7} y={y + 3} width={5} height={PIN_W - 6} rx={1.5}
                fill="rgba(255,255,255,0.18)" />
            </g>
          )
        })}
        <text x={connH / 2} y={totalW + 12} textAnchor="middle" fontSize={9}
          fill="rgba(255,255,255,0.35)" fontFamily="monospace">24-pin ATX</text>
      </g>
    </g>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────────
function CableBody({
  addToCart, added,
}: {
  addToCart: (summary: string) => void
  added: boolean
}) {
  const [cpuType, setCpuType] = useState<CpuType>("8-pin")
  const [gpuType, setGpuType] = useState<GpuType>("8-pin")
  const [activePin, setActivePin] = useState<string | null>(null)

  const cpuCount = CPU_PINS[cpuType]
  const gpuCount = GPU_PINS[gpuType]
  const is12v = gpuType === "12V-2x6"
  const gpuPalette = is12v ? PALETTE_12V : PALETTE

  const [pinColors, setPinColors] = useState<PinColors>(() => ({
    ...initPins(pinKeys("cpu", 16)),
    ...initPins(pinKeys("atx", ATX_PINS)),
    ...initPins(pinKeys("gpu", 24)),
  }))

  const handlePinClick = (key: string) => {
    setActivePin(prev => prev === key ? null : key)
  }

  const handleColorPick = (colorId: string) => {
    if (!activePin) return
    setPinColors(prev => ({ ...prev, [activePin]: colorId }))
  }

  const activePinGroup = activePin?.split(":")[0] as "cpu" | "atx" | "gpu" | undefined
  const activePalette = activePinGroup === "gpu" && is12v ? PALETTE_12V : PALETTE
  const activePinColor = activePin ? pinColors[activePin] ?? DEFAULT_COLOR : null

  // Размеры SVG
  const PAD = 24
  const cpuW = cpuCount * (PIN_W + PIN_GAP) - PIN_GAP
  const gpuW = gpuCount * (PIN_W + PIN_GAP) - PIN_GAP
  const atxH = ATX_PINS * (PIN_W + PIN_GAP) - PIN_GAP
  const boardW = Math.max(cpuW, gpuW) + PAD * 2
  const boardH = 180
  const svgW = boardW + WIRE_LEN + PIN_H + PAD + 60
  const svgH = WIRE_LEN + boardH + WIRE_LEN + PIN_H + 40

  const boardX = 0
  const boardY = WIRE_LEN + 10
  const cpuX = boardX + PAD
  const gpuX = boardX + PAD
  const atxX = boardX + boardW + 40
  const atxY = boardY + 20

  return (
    <div className="space-y-6">
      {/* Тип кабелей */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-foreground/50 mb-2">CPU кабель</p>
          <div className="flex flex-wrap gap-1.5">
            {CPU_TYPES.map(t => (
              <button key={t} onClick={() => {
                setCpuType(t)
                setActivePin(null)
              }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${cpuType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}
                style={{ cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-foreground/50 mb-2">GPU кабель</p>
          <div className="flex flex-wrap gap-1.5">
            {GPU_TYPES.map(t => (
              <button key={t} onClick={() => {
                setGpuType(t)
                setActivePin(null)
              }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${gpuType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}
                style={{ cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
          {is12v && <p className="mt-1.5 text-[10px] text-yellow-400/80">⚡ Своя палитра цветов</p>}
        </div>
      </div>

      {/* SVG-схема */}
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          <svg
            width="100%"
            viewBox={`-${PAD} -10 ${svgW + PAD * 2} ${svgH + 20}`}
            style={{ display: "block" }}
          >
            <defs>
              <pattern id="pcb" patternUnits="userSpaceOnUse" width={16} height={16}>
                <rect width={16} height={16} fill="#0f1a2e" />
                <rect width={16} height={16} fill="none" stroke="#1a2d4a" strokeWidth={0.5} />
              </pattern>
            </defs>

            {/* Плата */}
            <rect x={boardX} y={boardY} width={boardW} height={boardH} rx={10}
              fill="url(#pcb)" stroke="rgba(255,255,255,0.07)" strokeWidth={1.5} />
            <text x={boardX + boardW / 2} y={boardY + boardH / 2 + 5} textAnchor="middle"
              fontSize={10} fill="rgba(255,255,255,0.08)" fontFamily="monospace" letterSpacing={3}>
              MOTHERBOARD
            </text>

            {/* CPU — сверху, провода вверх */}
            <g transform={`translate(${cpuX}, ${boardY})`}>
              <PinStrip
                prefix="cpu" count={cpuCount}
                pinColors={pinColors} activePin={activePin}
                onPinClick={handlePinClick}
                palette={PALETTE} direction="up" label={cpuType}
              />
            </g>

            {/* GPU — снизу, провода вниз */}
            <g transform={`translate(${gpuX}, ${boardY + boardH + 30})`}>
              <PinStrip
                prefix="gpu" count={gpuCount}
                pinColors={pinColors} activePin={activePin}
                onPinClick={handlePinClick}
                palette={gpuPalette} direction="down" label={gpuType}
              />
            </g>

            {/* ATX — справа, провода влево */}
            <g transform={`translate(${atxX}, ${atxY})`}>
              <PinStrip
                prefix="atx" count={ATX_PINS}
                pinColors={pinColors} activePin={activePin}
                onPinClick={handlePinClick}
                palette={PALETTE} direction="left" label=""
              />
            </g>
          </svg>
        </div>
      </div>

      {/* Подсказка / активный пин */}
      <div className="min-h-[28px]">
        {activePin ? (
          <p className="text-xs text-primary font-mono">
            {activePinGroup === "cpu" ? `CPU ${cpuType}` : activePinGroup === "gpu" ? `GPU ${gpuType}` : "ATX 24-pin"}
            {" · пин "}{Number(activePin.split(":")[1]) + 1}
            {" — "}{activePalette.find(p => p.id === activePinColor)?.label ?? ""}
          </p>
        ) : (
          <p className="text-xs text-foreground/30">Кликни на пин чтобы выбрать цвет</p>
        )}
      </div>

      {/* Палитра */}
      {activePin && (
        <div>
          <p className="text-xs text-foreground/50 mb-2.5">Цвет оплётки</p>
          <div className="flex flex-wrap gap-2.5">
            {activePalette.map(color => {
              const isActive = activePinColor === color.id
              return (
                <button
                  key={color.id}
                  title={color.label}
                  onClick={() => handleColorPick(color.id)}
                  className={`h-8 w-8 rounded-full border-2 transition-all hover:scale-110 ${isActive ? "border-white scale-110 shadow-lg" : "border-transparent opacity-80"}`}
                  style={{ backgroundColor: color.hex, cursor: "pointer",
                    boxShadow: isActive ? `0 0 0 3px hsl(var(--primary))` : undefined }}
                />
              )
            })}
          </div>

          {/* Быстрые действия */}
          <div className="mt-3 flex gap-2 flex-wrap">
            <button onClick={() => {
              if (!activePinGroup) return
              const color = activePinColor ?? DEFAULT_COLOR
              const prefix = activePinGroup
              const count = prefix === "cpu" ? cpuCount : prefix === "gpu" ? gpuCount : ATX_PINS
              const updates: PinColors = {}
              for (let i = 0; i < count; i++) updates[makePinKey(prefix, i)] = color
              setPinColors(prev => ({ ...prev, ...updates }))
            }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
              style={{ cursor: "pointer" }}>
              Применить ко всему кабелю
            </button>
            <button onClick={() => {
              const updates: PinColors = {}
              pinKeys("cpu", cpuCount).forEach(k => updates[k] = DEFAULT_COLOR)
              pinKeys("gpu", gpuCount).forEach(k => updates[k] = DEFAULT_COLOR)
              pinKeys("atx", ATX_PINS).forEach(k => updates[k] = DEFAULT_COLOR)
              setPinColors(prev => ({ ...prev, ...updates }))
              setActivePin(null)
            }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-red-500/50 hover:text-red-400 transition-colors"
              style={{ cursor: "pointer" }}>
              Сбросить всё
            </button>
          </div>
        </div>
      )}

      {/* Итог */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="text-xs text-foreground/40 space-y-0.5">
          <p>CPU: <span className="text-foreground/60">{cpuType} · {cpuCount} пинов</span></p>
          <p>GPU: <span className="text-foreground/60">{gpuType} · {gpuCount} пинов</span></p>
          <p>ATX: <span className="text-foreground/60">24-pin · {ATX_PINS} видимых</span></p>
          <p className="text-[10px] pt-1">Партнёр: C-Cables · цена согласовывается после оформления</p>
        </div>
        <button
          onClick={() => addToCart(`CPU ${cpuType} / GPU ${gpuType} / ATX 24-pin`)}
          className={`w-full rounded-xl py-3 text-sm font-medium transition-all ${added
            ? "bg-green-600/20 text-green-400 border border-green-500/30"
            : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
          style={{ cursor: "pointer" }}>
          {added
            ? <span className="flex items-center justify-center gap-2"><Icon name="Check" size={15} />Добавлено в корзину</span>
            : <span className="flex items-center justify-center gap-2"><Icon name="ShoppingCart" size={15} />Добавить к заказу</span>}
        </button>
      </div>
    </div>
  )
}

// ─── Экспортируемый компонент ─────────────────────────────────────────────────
export function CableConfigurator({ standalone = false }: { standalone?: boolean }) {
  const { addItem } = useCart()
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState(false)

  const handleAddToCart = (summary: string) => {
    addItem({ id: Date.now(), name: `Кастомные кабели C-Cables: ${summary}`, price: 0, type: "config" })
    setAdded(true)
    setTimeout(() => setAdded(false), 3000)
  }

  if (standalone) {
    return <CableBody addToCart={handleAddToCart} added={added} />
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