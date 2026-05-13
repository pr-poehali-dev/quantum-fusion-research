import { useState, useRef, useCallback } from "react"
import { useCart } from "@/store/cart"
import Icon from "@/components/ui/icon"

// ─── Палитра C-Cables PET 4мм (все кабели кроме 12V-2x6) ─────────────────────
const PALETTE: { id: string; label: string; en: string; hex: string; uv?: boolean }[] = [
  // Белые / серые / чёрные
  { id: "perl-white",          label: "Жемчужно-белый",       en: "Perl White",           hex: "#f5f0eb" },
  { id: "white",               label: "Белый",                en: "White",                hex: "#f2f2f2" },
  { id: "light-gray",          label: "Светло-серый",         en: "Light gray (Silver)",  hex: "#b8bfc8" },
  { id: "billet-gray",         label: "Базовый серый",        en: "Billet gray",          hex: "#8a9099" },
  { id: "dark-gray",           label: "Темно-серый",          en: "Dark gray",            hex: "#555c63" },
  { id: "carbon-gray",         label: "Карбоновый серый",     en: "Carbon gray",          hex: "#3d4147" },
  { id: "gunmetal",            label: "Графит",               en: "Gunmetal",             hex: "#2e3238" },
  { id: "black",               label: "Черный",               en: "Black",                hex: "#1a1a1a" },
  { id: "light-carbon",        label: "Светлый карбон",       en: "Light Carbon",         hex: "#2d3035" },
  { id: "carbon",              label: "Карбон",               en: "Carbon",               hex: "#1e2125" },
  { id: "bw-mix",              label: "Черно-белый микс",     en: "Black & White mix",    hex: "#888888" },
  { id: "white-lines-carbon",  label: "Карбон с белыми стежками", en: "White Lines Carbon", hex: "#252830" },
  // Желтые / оранжевые
  { id: "citron",              label: "Цитрон",               en: "Citron",               hex: "#c8d400", uv: true },
  { id: "yellow",              label: "Желтый",               en: "Yellow",               hex: "#f5c800" },
  { id: "gold",                label: "Золотой",              en: "Gold",                 hex: "#c8920a" },
  { id: "terracotta",          label: "Терракотовый",         en: "Terracotta",           hex: "#b5633a" },
  { id: "acid-orange",         label: "Кислотно-оранжевый",   en: "Acid orange",          hex: "#ff8c00", uv: true },
  { id: "orange",              label: "Оранж",                en: "Orange",               hex: "#f07000", uv: true },
  { id: "pumpkin",             label: "Тыква",                en: "Pumpkin orange",       hex: "#d45f10" },
  { id: "orange-bk-mix",       label: "Оранжево-черный микс", en: "Orange & Black mix",   hex: "#a03a00" },
  // Красные / бордо
  { id: "bordo",               label: "Бордовый",             en: "Bordo",                hex: "#7a1030" },
  { id: "bordo-bk-mix",        label: "Черно-бордовый микс",  en: "Bordo & Black mix",    hex: "#4a0a1a" },
  { id: "red",                 label: "Красный",              en: "Red",                  hex: "#cc1515" },
  { id: "scarlet",             label: "Алый (красный)",       en: "Scarlet",              hex: "#e02020" },
  { id: "pink",                label: "Розовый",              en: "Pink",                 hex: "#e8207a" },
  { id: "candy-cane",          label: "Карамельная трость",   en: "Candy cane",           hex: "#d44060" },
  { id: "midnight-red",        label: "Полночный красный",    en: "Midnight Red",         hex: "#5a0a20", uv: true },
  // Синие
  { id: "peri-blue",           label: "Перламутровый голубой",en: "Peri Blue",            hex: "#90b8e0" },
  { id: "aqua-blue",           label: "Аква",                 en: "Aqua blue",            hex: "#30c0e0" },
  { id: "aquaterra",           label: "Акватерра",            en: "Aquaterra",            hex: "#00b0d0" },
  { id: "navy-blue",           label: "Темно-синий",          en: "Navy blue",            hex: "#1040a0" },
  { id: "meteor-shower",       label: "Метеоритный дождь",    en: "Meteor shower",        hex: "#1a3060" },
  // Фиолетовые / зеленые
  { id: "lavender",            label: "Лавандовый",           en: "Lavender",             hex: "#8868c8" },
  { id: "purple",              label: "Фиолетовый",           en: "Purple",               hex: "#6030a8" },
  { id: "purple-bk-mix",       label: "Фиолетово-черный микс",en: "Purple & Black mix",   hex: "#30104a" },
  { id: "army-green",          label: "Армейский зеленый",    en: "Army Green",           hex: "#3a5030" },
  { id: "nvidia-green",        label: "Зеленый NV",           en: "NVIDIA green",         hex: "#76b900" },
  { id: "acid-green",          label: "Кислотно-зеленый",     en: "Acid green",           hex: "#50e000", uv: true },
  { id: "toxic-rain",          label: "Кислотный дождь",      en: "Toxic Rain",           hex: "#2a4010" },
]

