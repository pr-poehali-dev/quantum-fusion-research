import { useState, useRef, useCallback } from "react"
import Icon from "@/components/ui/icon"
import { PinStrip } from "./cable-configurator-pin-strip"
import {
  PALETTE, PALETTE_12V, DEFAULT_COLOR,
  getHex, getLabel, getEn,
  CPU_TYPES, GPU_TYPES, CPU_PINS, GPU_PINS, ATX_PINS,
  PIN_W, PIN_H, PIN_GAP, WIRE_LEN,
  PinColors, CpuType, GpuType,
  makePinKey, initPins, pinKeys,
} from "./cable-configurator.types"

// ─── CableBody ────────────────────────────────────────────────────────────────
interface CableBodyProps {
  addToCart: (name: string, summary: string, pinColors: PinColors, cpuType: string, gpuType: string) => void
  added: boolean
  initialCpuType?: CpuType
  initialGpuType?: GpuType
  initialPinColors?: PinColors
  onSave?: (pinColors: PinColors, cpuType: string, gpuType: string) => void
  saveLabel?: string
}

export function CableBody({ addToCart, added, initialCpuType, initialGpuType, initialPinColors, onSave, saveLabel }: CableBodyProps) {
  const [cpuType, setCpuType] = useState<CpuType>(initialCpuType ?? "8-pin")
  const [gpuType, setGpuType] = useState<GpuType>(initialGpuType ?? "8-pin")
  const [showNameDialog, setShowNameDialog] = useState(false)
  const [cableName, setCableName] = useState("")

  const cpuCount = CPU_PINS[cpuType]
  const gpuCount = GPU_PINS[gpuType]
  const is12v = gpuType === "12V-2x6"
  const gpuPalette = is12v ? PALETTE_12V : PALETTE

  const [pinColors, setPinColors] = useState<PinColors>(() => ({
    ...initPins("cpu", 16),
    ...initPins("atx", ATX_PINS),
    ...initPins("gpu", 24),
    ...(initialPinColors ?? {}),
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

  const buildSummary = (prefix: string, count: number, pal: typeof PALETTE) => {
    const groups: Record<string, number[]> = {}
    pinKeys(prefix, count).forEach((k, i) => {
      const c = pinColors[k] ?? DEFAULT_COLOR
      if (!groups[c]) groups[c] = []
      groups[c].push(i + 1)
    })
    return Object.entries(groups).map(([cid, idxs]) => `${getEn(cid, pal)} (пины: ${idxs.join(",")})`).join("; ")
  }

  const buildDetail = () => [
    `CPU ${cpuType} PET4mm: ${buildSummary("cpu", cpuCount, PALETTE)}`,
    `GPU ${gpuType} ${is12v ? "PET2mm" : "PET4mm"}: ${buildSummary("gpu", gpuCount, is12v ? PALETTE_12V as typeof PALETTE : PALETTE)}`,
    `ATX 24pin PET4mm: ${buildSummary("atx", ATX_PINS, PALETTE)}`,
  ].join(" | ")

  const handleConfirmAdd = () => {
    if (!cableName.trim()) return
    addToCart(cableName.trim(), buildDetail(), pinColors, cpuType, gpuType)
    setShowNameDialog(false)
    setCableName("")
  }

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
      <div className="space-y-3 pt-2 border-t border-border w-full max-w-2xl ml-0">
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

        {/* Диалог названия */}
        {showNameDialog ? (
          <div className="space-y-2">
            <p className="text-xs text-foreground/60">Дай название набору кабелей:</p>
            <input
              autoFocus
              type="text"
              value={cableName}
              onChange={e => setCableName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && cableName.trim()) handleConfirmAdd() }}
              placeholder="Например: Чёрно-красный"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              style={{ cursor: "text" }}
            />
            <div className="flex gap-2">
              <button
                onClick={handleConfirmAdd}
                disabled={!cableName.trim()}
                className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                style={{ cursor: "pointer" }}>
                Сохранить и добавить
              </button>
              <button onClick={() => { setShowNameDialog(false); setCableName("") }}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground/60 hover:text-foreground transition-colors"
                style={{ cursor: "pointer" }}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {onSave && (
              <button onClick={() => onSave(pinColors, cpuType, gpuType)}
                className="flex-1 rounded-xl py-3 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
                style={{ cursor: "pointer" }}>
                <span className="flex items-center justify-center gap-2">
                  <Icon name="Save" size={15} />{saveLabel ?? "Сохранить"}
                </span>
              </button>
            )}
            <button
              onClick={() => added ? null : setShowNameDialog(true)}
              className={`flex-1 rounded-xl py-3 text-sm font-medium transition-all ${added
                ? "bg-green-600/20 text-green-400 border border-green-500/30"
                : "bg-card border border-border text-foreground/70 hover:border-primary hover:text-foreground"}`}
              style={{ cursor: added ? "default" : "pointer" }}>
              {added
                ? <span className="flex items-center justify-center gap-2"><Icon name="Check" size={15} />Добавлено в корзину</span>
                : <span className="flex items-center justify-center gap-2"><Icon name="ShoppingCart" size={15} />В корзину</span>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
