import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"

interface Account { id: number; name: string; color: string; is_active: boolean; balance: number }
interface CashAccount { id: number; code: string; name: string; color: string; is_active: boolean; balance: number }

interface Props {
  orderId: number
  total: number
  defaultAmount?: number
  /** 'prepayment' — аванс, 'remaining' — остаток перед выдачей,
   *  'full' — полная оплата при выдаче (заказы комплектующих: аванса нет) */
  mode?: "prepayment" | "remaining" | "full"
  onClose: () => void
  /** Вызывается после успешного подтверждения. */
  onConfirmed: (amount: number, remaining: number) => void
}

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽"

export default function PrepaymentConfirmModal({ orderId, total, defaultAmount, mode = "prepayment", onClose, onConfirmed }: Props) {
  const isFull = mode === "full"
  const isRemaining = mode === "remaining" || isFull
  const init = isFull ? total : (defaultAmount ?? (isRemaining ? total : Math.round(total * 0.3)))
  const [amount, setAmount] = useState(String(init))
  // процент предоплаты (для режима prepayment). По умолчанию 30%.
  const initPct = total > 0 ? Math.round((init / total) * 100) : 30
  const [percent, setPercent] = useState(String(initPct))
  // dest: id денежного счёта (cash) ИЛИ "emp" для сотрудника
  const [dest, setDest] = useState<string>("")
  const [employeeId, setEmployeeId] = useState<number | "">("")
  const [accounts, setAccounts] = useState<Account[]>([])
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.finance.getCashAccounts().then(d => {
      const list: CashAccount[] = (d.accounts || []).filter((a: CashAccount) => a.is_active)
      setCashAccounts(list)
      if (list.length) setDest(String(list[0].id))
    }).catch(() => {})
    api.finance.getAccounts().then(d => setAccounts(d.accounts || [])).catch(() => {})
  }, [])

  const amt = parseFloat(amount.replace(",", ".")) || 0
  const remaining = Math.max(0, total - amt)
  const isEmp = dest === "emp"
  const canSave = amt > 0 && amt <= total && (isEmp ? employeeId !== "" : dest !== "")

  // Ввод процента → пересчёт суммы
  const onPercentChange = (v: string) => {
    setPercent(v)
    const p = parseFloat(v.replace(",", ".")) || 0
    setAmount(String(Math.round(total * p / 100)))
  }
  // Ввод суммы → пересчёт процента
  const onAmountChange = (v: string) => {
    setAmount(v)
    const a = parseFloat(v.replace(",", ".")) || 0
    setPercent(total > 0 ? String(Math.round(a / total * 100)) : "0")
  }

  const confirm = async () => {
    if (!canSave) return
    setSaving(true)
    const payload = {
      order_id: orderId,
      amount: amt,
      employee_id: isEmp ? Number(employeeId) : null,
      cash_account_id: isEmp ? null : Number(dest),
    }
    const res = isRemaining
      ? await api.finance.confirmRemaining(payload)
      : await api.finance.confirmPrepayment(payload)
    setSaving(false)
    if (res.error) { alert(res.error); return }
    onConfirmed(amt, remaining)
  }

  const title = isFull ? "Оплата заказа"
    : isRemaining ? "Оплата остатка" : "Подтвердите предоплату"
  const hint = isFull
    ? "Заказ оплачивается полностью при выдаче. Укажите счёт зачисления."
    : isRemaining
      ? "Перед выдачей примите оплату остатка по заказу и укажите счёт зачисления."
      : "Перед переводом в «Заказ» укажите сумму предоплаты и счёт зачисления."

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Icon name="BadgeRussianRuble" size={18} /> {title}</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        <p className="mb-4 text-sm text-foreground/50">
          {hint} Итог заказа: <span className="font-semibold text-foreground">{fmt(total)}</span>.
        </p>

        {isRemaining ? (
          <>
            <label className="mb-1 block text-xs text-foreground/50">Сумма оплаты, ₽</label>
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" autoFocus
              className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </>
        ) : (
          <>
            <label className="mb-1 block text-xs text-foreground/50">Предоплата</label>
            <div className="mb-1 flex items-stretch gap-2">
              {/* Процент: иконка + поле ввода */}
              <div className="flex items-center rounded-lg border border-border bg-background px-2 focus-within:border-primary">
                <Icon name="Percent" size={14} className="text-foreground/40" />
                <input value={percent} onChange={e => onPercentChange(e.target.value)} inputMode="decimal"
                  className="w-12 bg-transparent px-1 py-2 text-center text-sm focus:outline-none" />
              </div>
              <span className="flex items-center text-foreground/30">=</span>
              {/* Сумма */}
              <div className="flex flex-1 items-center rounded-lg border border-border bg-background px-3 focus-within:border-primary">
                <input value={amount} onChange={e => onAmountChange(e.target.value)} inputMode="decimal" autoFocus
                  className="w-full bg-transparent py-2 text-sm focus:outline-none" />
                <span className="text-sm text-foreground/40">₽</span>
              </div>
            </div>
          </>
        )}
        {(!isFull || remaining > 0) && (
          <p className="mb-4 text-xs text-foreground/40">
            {isRemaining ? "Остаток после оплаты" : "Остаток к доплате"}: {fmt(remaining)}
          </p>
        )}

        <label className="mb-1 block text-xs text-foreground/50">Счёт зачисления</label>
        <div className="mb-3 flex flex-wrap gap-2">
          {cashAccounts.map(c => (
            <button key={c.id} type="button" onClick={() => setDest(String(c.id))} style={{ cursor: "pointer" }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${dest === String(c.id) ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
              {c.name}
            </button>
          ))}
          <button type="button" onClick={() => setDest("emp")} style={{ cursor: "pointer" }}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${isEmp ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
            Счёт сотрудника
          </button>
        </div>

        {isEmp && (
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
            {saving ? "Сохранение…" : isFull ? "Принять оплату и выдать"
              : isRemaining ? "Принять оплату" : "Подтвердить и в «Заказ»"}
          </Button>
        </div>
      </div>
    </div>
  )
}