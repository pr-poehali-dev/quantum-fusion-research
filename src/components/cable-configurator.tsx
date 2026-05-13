import { useState, useRef, useCallback } from "react"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"

// ─── Палитра ─────────────────────────────────────────────────────────────────
const PALETTE = [
  { id: "black",               label: "Чёрный",               hex: "#1a1a1a" },
  { id: "white",               label: "Белый",                hex: "#efefef" },
  { id: "gray",                label: "Серый",                hex: "#6b7280" },
  { id: "red",                 label: "Красный",              hex: "#dc2626" },
  { id: "crimson",             label: "Бордовый",             hex: "#7f1d1d" },
  { id: "orange",              label: "Оранжевый",            hex: "#ea580c" },
  { id: "yellow",              label: "Жёлтый",               hex: "#ca8a04" },
  { id: "green",               label: "Зелёный",              hex: "#16a34a" },
  { id: "teal",                label: "Бирюзовый",            hex: "#0d9488" },
  { id: "blue",                label: "Синий",                hex: "#2563eb" },
  { id: "indigo",              label: "Индиго",               hex: "#4f46e5" },
  { id: "purple",              label: "Фиолетовый",           hex: "#7c3aed" },
  { id: "pink",                label: "Розовый",              hex: "#db2777" },
  { id: "sleeved-white-black", label: "Бело-чёрная оплётка",  hex: "#c8c8c8" },
  { id: "sleeved-red-black",   label: "Красно-чёрная оплётка",hex: "#b91c1c" },
]

const PALETTE_12V = [
  { id: "black",  label: "Чёрный",  hex: "#1a1a1a" },
  { id: "white",  label: "Белый",   hex: "#efefef" },
  { id: "gray",   label: "Серый",   hex: "#6b7280" },
  { id: "yellow", label: "Жёлтый",  hex: "#ca8a04" },
  { id: "green",  label: "Зелёный", hex: "#16a34a" },
]

const DEFAULT_COLOR = "black"
const DEFAULT_HEX = "#1a1a1a"
const getHex = (id: string, pal: typeof PALETTE = PALETTE) => pal.find(p => p.id === id)?.hex ?? DEFAULT_HEX

// ─── Типы ────────────────────────────────────────────────────────────────────
const CPU_TYPES = ["8-pin", "8+4-pin", "8+8-pin"] as const
const GPU_TYPES = ["8-pin", "8+8-pin", "8+8+8-pin", "12V-2x6"] as const
type CpuType = typeof CPU_TYPES[number]
type GpuType = typeof GPU_TYPES[number]

const CPU_PINS: Record<CpuType, number> = { "8-pin": 4, "8+4-pin": 6, "8+8-pin": 8 }
const GPU_PINS: Record<GpuType, number> = { "8-pin": 4, "8+8-pin": 8, "8+8+8-pin": 12, "12V-2x6": 6 }
const ATX_PINS = 12

const PIN_W = 22
const PIN_H = 34
const PIN_GAP = 6
const WIRE_LEN = 80

type PinColors = Record<string, string>

function makePinKey(cable: string, idx: number) { return `${cable}:${idx}` }
function initPins(prefix: string, count: number): PinColors {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [makePinKey(prefix, i), DEFAULT_COLOR]))
}
function pinKeys(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => makePinKey(prefix, i))
}

// ─── PinStrip ─────────────────────────────────────────────────────────────────
interface PinStripProps {
  prefix: string
  count: number
  pinColors: PinColors
  selectedPins: Set<string>
  onPinPointerDown: (key: string, e: React.PointerEvent) => void
  onPinPointerEnter: (key: string) => void
  palette: typeof PALETTE
  direction: "up" | "down" | "left"
  label: string
}

