import { useMemo, useState } from "react"
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts"
import { ChartConfig } from "@/lib/chartTypes"

interface Props {
  config: ChartConfig
  compact?: boolean   // уменьшенная высота для превью в редакторе
}

interface TooltipPayloadItem {
  dataKey: string
  value: number | null
  color: string
  name: string
  payload?: { _color?: string; name?: string }
}

// ─── Тултип «по сериям» (линейный): значения всех серий в точке ───────────────
function MultiSeriesTooltip({ active, payload, label, seriesNames, axisLabel }: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
  seriesNames: Record<string, string>
  axisLabel?: string
}) {
  if (!active || !payload || !payload.length) return null
  const rows = payload
    .filter(p => p.value !== null && p.value !== undefined)
    .sort((a, b) => Number(b.value) - Number(a.value))
  return (
    <div className="rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-xl text-xs max-w-[260px]">
      <div className="mb-1.5 font-medium text-foreground">{axisLabel ? `${axisLabel}: ` : ""}{label}</div>
      <div className="space-y-1">
        {rows.map(p => (
          <div key={p.dataKey} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-foreground/70 truncate">
              <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="truncate">{seriesNames[p.dataKey] || p.name}</span>
            </span>
            <span className="font-medium text-foreground tabular-nums">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Тултип «по строкам» (один столбец = один предмет) ────────────────────────
function SingleBarTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0]
  return (
    <div className="rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 shadow-xl text-xs">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: p.payload?._color }} />
        <span className="text-foreground/70">{p.payload?.name}</span>
        <span className="ml-2 font-medium text-foreground tabular-nums">{p.value}</span>
      </span>
    </div>
  )
}

const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false }

// Процент разницы относительно базы. >0 — больше базы (зелёный), <0 — меньше (красный).
function diffPct(value: number, base: number): number | null {
  if (!base || base === 0 || value === null || value === undefined) return null
  return Math.round(((value - base) / base) * 100)
}

interface RowItem { id: string; name: string; value: number | null; _color: string }

