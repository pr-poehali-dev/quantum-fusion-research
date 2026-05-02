import Icon from "@/components/ui/icon"
import { SLOT_LABELS, CatalogComp, SelectedComp } from "./configurator-types"

function QtyControl({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(1, qty - 1))}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
        style={{ cursor: "pointer" }}
      >
        <Icon name="Minus" size={11} />
      </button>
      <input
        type="number"
        min={1}
        max={99}
        value={qty}
        onChange={e => onChange(Math.max(1, parseInt(e.target.value) || 1))}
        className="w-11 rounded-lg border border-border bg-background px-1 py-1 text-center text-xs font-medium text-foreground focus:border-primary focus:outline-none"
        style={{ cursor: "text" }}
      />
      <button
        onClick={() => onChange(qty + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
        style={{ cursor: "pointer" }}
      >
        <Icon name="Plus" size={11} />
      </button>
    </div>
  )
}

interface Props {
  loading: boolean
  slots: Record<string, CatalogComp[]>
  selected: Record<string, SelectedComp | null>
  customInputs: Record<string, { name: string; price: string; link: string }>
  mode: "catalog" | "custom"
  openSlot: string | null
  fmt: (n: number) => string
  onSetSelected: (updater: (s: Record<string, SelectedComp | null>) => Record<string, SelectedComp | null>) => void
  onSetCustomInputs: (updater: (c: Record<string, { name: string; price: string; link: string }>) => Record<string, { name: string; price: string; link: string }>) => void
  onSetOpenSlot: (slot: string | null) => void
  onUpdateQty: (slot: string, qty: number) => void
  onSelectFromCatalog: (slot: string, comp: CatalogComp) => void
  onApplyCustom: (slot: string) => void
}

export default function ConfiguratorSlots({
  loading, slots, selected, customInputs, mode, openSlot, fmt,
  onSetSelected, onSetCustomInputs, onSetOpenSlot, onUpdateQty,
  onSelectFromCatalog, onApplyCustom,
}: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {Object.entries(SLOT_LABELS).map(([slot, meta]) => {
        const options = slots[slot] || []
        const current = selected[slot]
        const isOpen = openSlot === slot
        const ci = customInputs[slot] || { name: "", price: "", link: "" }

        return (
          <div key={slot} className={`rounded-xl border bg-card transition-all duration-200 ${current ? "border-primary/40" : "border-border"}`}>

            {/* Slot header row */}
            <div className="flex items-center gap-3 p-4">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${current ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/40"}`}>
                <Icon name={meta.icon as "Cpu"} size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{meta.label}</p>
                {!current && <p className="text-xs text-foreground/30">{meta.required ? "Обязательный" : "Необязательный"}</p>}
              </div>
              <div className="flex items-center gap-2">
                {current && (
                  <button onClick={() => onSetSelected(s => ({ ...s, [slot]: null }))} className="text-foreground/25 hover:text-foreground/60 transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="X" size={14} />
                  </button>
                )}
                <button
                  onClick={() => onSetOpenSlot(isOpen ? null : slot)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${current ? "border-primary/30 text-primary hover:bg-primary/10" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
                  style={{ cursor: "pointer" }}
                >
                  {current ? "Заменить" : "Выбрать"}
                </button>
              </div>
            </div>

            {/* Selected component: name + link + qty + line total */}
            {current && (
              <div className="border-t border-border/40 px-4 pb-4 pt-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground leading-tight">{current.name}</p>
                    {current.link && (
                      <a href={current.link} target="_blank" rel="noopener noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        style={{ cursor: "pointer" }}
                      >
                        <Icon name="ExternalLink" size={11} />
                        Ссылка на товар
                      </a>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-foreground/50">{fmt(current.price)}</span>
                    <QtyControl qty={current.qty} onChange={q => onUpdateQty(slot, q)} />
                    <span className="w-24 text-right text-sm font-bold text-primary">
                      {fmt(current.price * current.qty)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Picker panel */}
            {isOpen && (
              <div className="border-t border-border p-4">
                {mode === "catalog" ? (
                  options.length === 0
                    ? <p className="py-3 text-center text-xs text-foreground/40">Нет компонентов в каталоге</p>
                    : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {options.map(opt => (
                          <button key={opt.id} onClick={() => onSelectFromCatalog(slot, opt)}
                            className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left hover:border-primary transition-colors"
                            style={{ cursor: "pointer" }}
                          >
                            <div className="min-w-0 mr-2">
                              <p className="text-xs font-medium text-foreground truncate">{opt.name}</p>
                              {opt.brand && <p className="text-xs text-foreground/40">{opt.brand}</p>}
                              {Object.keys(opt.specs).length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {Object.values(opt.specs).slice(0, 2).map((v, i) => (
                                    <span key={i} className="rounded bg-muted px-1 py-px text-xs text-foreground/50">{v}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <p className="shrink-0 text-xs font-bold text-accent">{fmt(opt.price)}</p>
                          </button>
                        ))}
                      </div>
                    )
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input type="text" placeholder="Название компонента"
                        value={ci.name}
                        onChange={e => onSetCustomInputs(c => ({ ...c, [slot]: { ...ci, name: e.target.value } }))}
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                        style={{ cursor: "text" }}
                      />
                      <input type="number" placeholder="Цена ₽"
                        value={ci.price}
                        onChange={e => onSetCustomInputs(c => ({ ...c, [slot]: { ...ci, price: e.target.value } }))}
                        className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                        style={{ cursor: "text" }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <input type="url" placeholder="Ссылка на товар (необязательно)"
                        value={ci.link}
                        onChange={e => onSetCustomInputs(c => ({ ...c, [slot]: { ...ci, link: e.target.value } }))}
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                        style={{ cursor: "text" }}
                      />
                      <button onClick={() => onApplyCustom(slot)}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                        style={{ cursor: "pointer" }}
                      >
                        OK
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
