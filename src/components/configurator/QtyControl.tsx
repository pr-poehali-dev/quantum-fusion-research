import Icon from "@/components/ui/icon"

export function QtyControl({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
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
