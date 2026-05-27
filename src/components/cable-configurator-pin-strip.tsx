import { PALETTE, DEFAULT_COLOR, getHex, makePinKey, PIN_W, PIN_H, PIN_GAP, WIRE_LEN, PinColors } from "./cable-configurator.types"

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

export function PinStrip({ prefix, count, pinColors, selectedPins, onPinPointerDown, onPinPointerEnter, palette, direction, label }: PinStripProps) {
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