function PinStrip({ prefix, count, pinColors, selectedPins, onPinPointerDown, onPinPointerEnter, palette, direction, label }: PinStripProps) {
  const totalW = count * (PIN_W + PIN_GAP) - PIN_GAP
  const connH = PIN_H + 8

  const renderPin = (i: number, x: number, y: number) => {
    const key = makePinKey(prefix, i)
    const colorId = pinColors[key] ?? DEFAULT_COLOR
    const hex = getHex(colorId, palette)
    const isSelected = selectedPins.has(key)
    return (
      <g key={i}
        onPointerDown={(e) => onPinPointerDown(key, e)}
        onPointerEnter={() => onPinPointerEnter(key)}
        style={{ cursor: "pointer" }}>
        <rect x={x + PIN_W / 2 - 3} y={y} width={6} height={PIN_H - 4} rx={2} fill={hex} opacity={0.85} />
        <rect x={x} y={y} width={PIN_W} height={PIN_H} rx={3}
          fill={hex} opacity={isSelected ? 1 : 0.82}
          stroke={isSelected ? "white" : "rgba(255,255,255,0.18)"}
          strokeWidth={isSelected ? 2.5 : 0.8} />
        {isSelected && (
          <rect x={x} y={y} width={PIN_W} height={PIN_H} rx={3}
            fill="none" stroke="hsl(var(--primary))" strokeWidth={2} opacity={0.9} />
        )}
        <rect x={x + 3} y={y + 3} width={PIN_W - 6} height={5} rx={1.5} fill="rgba(255,255,255,0.18)" />
      </g>
    )
  }

  const body = (
    <g>
      <rect x={0} y={0} width={totalW} height={connH} rx={5}
        fill="#1e293b" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      {Array.from({ length: count }, (_, i) => renderPin(i, i * (PIN_W + PIN_GAP) + 2, 4))}
      <text x={totalW / 2} y={connH + 11} textAnchor="middle" fontSize={9}
        fill="rgba(255,255,255,0.35)" fontFamily="monospace">{label}</text>
    </g>
  )

  if (direction === "up") return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const hex = getHex(pinColors[makePinKey(prefix, i)] ?? DEFAULT_COLOR, palette)
        const cx = i * (PIN_W + PIN_GAP) + 2 + PIN_W / 2
        return <line key={i} x1={cx} y1={0} x2={cx} y2={-WIRE_LEN} stroke={hex} strokeWidth={3.5} strokeLinecap="round" opacity={0.75} />
      })}
      {body}
    </g>
  )

  if (direction === "down") return (
    <g>
      {body}
      {Array.from({ length: count }, (_, i) => {
        const hex = getHex(pinColors[makePinKey(prefix, i)] ?? DEFAULT_COLOR, palette)
        const cx = i * (PIN_W + PIN_GAP) + 2 + PIN_W / 2
        return <line key={i} x1={cx} y1={connH} x2={cx} y2={connH + WIRE_LEN} stroke={hex} strokeWidth={3.5} strokeLinecap="round" opacity={0.75} />
      })}
    </g>
  )

  // ATX — вертикальный, провода вправо
  const renderPinV = (i: number) => {
    const key = makePinKey(prefix, i)
    const colorId = pinColors[key] ?? DEFAULT_COLOR
    const hex = getHex(colorId, palette)
    const isSelected = selectedPins.has(key)
    const y = i * (PIN_W + PIN_GAP) + 2
    return (
      <g key={i}
        onPointerDown={(e) => onPinPointerDown(key, e)}
        onPointerEnter={() => onPinPointerEnter(key)}
        style={{ cursor: "pointer" }}>
        <rect x={4} y={y + PIN_W / 2 - 3} width={PIN_H - 4} height={6} rx={2} fill={hex} opacity={0.85} />
        <rect x={4} y={y} width={PIN_H} height={PIN_W} rx={3}
          fill={hex} opacity={isSelected ? 1 : 0.82}
          stroke={isSelected ? "white" : "rgba(255,255,255,0.18)"}
          strokeWidth={isSelected ? 2.5 : 0.8} />
        {isSelected && (
          <rect x={4} y={y} width={PIN_H} height={PIN_W} rx={3}
            fill="none" stroke="hsl(var(--primary))" strokeWidth={2} opacity={0.9} />
        )}
        <rect x={7} y={y + 3} width={5} height={PIN_W - 6} rx={1.5} fill="rgba(255,255,255,0.18)" />
      </g>
    )
  }

  return (
    <g>
      <rect x={0} y={0} width={connH} height={totalW} rx={5}
        fill="#1e293b" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      {Array.from({ length: count }, (_, i) => renderPinV(i))}
      <text x={connH / 2} y={totalW + 12} textAnchor="middle" fontSize={9}
        fill="rgba(255,255,255,0.35)" fontFamily="monospace">24-pin ATX</text>
      {Array.from({ length: count }, (_, i) => {
        const hex = getHex(pinColors[makePinKey(prefix, i)] ?? DEFAULT_COLOR, palette)
        const cy = i * (PIN_W + PIN_GAP) + 2 + PIN_W / 2
        return <line key={i} x1={connH} y1={cy} x2={connH + WIRE_LEN} y2={cy} stroke={hex} strokeWidth={3.5} strokeLinecap="round" opacity={0.75} />
      })}
    </g>
  )
}

