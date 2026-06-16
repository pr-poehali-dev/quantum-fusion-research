import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"

interface Account { id: number; name: string; color: string; is_active: boolean; balance: number }

interface Props {
  orderId: number
  total: number
  defaultAmount?: number
  onClose: () => void
  /** Вызывается после успешного подтверждения. */
  onConfirmed: (amount: number, remaining: number) => void
}

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽"

export default function PrepaymentConfirmModal({ orderId, total, defaultAmount, onClose, onConfirmed }: Props) {
  const init = defaultAmount ?? Math.round(total * 0.3)
  const [amount, setAmount] = useState(String(init))
  const [dest, setDest] = useState<"cash" | "employee">("cash")
  const [employeeId, setEmployeeId] = useState<number | "">("")
  const [accounts, setAccounts] = useState<Account[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.finance.getAccounts().then(d => setAccounts(d.accounts || [])).catch(() => {})
  }, [])

  const amt = parseFloat(amount.replace(",", ".")) || 0
  const remaining = Math.max(0, total - amt)
  const canSave = amt > 0 && amt <= total && (dest === "cash" || employeeId !== "")

  const confirm = async () => {
    if (!canSave) return
    setSaving(true)
    const res = await api.finance.confirmPrepayment({
      order_id: orderId,
      amount: amt,
      employee_id: dest === "employee" ? Number(employeeId) : null,
    })
    setSaving(false)
    if (res.error) { alert(res.error); return }
    onConfirmed(amt, remaining)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Icon name="BadgeRussianRuble" size={18} /> Подтвердите предоплату</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        <p className="mb-4 text-sm text-foreground/50">
          Перед переводом в «Заказ» укажите сумму предоплаты и куда она поступила.
          Итог заказа: <span className="font-semibold text-foreground">{fmt(total)}</span>.
        </p>

        <label className="mb-1 block text-xs text-foreground/50">Сумма предоплаты, ₽</label>
        <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" autoFocus
          className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <p className="mb-4 text-xs text-foreground/40">Остаток к доплате: {fmt(remaining)}</p>

        <label className="mb-1 block text-xs text-foreground/50">Куда поступила предоплата</label>
        <div className="mb-3 flex gap-2">
          <button type="button" onClick={() => setDest("cash")} style={{ cursor: "pointer" }}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${dest === "cash" ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
            В кассу
          </button>
          <button type="button" onClick={() => setDest("employee")} style={{ cursor: "pointer" }}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${dest === "employee" ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
            На счёт сотрудника
          </button>
        </div>

        {dest === "employee" && (
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value ? Number(e.target.value) : "")}
            className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <option value="">Выберите сотрудника</option>
            {accounts.filter(a => a.is_active).map(a => (
              <option key={a.id} value={a.id}>{a.name} (баланс {fmt(a.balance)})</option>
            ))}
          </select>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={confirm} disabled={!canSave || saving}>
            {saving ? "Сохранение…" : "Подтвердить и в «Заказ»"}
          </Button>
        </div>
      </div>
    </div>
  )
}
