import Icon from "@/components/ui/icon"

/**
 * Блок «Требуется обслуживание GPU» — то же предупреждение, что программа
 * показывает в своём отчёте и присылает в Telegram: перегрев Hot Spot,
 * перегрев памяти видеокарты, большая разница Hot Spot и ядра.
 *
 * Это не «упавший тест»: тесты могли пройти, но видеокарту нужно обслужить.
 */
export default function GpuMaintenanceNotice({ issues, compact }: {
  issues?: string[]
  compact?: boolean
}) {
  const list = (issues || []).map(i => String(i).trim()).filter(Boolean)
  if (!list.length) return null

  return (
    <div className={`rounded-xl border border-orange-500/40 bg-orange-500/10 ${compact ? "p-2.5" : "p-3"}`}>
      <div className="flex items-center gap-1.5 text-sm font-medium text-orange-500">
        <Icon name="TriangleAlert" size={compact ? 13 : 15} className="shrink-0" />
        Требуется обслуживание GPU
      </div>
      <ul className={`${compact ? "mt-1" : "mt-1.5"} space-y-0.5`}>
        {list.map((issue, i) => (
          <li key={i} className="flex gap-1.5 text-xs text-foreground/70">
            <span className="text-orange-500/60">•</span>
            <span>{issue}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