// Кастомная подпись над столбцом: само значение + бейдж % разницы от базы.
// betterIsLower: если для метрики меньше = лучше, то рост значения = красный.
function BarTopLabel(props: {
  x?: number; y?: number; width?: number; value?: number | null
  index?: number; items: RowItem[]; baseId: string | null; showValues?: boolean
  betterIsLower?: boolean
}) {
  const { x = 0, y = 0, width = 0, value, index = 0, items, baseId, showValues, betterIsLower } = props
  const item = items[index]
  if (!item) return null
  const cx = x + width / 2
  const base = baseId ? items.find(it => it.id === baseId) : null
  const pct = base && base.value != null && item.value != null && item.id !== baseId
    ? diffPct(item.value, base.value) : null
  const isBase = baseId === item.id

  // pct>0 — значение больше базы. «Хорошо», если (больше лучше и pct>0) или
  // (меньше лучше и pct<0). Цвет: зелёный=хорошо, красный=плохо.
  const isGood = pct != null && (betterIsLower ? pct < 0 : pct > 0)

  return (
    <g>
      {showValues && value != null && (
        <text x={cx} y={y - (pct != null || isBase ? 16 : 4)} textAnchor="middle"
          fontSize={12} fontWeight={600} fill="hsl(var(--foreground))">{value}</text>
      )}
      {isBase && (
        <text x={cx} y={y - 3} textAnchor="middle" fontSize={10} fontWeight={700} fill="hsl(var(--primary))">база</text>
      )}
      {pct != null && pct !== 0 && (
        <text x={cx} y={y - 3} textAnchor="middle" fontSize={11} fontWeight={700}
          fill={isGood ? "#22c55e" : "#ef4444"}>
          {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%
        </text>
      )}
      {pct === 0 && (
        <text x={cx} y={y - 3} textAnchor="middle" fontSize={11} fontWeight={700} fill="hsl(var(--muted-foreground))">0%</text>
      )}
    </g>
  )
}

// ─── Один график для одной СТРОКИ данных (ось X = предметы/серии) ──────────────
// Каждая строка («Время», «Цена») получает свою шкалу Y — большие значения
// одной метрики не давят мелкие другой. Клик по столбцу → база сравнения.
function RowChart({ title, items, showValues, height, baseId, onPickBase, betterIsLower }: {
  title: string | null
  items: RowItem[]
  showValues?: boolean
  height: number
  baseId: string | null
  onPickBase: (id: string) => void
  betterIsLower?: boolean
}) {
  return (
    <div>
      {title && (
        <p className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground/80">
          {title}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-foreground/50">
            {betterIsLower ? "↓ меньше — лучше" : "↑ больше — лучше"}
          </span>
        </p>
      )}
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} margin={{ top: 26, right: 12, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" {...AXIS} interval={0} angle={-25} textAnchor="end" height={64} />
            <YAxis {...AXIS} domain={[0, "auto"]} />
            <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} content={<SingleBarTooltip />} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}
              onClick={(_, i) => onPickBase(items[i].id)} style={{ cursor: "pointer" }}>
              {items.map((d, i) => (
                <Cell key={i} fill={d._color}
                  stroke={baseId === d.id ? "hsl(var(--foreground))" : undefined}
                  strokeWidth={baseId === d.id ? 2 : 0}
                  fillOpacity={baseId && baseId !== d.id ? 0.85 : 1} />
              ))}
              <LabelList dataKey="value" content={(p) => <BarTopLabel {...p} items={items} baseId={baseId} showValues={showValues} betterIsLower={betterIsLower} />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── График «по сериям» (ось X = точки данных, серии = линии/столбцы) ──────────
// Линейный график и столбчатый с одной строкой данных.
function SeriesChart({ config, hidden, height, seriesNames }: {
  config: ChartConfig
  hidden: Set<string>
  height: number
  seriesNames: Record<string, string>
}) {
  const visible = config.series.filter(s => !hidden.has(s.id))
  const data = useMemo(
    () => config.points.map(pt => ({ x: pt.x, ...pt.values })),
    [config.points]
  )
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        {config.type === "line" ? (
          <LineChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="x" {...AXIS}
              label={config.xLabel ? { value: config.xLabel, position: "insideBottom", offset: -12, fontSize: 11, fill: "hsl(var(--muted-foreground))" } : undefined} />
            <YAxis {...AXIS} domain={["auto", "auto"]}
              label={config.yLabel ? { value: config.yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "hsl(var(--muted-foreground))" } : undefined} />
            <Tooltip content={<MultiSeriesTooltip seriesNames={seriesNames} axisLabel={config.xLabel} />} />
            {visible.map(s => (
              <Line key={s.id} type="monotone" dataKey={s.id} name={s.name}
                stroke={s.color} strokeWidth={2}
                dot={config.showDots ? { r: 3, fill: s.color } : false}
                activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 18, right: 16, left: 8, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="x" {...AXIS}
              label={config.xLabel ? { value: config.xLabel, position: "insideBottom", offset: -12, fontSize: 11, fill: "hsl(var(--muted-foreground))" } : undefined} />
            <YAxis {...AXIS} domain={[0, "auto"]}
              label={config.yLabel ? { value: config.yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "hsl(var(--muted-foreground))" } : undefined} />
            <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} content={<MultiSeriesTooltip seriesNames={seriesNames} axisLabel={config.xLabel} />} />
            {visible.map(s => (
              <Bar key={s.id} dataKey={s.id} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {config.showValues && <LabelList dataKey={s.id} position="top" fontSize={11} fill="hsl(var(--foreground))" />}
              </Bar>
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

export default function ArticleChart({ config, compact }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(config.series.filter(s => s.hidden).map(s => s.id))
  )
  // База сравнения: id предмета. Клик по столбцу → его % разницы = 0, остальные
  // показывают разницу относительно него. Повторный клик — сброс.
  const [baseId, setBaseId] = useState<string | null>(null)
  const pickBase = (id: string) => setBaseId(prev => prev === id ? null : id)

  const toggle = (id: string) =>
    setHidden(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })

  const seriesNames = useMemo(() => {
    const m: Record<string, string> = {}
    config.series.forEach(s => { m[s.id] = s.name })
    return m
  }, [config.series])

  // Столбчатый график с НЕСКОЛЬКИМИ строками данных рисуем построчно:
  // каждая строка («Время», «Цена») = отдельный график со своей шкалой Y,
  // по оси X — предметы (серии).
  const splitByRows = config.type === "bar" && config.points.length > 1

  const rows = useMemo(() => {
    if (!splitByRows) return []
    return config.points.map(pt => ({
      title: pt.x,
      betterIsLower: !!pt.betterIsLower,
      items: config.series
        .filter(s => !hidden.has(s.id))
        .map(s => ({ id: s.id, name: s.name, value: pt.values[s.id] ?? null, _color: s.color })),
    }))
  }, [splitByRows, config.points, config.series, hidden])

  const height = compact
    ? (splitByRows ? 240 : 260)
    : (splitByRows ? 320 : 420)

  return (
    <figure className="my-5 rounded-xl border border-border bg-card p-4">
      {config.title && (
        <figcaption className="mb-3 text-center text-base font-semibold text-foreground">
          {config.title}
        </figcaption>
      )}

      {splitByRows ? (
        <>
          <p className="mb-2 text-center text-[11px] text-foreground/40">
            Нажмите на столбец — увидите разницу остальных в процентах относительно него.
          </p>
          <div className="space-y-5">
            {rows.map((r, i) => (
              <RowChart key={i} title={r.title} items={r.items} showValues={config.showValues}
                height={height} baseId={baseId} onPickBase={pickBase} betterIsLower={r.betterIsLower} />
            ))}
          </div>
        </>
      ) : (
        <SeriesChart config={config} hidden={hidden} height={height} seriesNames={seriesNames} />
      )}

      {/* Легенда-фильтр: клик скрывает/показывает предмет на всех графиках */}
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {config.series.map(s => {
          const off = hidden.has(s.id)
          return (
            <button key={s.id} type="button" onClick={() => toggle(s.id)}
              style={{ cursor: "pointer" }}
              className={`flex items-center gap-1.5 text-xs transition-opacity ${off ? "opacity-35 line-through" : "opacity-100"} hover:opacity-70`}>
              <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-foreground/80">{s.name}</span>
            </button>
          )
        })}
      </div>
    </figure>
  )
}