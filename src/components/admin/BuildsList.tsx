import Icon from "@/components/ui/icon"
import { PCBuild, BUILD_STATUS } from "@/pages/admin/types"

// ── Строка одной сборки ──
export function BuildRow({ b, isVariant, isMain, hasVariants, isArchive, dupeLoading, copiedBuildId, fmt, onEdit, onDupe, onLink, onStatus, onDelete }: {
  b: PCBuild
  isVariant: boolean
  isMain: boolean
  hasVariants: boolean
  isArchive: boolean
  dupeLoading: number | null
  copiedBuildId: number | null
  fmt: (n: number) => string
  onEdit: (b: PCBuild) => void
  onDupe: (b: PCBuild) => void
  onLink: (b: PCBuild) => void
  onStatus: (b: PCBuild, status: string) => void
  onDelete: (id: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <p className="font-medium text-foreground text-sm truncate">{b.name}</p>
          {isMain && hasVariants && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0">
              Рекомендуемый
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-xs shrink-0 ${
            b.status === "catalog" ? "bg-green-400/10 text-green-400"
            : b.status === "archive" ? "bg-muted text-foreground/30"
            : "bg-muted text-foreground/50"
          }`}>{BUILD_STATUS[b.status] || b.status}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-foreground/50">
          <span>{b.components?.length || 0} комп.</span>
          <span className="font-semibold text-foreground/70">{fmt(b.total_price)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 shrink-0">
        <button onClick={() => onEdit(b)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="Pencil" size={12} />Ред.
        </button>
        {isMain && !isArchive && (
          <button onClick={() => onDupe(b)} disabled={dupeLoading === b.id}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors disabled:opacity-50"
            style={{ cursor: "pointer" }}>
            <Icon name={dupeLoading === b.id ? "Loader2" : "Plus"} size={12} />
            {dupeLoading === b.id ? "..." : "Вариант"}
          </button>
        )}
        {isMain && !isArchive && (
          <button onClick={() => onLink(b)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${b.client_token ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>
            <Icon name={copiedBuildId === b.id ? "Check" : "Link"} size={12} />
            {copiedBuildId === b.id ? "Скопировано!" : b.client_token ? "Ссылка" : "Ссылка клиенту"}
          </button>
        )}
        {isMain ? (
          <select value={b.status} onChange={e => onStatus(b, e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
            {Object.entries(BUILD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        ) : (
          <span className="rounded-lg border border-border/50 px-2 py-1.5 text-xs text-foreground/30 select-none" title="Статус берётся с основной сборки">
            {BUILD_STATUS[b.status] || b.status}
          </span>
        )}
        <button onClick={() => onDelete(b.id)}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/30 hover:border-red-400 hover:text-red-400 transition-colors"
          style={{ cursor: "pointer" }}>
          <Icon name="Trash2" size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Список сборок с группировкой по вариантам ──
export function BuildsList({ builds, loading, expandedVariants, setExpandedVariants, dupeLoading, copiedBuildId, fmt, onNew, onEdit, onDupe, onLink, onStatus, onDelete, isArchive }: {
  builds: PCBuild[]; loading: boolean; expandedVariants: number | null
  setExpandedVariants: (id: number | null) => void
  dupeLoading: number | null; copiedBuildId: number | null
  fmt: (n: number) => string
  onNew: () => void
  onEdit: (b: PCBuild) => void
  onDupe: (b: PCBuild) => void
  onLink: (b: PCBuild) => void
  onStatus: (b: PCBuild, status: string) => void
  onDelete: (id: number) => void
  isArchive: boolean
}) {
  const variantMap = new Map<number, PCBuild[]>()
  const roots: PCBuild[] = []
  for (const b of builds) {
    if (b.parent_id) {
      if (!variantMap.has(b.parent_id)) variantMap.set(b.parent_id, [])
      variantMap.get(b.parent_id)!.push(b)
    } else {
      roots.push(b)
    }
  }
  const groups: { main: PCBuild; variants: PCBuild[] }[] = roots.map(b => ({
    main: b,
    variants: (variantMap.get(b.id) || []).sort((a, b) => a.id - b.id),
  }))
  groups.sort((a, b) => b.main.id - a.main.id)

  const rowProps = { isArchive, dupeLoading, copiedBuildId, fmt, onEdit, onDupe, onLink, onStatus, onDelete }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-light text-foreground">
          {isArchive ? "Архив ПК" : "Наши ПК"} <span className="text-sm text-foreground/40 ml-1">({builds.length})</span>
        </h2>
        {!isArchive && (
          <button onClick={onNew} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={16} />Новая сборка
          </button>
        )}
      </div>
      {loading
        ? <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)}</div>
        : groups.length === 0
          ? <div className="py-16 text-center text-foreground/40"><Icon name="Monitor" size={40} className="mx-auto mb-3 opacity-30" /><p>{isArchive ? "Архив пуст" : "Сборок нет."}</p></div>
          : <div className="space-y-2">
            {groups.map(({ main, variants }) => {
              const isOpen = expandedVariants === main.id
              return (
                <div key={main.id} className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="flex items-stretch">
                    <button
                      onClick={() => variants.length > 0 && setExpandedVariants(isOpen ? null : main.id)}
                      className={`flex flex-col items-center justify-center gap-0.5 border-r border-border transition-colors ${variants.length > 0 ? "hover:bg-muted/60 cursor-pointer" : "cursor-default opacity-30"}`}
                      style={{ width: 44, minWidth: 44 }}
                      title={variants.length > 0 ? `${variants.length} вар. — нажмите` : "Вариантов нет"}
                    >
                      <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={15} className="text-foreground/50" />
                      {variants.length > 0 && <span className="text-[10px] font-bold text-primary leading-none">{variants.length}</span>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <BuildRow b={main} isMain={true} isVariant={false} hasVariants={variants.length > 0} {...rowProps} />
                    </div>
                  </div>
                  {isOpen && variants.length > 0 && (
                    <div className="border-t border-border/60">
                      <div className="px-4 py-2 flex items-center gap-2 bg-muted/30 border-b border-border/40">
                        <Icon name="GitBranch" size={11} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Варианты сборки — каждый редактируется отдельно</span>
                      </div>
                      {variants.map((v, i) => (
                        <div key={v.id} className={`${i < variants.length - 1 ? "border-b border-border/30" : ""} bg-muted/10`}>
                          <BuildRow b={v} isMain={false} isVariant={true} hasVariants={false} {...rowProps} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
      }
    </div>
  )
}