// ─── Палитра C-Cables PET 2мм (только 12V-2x6) ───────────────────────────────
const PALETTE_12V: { id: string; label: string; en: string; hex: string; uv?: boolean }[] = [
  { id: "white",         label: "Белый",                en: "White",              hex: "#f2f2f2" },
  { id: "light-gray",    label: "Светло-серый",         en: "Light gray (Silver)", hex: "#b8bfc8" },
  { id: "dark-gray",     label: "Темно-серый",          en: "Dark gray",          hex: "#555c63" },
  { id: "carbon-gray",   label: "Карбоновый серый",     en: "Carbon gray",        hex: "#3d4147" },
  { id: "gunmetal",      label: "Графит",               en: "Gunmetal",           hex: "#2e3238" },
  { id: "black",         label: "Черный",               en: "Black",              hex: "#1a1a1a" },
  { id: "carbon",        label: "Карбон",               en: "Carbon",             hex: "#1e2125" },
  { id: "citron",        label: "Цитрон",               en: "Citron",             hex: "#c8d400", uv: true },
  { id: "yellow",        label: "Желтый",               en: "Yellow",             hex: "#f5c800" },
  { id: "gold",          label: "Золотой",              en: "Gold",               hex: "#c8920a" },
  { id: "terracotta",    label: "Терракотовый",         en: "Terracotta",         hex: "#b5633a" },
  { id: "orange",        label: "Оранж",                en: "Orange",             hex: "#f07000", uv: true },
  { id: "red",           label: "Красный",              en: "Red",                hex: "#cc1515" },
  { id: "scarlet",       label: "Алый (красный)",       en: "Scarlet",            hex: "#e02020" },
  { id: "pink",          label: "Розовый",              en: "Pink",               hex: "#e8207a" },
  { id: "aqua-blue",     label: "Аква",                 en: "Aqua blue",          hex: "#30c0e0" },
  { id: "aquaterra",     label: "Акватерра",            en: "Aquaterra",          hex: "#00b0d0" },
  { id: "navy-blue",     label: "Темно-синий",          en: "Navy blue",          hex: "#1040a0" },
  { id: "meteor-shower", label: "Метеоритный дождь",    en: "Meteor shower",      hex: "#1a3060" },
  { id: "purple",        label: "Фиолетовый",           en: "Purple",             hex: "#6030a8" },
  { id: "acid-green",    label: "Кислотно-зеленый",     en: "Acid green",         hex: "#50e000", uv: true },
]