// ─── CableBody ────────────────────────────────────────────────────────────────
function CableBody({ addToCart, added }: { addToCart: (summary: string) => void; added: boolean }) {
  const [cpuType, setCpuType] = useState<CpuType>("8-pin")
  const [gpuType, setGpuType] = useState<GpuType>("8-pin")

  const cpuCount = CPU_PINS[cpuType]
  const gpuCount = GPU_PINS[gpuType]
  const is12v = gpuType === "12V-2x6"
  const gpuPalette = is12v ? PALETTE_12V : PALETTE

  const [pinColors, setPinColors] = useState<PinColors>(() => ({
    ...initPins("cpu", 16),
    ...initPins("atx", ATX_PINS),
    ...initPins("gpu", 24),
  }))

  // Множественное выделение
  const [selectedPins, setSelectedPins] = useState<Set<string>>(new Set())

  // Drag-to-paint
  const isDragging = useRef(false)
  const dragPainted = useRef<Set<string>>(new Set())

  const handlePinPointerDown = useCallback((key: string, e: React.PointerEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragPainted.current = new Set([key])

    setSelectedPins(prev => {
      const next = new Set(prev)
      if (next.has(key) && prev.size > 1) {
        // уже выделен и не единственный — не снимаем, начинаем drag
      } else if (next.has(key) && prev.size === 1) {
        next.clear()
      } else {
        next.add(key)
      }
      return next
    })

    const svgEl = (e.currentTarget as Element).closest("svg")
    if (svgEl) (svgEl as SVGElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePinPointerEnter = useCallback((key: string) => {
    if (!isDragging.current) return
    if (dragPainted.current.has(key)) return
    dragPainted.current.add(key)
    setSelectedPins(prev => new Set([...prev, key]))
  }, [])

  const handleSvgPointerUp = useCallback(() => {
    isDragging.current = false
    dragPainted.current = new Set()
  }, [])

  // Клик по фону SVG — сброс выделения
  const handleSvgBgClick = useCallback(() => {
    setSelectedPins(new Set())
  }, [])

  // Активная палитра зависит от группы выделенных пинов
  const selectedArr = [...selectedPins]
  const selectedGroup = selectedArr.length > 0 ? selectedArr[0].split(":")[0] : null
  const activePalette = selectedGroup === "gpu" && is12v ? PALETTE_12V : PALETTE
  const firstColor = selectedArr.length > 0 ? pinColors[selectedArr[0]] ?? DEFAULT_COLOR : null

  const applyColor = (colorId: string) => {
    if (selectedPins.size === 0) return
    setPinColors(prev => {
      const next = { ...prev }
      selectedPins.forEach(k => { next[k] = colorId })
      return next
    })
  }

  // Размеры SVG
  const PAD = 24
  const cpuW = cpuCount * (PIN_W + PIN_GAP) - PIN_GAP
  const gpuW = gpuCount * (PIN_W + PIN_GAP) - PIN_GAP
  const boardW = Math.max(cpuW, gpuW) + PAD * 2
  const boardH = 180
  const svgW = boardW + WIRE_LEN + PIN_H + PAD + 60 + WIRE_LEN
  const svgH = WIRE_LEN + boardH + WIRE_LEN + PIN_H + 40

  const boardX = 0
  const boardY = WIRE_LEN + 10
  const cpuX = boardX + PAD
  const gpuX = boardX + PAD
  const atxX = boardX + boardW + 40
  const atxY = boardY - 60

  return (
    <div className="space-y-6">
      {/* Тип кабелей */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-foreground/50 mb-2">CPU кабель</p>
          <div className="flex flex-wrap gap-1.5">
            {CPU_TYPES.map(t => (
              <button key={t} onClick={() => { setCpuType(t); setSelectedPins(new Set()) }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${cpuType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}
                style={{ cursor: "pointer" }}>{t}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-foreground/50 mb-2">GPU кабель</p>
          <div className="flex flex-wrap gap-1.5">
            {GPU_TYPES.map(t => (
              <button key={t} onClick={() => { setGpuType(t); setSelectedPins(new Set()) }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${gpuType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}
                style={{ cursor: "pointer" }}>{t}</button>
            ))}
          </div>
          {is12v && <p className="mt-1.5 text-[10px] text-yellow-400/80">⚡ Своя палитра цветов</p>}
        </div>
      </div>

      {/* SVG */}
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          <svg width="100%" viewBox={`-${PAD} -10 ${svgW + PAD * 2} ${svgH + 20}`}
            style={{ display: "block", touchAction: "none" }}
            onPointerUp={handleSvgPointerUp}
            onPointerLeave={handleSvgPointerUp}>
            <defs>
              <pattern id="pcb" patternUnits="userSpaceOnUse" width={16} height={16}>
                <rect width={16} height={16} fill="#0f1a2e" />
                <rect width={16} height={16} fill="none" stroke="#1a2d4a" strokeWidth={0.5} />
              </pattern>
            </defs>

            {/* Фон для сброса выделения */}
            <rect x={-PAD} y={-10} width={svgW + PAD * 2} height={svgH + 20}
              fill="transparent" onClick={handleSvgBgClick} style={{ cursor: "default" }} />

            {/* Плата */}
            <rect x={boardX} y={boardY} width={boardW} height={boardH} rx={10}
              fill="url(#pcb)" stroke="rgba(255,255,255,0.07)" strokeWidth={1.5} />
            <text x={boardX + boardW / 2} y={boardY + boardH / 2 + 5} textAnchor="middle"
              fontSize={10} fill="rgba(255,255,255,0.08)" fontFamily="monospace" letterSpacing={3}>MOTHERBOARD</text>

            {/* CPU */}
            <g transform={`translate(${cpuX}, ${boardY})`}>
              <PinStrip prefix="cpu" count={cpuCount} pinColors={pinColors}
                selectedPins={selectedPins}
                onPinPointerDown={handlePinPointerDown}
                onPinPointerEnter={handlePinPointerEnter}
                palette={PALETTE} direction="up" label={cpuType} />
            </g>

            {/* GPU */}
            <g transform={`translate(${gpuX}, ${boardY + boardH + 30})`}>
              <PinStrip prefix="gpu" count={gpuCount} pinColors={pinColors}
                selectedPins={selectedPins}
                onPinPointerDown={handlePinPointerDown}
                onPinPointerEnter={handlePinPointerEnter}
                palette={gpuPalette} direction="down" label={gpuType} />
            </g>

            {/* ATX */}
            <g transform={`translate(${atxX}, ${atxY})`}>
              <PinStrip prefix="atx" count={ATX_PINS} pinColors={pinColors}
                selectedPins={selectedPins}
                onPinPointerDown={handlePinPointerDown}
                onPinPointerEnter={handlePinPointerEnter}
                palette={PALETTE} direction="left" label="" />
            </g>
          </svg>
        </div>
      </div>

      {/* Статус */}
      <div className="min-h-[20px]">
        {selectedPins.size > 0 ? (
          <p className="text-xs text-primary font-mono">
            Выделено {selectedPins.size} {selectedPins.size === 1 ? "пин" : selectedPins.size < 5 ? "пина" : "пинов"}
            {firstColor && ` · ${activePalette.find(p => p.id === firstColor)?.label ?? ""}`}
          </p>
        ) : (
          <p className="text-xs text-foreground/30">Кликни или зажми и веди по пинам для выделения</p>
        )}
      </div>

      {/* Палитра */}
      {selectedPins.size > 0 && (
        <div>
          <p className="text-xs text-foreground/50 mb-2.5">Цвет оплётки</p>
          <div className="flex flex-wrap gap-2.5">
            {activePalette.map(color => {
              const isActive = firstColor === color.id
              return (
                <button key={color.id} title={color.label} onClick={() => applyColor(color.id)}
                  className={`h-8 w-8 rounded-full border-2 transition-all hover:scale-110 ${isActive ? "border-white scale-110" : "border-transparent opacity-80"}`}
                  style={{ backgroundColor: color.hex, cursor: "pointer",
                    boxShadow: isActive ? "0 0 0 3px hsl(var(--primary))" : undefined }} />
              )
            })}
          </div>

          <div className="mt-3 flex gap-2 flex-wrap">
            <button onClick={() => {
              if (!selectedGroup) return
              const color = firstColor ?? DEFAULT_COLOR
              const count = selectedGroup === "cpu" ? cpuCount : selectedGroup === "gpu" ? gpuCount : ATX_PINS
              const updates: PinColors = {}
              pinKeys(selectedGroup, count).forEach(k => { updates[k] = color })
              setPinColors(prev => ({ ...prev, ...updates }))
            }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
              style={{ cursor: "pointer" }}>
              Весь кабель
            </button>
            <button onClick={() => {
              const updates: PinColors = {}
              pinKeys("cpu", cpuCount).forEach(k => { updates[k] = DEFAULT_COLOR })
              pinKeys("gpu", gpuCount).forEach(k => { updates[k] = DEFAULT_COLOR })
              pinKeys("atx", ATX_PINS).forEach(k => { updates[k] = DEFAULT_COLOR })
              setPinColors(prev => ({ ...prev, ...updates }))
              setSelectedPins(new Set())
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
        <button onClick={() => addToCart(`CPU ${cpuType} / GPU ${gpuType} / ATX 24-pin`)}
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

// ─── Экспорт ──────────────────────────────────────────────────────────────────
export function CableConfigurator({ standalone = false }: { standalone?: boolean }) {
  const { addItem } = useCart()
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState(false)

  const handleAddToCart = (summary: string) => {
    addItem({ id: Date.now(), name: `Кастомные кабели C-Cables: ${summary}`, price: 0, type: "config" })
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
