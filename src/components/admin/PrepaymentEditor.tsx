import { useState } from "react"
import Icon from "@/components/ui/icon"

interface Props {
  total: number
  percent?: number
  amount?: number
  /** Сохранение. Возвращает обновлённые значения от сервера, если есть. */
  onSave: (payload: { prepayment_percent?: number; prepayment_amount?: number }) =>
    Promise<{ prepayment_percent?: number; prepayment_amount?: number; remaining_amount?: number } | void>
  /** Подсветить остаток как «К доплате» (на этапе выдачи). */
  highlight?: boolean
  compact?: boolean
}

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽"

export default function PrepaymentEditor({ total, percent, amount, onSave, highlight, compact }: Props) {
  const initPct = percent ?? 30
  const initAmt = amount ?? Math.round(total * initPct / 100)

  const [pct, setPct] = useState(initPct)
  const [amt, setAmt] = useState(initAmt)
  const [mode, setMode] = useState<"percent" | "amount">("percent")
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pctVal, setPctVal] = useState(String(initPct))
  const [amtVal, setAmtVal] = useState(String(initAmt))

  const remaining = Math.max(0, total - amt)

  const open = () => {
    setPctVal(String(pct))
    setAmtVal(String(amt))
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    let payload: { prepayment_percent?: number; prepayment_amount?: number }
    if (mode === "amount") {
      const a = Math.max(0, Math.min(total, parseFloat(amtVal.replace(",", ".")) || 0))
      payload = { prepayment_amount: a }
    } else {
      const p = Math.max(0, Math.min(100, parseFloat(pctVal.replace(",", ".")) || 0))
      payload = { prepayment_percent: p }
    }
    const res = await onSave(payload)
    const newPct = res?.prepayment_percent ?? (payload.prepayment_percent ?? Math.round((payload.prepayment_amount! / total) * 100))
    const newAmt = res?.prepayment_amount ?? (payload.prepayment_amount ?? Math.round(total * (payload.prepayment_percent! / 100)))
    setPct(newPct)
    setAmt(newAmt)
    setSaving(false)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className={compact ? "text-[10px] leading-tight" : "text-sm"}>
        <button onClick={open} className="text-primary/80 hover:text-primary inline-flex items-center gap-1" style={{ cursor: "pointer" }}>
          <Icon name="Pencil" size={compact ? 10 : 13} />
          Предоплата {Math.round(pct)}% · {fmt(amt)}
        </button>
        <p className={highlight ? "font-bold text-amber-400" : "text-foreground/50"}>
          {highlight ? "К доплате: " : "Остаток: "}{fmt(remaining)}
        </p>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border border-border bg-background p-2 ${compact ? "text-[10px]" : "text-sm"} space-y-2`}>
      <div className="flex gap-1">
        <button onClick={() => setMode("percent")}
          className={`flex-1 rounded border px-1.5 py-0.5 ${mode === "percent" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/50"}`}
          style={{ cursor: "pointer" }}>%</button>
        <button onClick={() => setMode("amount")}
          className={`flex-1 rounded border px-1.5 py-0.5 ${mode === "amount" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/50"}`}
          style={{ cursor: "pointer" }}>₽</button>
      </div>
      {mode === "percent" ? (
        <div className="flex items-center gap-1">
          <input value={pctVal} onChange={e => setPctVal(e.target.value)} inputMode="decimal" autoFocus
            className="w-full rounded border border-border bg-card px-2 py-1 text-right" />
          <span className="text-foreground/50">%</span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <input value={amtVal} onChange={e => setAmtVal(e.target.value)} inputMode="decimal" autoFocus
            className="w-full rounded border border-border bg-card px-2 py-1 text-right" />
          <span className="text-foreground/50">₽</span>
        </div>
      )}
      <div className="flex gap-1">
        <button onClick={save} disabled={saving}
          className="flex-1 rounded bg-primary px-2 py-1 text-primary-foreground inline-flex items-center justify-center gap-1" style={{ cursor: "pointer" }}>
          <Icon name={saving ? "Loader" : "Check"} size={12} className={saving ? "animate-spin" : ""} /> ОК
        </button>
        <button onClick={() => setEditing(false)}
          className="rounded border border-border px-2 py-1 text-foreground/50" style={{ cursor: "pointer" }}>Отмена</button>
      </div>
    </div>
  )
}