const DEFAULT_COLOR = "black"
const DEFAULT_HEX = "#1a1a1a"
const getHex = (id: string, pal: typeof PALETTE = PALETTE) => (pal as typeof PALETTE).find(p => p.id === id)?.hex ?? DEFAULT_HEX
const getLabel = (id: string, pal: typeof PALETTE = PALETTE) => (pal as typeof PALETTE).find(p => p.id === id)?.label ?? id
const getEn = (id: string, pal: typeof PALETTE = PALETTE) => (pal as typeof PALETTE).find(p => p.id === id)?.en ?? id

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
        <rect x={x + PIN_W / 2 - 3} y={y} width={6} height={PIN_H - 4} rx={2} fill={hex} />
        <rect x={x} y={y} width={PIN_W} height={PIN_H} rx={3}
          fill={hex}
          stroke={isSelected ? "white" : "rgba(255,255,255,0.18)"}
          strokeWidth={isSelected ? 2.5 : 0.8} />
        {isSelected && (
          <rect x={x} y={y} width={PIN_W} height={PIN_H} rx={3}
            fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
        )}
        <rect x={x + 3} y={y + 3} width={PIN_W - 6} height={5} rx={1.5} fill="rgba(255,255,255,0.2)" />
      </g>
    )
  }

  const body = (
    <g>
      {label && (
        <text x={totalW / 2} y={-8} textAnchor="middle" fontSize={9}
          fill="rgba(255,255,255,0.45)" fontFamily="monospace">{label}</text>
      )}
      <rect x={0} y={0} width={totalW} height={connH} rx={5}
        fill="#1e293b" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      {Array.from({ length: count }, (_, i) => renderPin(i, i * (PIN_W + PIN_GAP) + 2, 4))}
    </g>
  )

  if (direction === "up") return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const hex = getHex(pinColors[makePinKey(prefix, i)] ?? DEFAULT_COLOR, palette)
        const cx = i * (PIN_W + PIN_GAP) + 2 + PIN_W / 2
        return <line key={i} x1={cx} y1={0} x2={cx} y2={-WIRE_LEN} stroke={hex} strokeWidth={3.5} strokeLinecap="round" />
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
        return <line key={i} x1={cx} y1={connH} x2={cx} y2={connH + WIRE_LEN} stroke={hex} strokeWidth={3.5} strokeLinecap="round" />
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
        <rect x={4} y={y + PIN_W / 2 - 3} width={PIN_H - 4} height={6} rx={2} fill={hex} />
        <rect x={4} y={y} width={PIN_H} height={PIN_W} rx={3}
          fill={hex}
          stroke={isSelected ? "white" : "rgba(255,255,255,0.18)"}
          strokeWidth={isSelected ? 2.5 : 0.8} />
        {isSelected && (
          <rect x={4} y={y} width={PIN_H} height={PIN_W} rx={3}
            fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
        )}
        <rect x={7} y={y + 3} width={5} height={PIN_W - 6} rx={1.5} fill="rgba(255,255,255,0.2)" />
      </g>
    )
  }

  return (
    <g>
      <text x={connH / 2} y={-8} textAnchor="middle" fontSize={9}
        fill="rgba(255,255,255,0.45)" fontFamily="monospace">ATX 24-pin</text>
      <rect x={0} y={0} width={connH} height={totalW} rx={5}
        fill="#1e293b" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      {Array.from({ length: count }, (_, i) => renderPinV(i))}
      {Array.from({ length: count }, (_, i) => {
        const hex = getHex(pinColors[makePinKey(prefix, i)] ?? DEFAULT_COLOR, palette)
        const cy = i * (PIN_W + PIN_GAP) + 2 + PIN_W / 2
        return <line key={i} x1={connH} y1={cy} x2={connH + WIRE_LEN} y2={cy} stroke={hex} strokeWidth={3.5} strokeLinecap="round" />
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

  const boardX = 40
  const boardY = WIRE_LEN + 10
  const cpuX = boardX + PAD
  const gpuX = boardX + PAD
  const atxX = boardX + boardW + 40
  const atxY = boardY - 60

  return (
    <div className="space-y-6">
      {/* SVG + Палитра — две колонки */}
      <div className="flex gap-4 items-stretch justify-end">
        <div className="overflow-x-auto flex-1 min-w-0">
        <div className="min-w-[320px]">
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



            {/* CPU */}
            <g transform={`translate(${cpuX}, ${boardY})`}>
              <PinStrip prefix="cpu" count={cpuCount} pinColors={pinColors}
                selectedPins={selectedPins}
                onPinPointerDown={handlePinPointerDown}
                onPinPointerEnter={handlePinPointerEnter}
                palette={PALETTE} direction="up" label={`CPU · ${cpuType}`} />
            </g>

            {/* GPU */}
            <g transform={`translate(${gpuX}, ${boardY + boardH + 30})`}>
              <PinStrip prefix="gpu" count={gpuCount} pinColors={pinColors}
                selectedPins={selectedPins}
                onPinPointerDown={handlePinPointerDown}
                onPinPointerEnter={handlePinPointerEnter}
                palette={gpuPalette} direction="down" label={`GPU · ${gpuType}`} />
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

        {/* Правая колонка — выбор типов + палитра */}
        <div className="w-56 shrink-0 flex flex-col gap-4 pt-1 border-l border-border/40 pl-4">

          {/* Выбор типа кабелей */}
          <div className="space-y-3">
            <div>
              <p className="text-xs text-foreground/50 mb-1.5">CPU кабель</p>
              <div className="flex flex-wrap gap-1">
                {CPU_TYPES.map(t => (
                  <button key={t} onClick={() => { setCpuType(t); setSelectedPins(new Set()) }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${cpuType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}
                    style={{ cursor: "pointer" }}>{t}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-foreground/50 mb-1.5">GPU кабель</p>
              <div className="flex flex-wrap gap-1">
                {GPU_TYPES.map(t => (
                  <button key={t} onClick={() => { setGpuType(t); setSelectedPins(new Set()) }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${gpuType === t ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary/50"}`}
                    style={{ cursor: "pointer" }}>{t}</button>
                ))}
              </div>
              {is12v && <p className="mt-1 text-[10px] text-yellow-400/80">⚡ Своя палитра</p>}
            </div>
          </div>

          <div className="border-t border-border/30" />

          {/* Статус */}
          <div className="min-h-[18px]">
            {selectedPins.size > 0 ? (
              <p className="text-xs text-primary font-mono">
                {selectedPins.size} {selectedPins.size === 1 ? "пин" : selectedPins.size < 5 ? "пина" : "пинов"}
                {firstColor && ` · ${activePalette.find(p => p.id === firstColor)?.label ?? ""}`}
              </p>
            ) : (
              <p className="text-xs text-foreground/30">Кликни или веди по пинам</p>
            )}
          </div>

          {/* Палитра */}
          <div>
          <p className="text-xs text-foreground/50 mb-2">
            {is12v ? "PET 2мм (12V-2x6)" : "PET 4мм"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {activePalette.map(color => {
              const isActive = firstColor === color.id
              return (
                <div key={color.id} className="relative group">
                  <button title={color.label} onClick={() => applyColor(color.id)}
                    className={`h-7 w-7 rounded-full border-2 transition-all hover:scale-110 ${isActive ? "border-white scale-110" : "border-transparent opacity-85"}`}
                    style={{ backgroundColor: color.hex, cursor: "pointer",
                      boxShadow: isActive ? "0 0 0 3px hsl(var(--primary))" : undefined }} />
                  {color.uv && (
                    <span className="absolute -top-1 -right-1 text-[8px] leading-none bg-purple-600 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold pointer-events-none">U</span>
                  )}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 pointer-events-none">
                    <div className="bg-popover border border-border rounded-lg px-2 py-1 text-[10px] text-foreground whitespace-nowrap shadow-lg">
                      {color.label}
                      <span className="block text-foreground/40">{color.en}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {selectedPins.size > 0 && (
            <div className="flex flex-col gap-1.5">
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
          )}
          </div>
        </div>
      </div>

      {/* Итог */}
      <div className="space-y-3 pt-2 border-t border-border">
        {/* Сводка по цветам */}
        <div className="space-y-2">
          {[
            { prefix: "cpu", label: `CPU ${cpuType} (PET 4мм)`, count: cpuCount, pal: PALETTE },
            { prefix: "gpu", label: `GPU ${gpuType} (${is12v ? "PET 2мм" : "PET 4мм"})`, count: gpuCount, pal: is12v ? PALETTE_12V : PALETTE },
            { prefix: "atx", label: "ATX 24-pin (PET 4мм)", count: ATX_PINS, pal: PALETTE },
          ].map(({ prefix, label, count, pal }) => {
            const colorGroups: Record<string, number> = {}
            pinKeys(prefix, count).forEach(k => {
              const c = pinColors[k] ?? DEFAULT_COLOR
              colorGroups[c] = (colorGroups[c] ?? 0) + 1
            })
            return (
              <div key={prefix} className="text-xs text-foreground/50">
                <span className="text-foreground/70 font-medium">{label}:</span>{" "}
                {Object.entries(colorGroups).map(([cid, cnt], i) => (
                  <span key={cid}>
                    {i > 0 && ", "}
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-2.5 h-2.5 rounded-full border border-white/20"
                        style={{ backgroundColor: getHex(cid, pal as typeof PALETTE) }} />
                      {getLabel(cid, pal as typeof PALETTE)}{cnt > 1 ? ` ×${cnt}` : ""}
                    </span>
                  </span>
                ))}
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-foreground/30">Партнёр: C-Cables · цена согласовывается после оформления</p>
        <button onClick={() => {
          // Формируем детальное описание для заказа
          const buildSummary = (prefix: string, count: number, pal: typeof PALETTE) => {
            const groups: Record<string, number[]> = {}
            pinKeys(prefix, count).forEach((k, i) => {
              const c = pinColors[k] ?? DEFAULT_COLOR
              if (!groups[c]) groups[c] = []
              groups[c].push(i + 1)
            })
            return Object.entries(groups).map(([cid, idxs]) =>
              `${getEn(cid, pal)} (пины: ${idxs.join(",")})`
            ).join("; ")
          }
          const detail = [
            `CPU ${cpuType} PET4mm: ${buildSummary("cpu", cpuCount, PALETTE)}`,
            `GPU ${gpuType} ${is12v ? "PET2mm" : "PET4mm"}: ${buildSummary("gpu", gpuCount, is12v ? PALETTE_12V as typeof PALETTE : PALETTE)}`,
            `ATX 24pin PET4mm: ${buildSummary("atx", ATX_PINS, PALETTE)}`,
          ].join(" | ")
          addToCart(detail)
        }}
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