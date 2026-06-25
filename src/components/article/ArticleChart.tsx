import { useMemo, useState } from "react"
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
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
}

// Кастомный тултип — показывает значения ВСЕХ видимых серий в выбранной точке,
// отсортированные по убыванию (как на референсе с кулерами).
function ChartTooltip({ active, payload, label, seriesNames, axisLabel }: {
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
      <div className="mb-1.5 font-medium text-foreground">
        {axisLabel ? `${axisLabel}: ` : ""}{label}
      </div>
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

export default function ArticleChart({ config, compact }: Props) {
  // Локально скрытые серии (клик по легенде). Стартуем со скрытых из конфига.
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(config.series.filter(s => s.hidden).map(s => s.id))
  )

  const toggle = (id: string) =>
    setHidden(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })

  // Данные для recharts: [{ x, [seriesId]: value, ... }]
  const data = useMemo(
    () => config.points.map(pt => ({ x: pt.x, ...pt.values })),
    [config.points]
  )

  const seriesNames = useMemo(() => {
    const m: Record<string, string> = {}
    config.series.forEach(s => { m[s.id] = s.name })
    return m
  }, [config.series])

  const visible = config.series.filter(s => !hidden.has(s.id))
  const height = compact ? 260 : 420

  const axisProps = {
    stroke: "hsl(var(--muted-foreground))",
    fontSize: 11,
    tickLine: false,
  }

  return (
    <figure className="my-5 rounded-xl border border-border bg-card p-4">
      {config.title && (
        <figcaption className="mb-3 text-center text-base font-semibold text-foreground">
          {config.title}
        </figcaption>
      )}

      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          {config.type === "line" ? (
            <LineChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="x" {...axisProps}
                label={config.xLabel ? { value: config.xLabel, position: "insideBottom", offset: -12, fontSize: 11, fill: "hsl(var(--muted-foreground))" } : undefined} />
              <YAxis {...axisProps}
                label={config.yLabel ? { value: config.yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "hsl(var(--muted-foreground))" } : undefined} />
              <Tooltip content={<ChartTooltip seriesNames={seriesNames} axisLabel={config.xLabel} />} />
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
              <XAxis dataKey="x" {...axisProps}
                label={config.xLabel ? { value: config.xLabel, position: "insideBottom", offset: -12, fontSize: 11, fill: "hsl(var(--muted-foreground))" } : undefined} />
              <YAxis {...axisProps}
                label={config.yLabel ? { value: config.yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "hsl(var(--muted-foreground))" } : undefined} />
              <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} content={<ChartTooltip seriesNames={seriesNames} axisLabel={config.xLabel} />} />
              {visible.map(s => (
                <Bar key={s.id} dataKey={s.id} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {config.showValues && <LabelList dataKey={s.id} position="top" fontSize={11} fill="hsl(var(--foreground))" />}
                </Bar>
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Легенда-фильтр: клик скрывает/показывает серию */}
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