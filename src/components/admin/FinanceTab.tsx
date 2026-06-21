import { useState, useEffect, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { generateFinanceReport } from "@/lib/financeReport"

interface FinType { id: number; name: string; direction: string; is_system: boolean; sort_order: number }
interface Account { id: number; name: string; color: string; is_active: boolean; balance: number }
interface CashAccount { id: number; code: string; name: string; color: string; is_active: boolean; balance: number }
interface MarginBlock { count: number; total_margin: number; avg_margin: number; revenue: number }
interface Summary {
  stock: { purchase: number; sale: number }
  margin_pc: MarginBlock
  margin_parts: MarginBlock
  cash: number
  fin: { income: number; expense: number; collection: number }
  office?: { balance: number; income: number; expense: number; supply_expense: number; other_expense: number; transferred: number }
}
interface LogItem {
  source: "finance" | "sale"
  id: number
  kind: "income" | "expense" | "collection"
  amount: number
  note: string
  occurred_at: string
  affects_pnl: boolean
  type_name: string | null
  order_type?: string
  order_id?: number | null
  user: string | null
}

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽"
const fmtDate = (s: string) => {
  if (!s) return ""
  // Backend отдаёт время в UTC без таймзоны — помечаем как UTC и показываем по Москве
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z"
  const d = new Date(iso)
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })
}

const KIND_META: Record<string, { label: string; cls: string; sign: string; icon: string }> = {
  income:     { label: "Приход",     cls: "text-green-400", sign: "+", icon: "ArrowDownLeft" },
  expense:    { label: "Расход",     cls: "text-red-400",   sign: "−", icon: "ArrowUpRight" },
  collection: { label: "Инкассация", cls: "text-blue-400",  sign: "→", icon: "Building2" },
}

type ModalKind = null | "income" | "expense" | "collection" | "types"

export default function FinanceTab() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [log, setLog] = useState<LogItem[]>([])
  const [types, setTypes] = useState<FinType[]>([])
  const [modal, setModal] = useState<ModalKind>(null)
  const [detailPc, setDetailPc] = useState(false)
  const [detailParts, setDetailParts] = useState(false)

  // form
  const [amount, setAmount] = useState("")
  const [typeId, setTypeId] = useState<number | "">("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  // new type form
  const [newTypeName, setNewTypeName] = useState("")
  const [newTypeDir, setNewTypeDir] = useState<"income" | "expense">("expense")
  // счета сотрудников
  const [accounts, setAccounts] = useState<Account[]>([])
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [cashExpanded, setCashExpanded] = useState(false)
  // Отчёт PDF за период
  const [reportOpen, setReportOpen] = useState(false)
  // Пересчёт авто-расходов офиса
  const [recalcing, setRecalcing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [s, l, t, a, c] = await Promise.all([
      api.finance.getSummary(),
      api.finance.getLog(200, 0),
      api.finance.getTypes(),
      api.finance.getAccounts(),
      api.finance.getCashAccounts(),
    ])
    setSummary(s.summary || null)
    setLog(l.items || [])
    setTypes(t.types || [])
    setAccounts(a.accounts || [])
    setCashAccounts(c.accounts || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const recalcExpenses = async () => {
    setRecalcing(true)
    await api.finance.syncSupplyExpense()
    await load()
    setRecalcing(false)
  }

  const openModal = (k: ModalKind) => {
    setAmount(""); setNote(""); setTypeId("")
    setModal(k)
  }

  const submitTx = async () => {
    if (!modal || modal === "types") return
    const amt = parseFloat(amount.replace(",", "."))
    if (!amt || amt <= 0) return
    setSaving(true)
    await api.finance.addTx({
      kind: modal,
      amount: amt,
      type_id: typeId === "" ? null : typeId,
      note,
    })
    setSaving(false)
    setModal(null)
    load()
  }

  const delTx = async (id: number) => {
    if (!confirm("Удалить запись?")) return
    await api.finance.delTx(id)
    load()
  }

  const addType = async () => {
    if (!newTypeName.trim()) return
    await api.finance.addType({ name: newTypeName.trim(), direction: newTypeDir })
    setNewTypeName("")
    const t = await api.finance.getTypes()
    setTypes(t.types || [])
  }

  const delType = async (id: number) => {
    await api.finance.delType(id)
    const t = await api.finance.getTypes()
    setTypes(t.types || [])
  }

  const typesFor = (dir: string) => types.filter(t => t.direction === dir)

  if (loading) {
    return <div className="flex justify-center py-20 text-foreground/50"><Icon name="Loader2" className="animate-spin" size={28} /></div>
  }

  return (
    <div className="space-y-6">
      {/* Шапка */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Icon name="Wallet" size={26} /> Финансы</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openModal("expense")} variant="outline" className="border-red-500/40 text-red-400 hover:bg-red-500/10">
            <Icon name="Minus" size={16} className="mr-1" /> Добавить расход
          </Button>
          <Button onClick={() => openModal("income")} variant="outline" className="border-green-500/40 text-green-400 hover:bg-green-500/10">
            <Icon name="Plus" size={16} className="mr-1" /> Добавить приход
          </Button>
          <Button onClick={() => openModal("collection")} variant="outline" className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10">
            <Icon name="Building2" size={16} className="mr-1" /> Передать в офис
          </Button>
          <Button onClick={() => setModal("types")} variant="ghost" size="icon" title="Типы операций">
            <Icon name="Settings2" size={18} />
          </Button>
        </div>
      </div>

      {/* Сводка */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Склад */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-foreground/50 mb-1 flex items-center gap-1"><Icon name="Warehouse" size={14} /> Железо на складе</div>
            <div className="text-lg font-bold">{fmt(summary.stock.purchase)}</div>
            <div className="text-xs text-foreground/50">закупка</div>
            <div className="mt-1 text-sm text-green-400">{fmt(summary.stock.sale)} <span className="text-foreground/40">в продаже</span></div>
          </div>

          {/* Маржа ПК */}
          <button onClick={() => setDetailPc(v => !v)} className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors">
            <div className="text-xs text-foreground/50 mb-1 flex items-center gap-1"><Icon name="Monitor" size={14} /> Маржа ПК за месяц</div>
            <div className="text-lg font-bold text-green-400">{fmt(summary.margin_pc.total_margin)}</div>
            {detailPc ? (
              <div className="mt-1 text-xs text-foreground/60 space-y-0.5">
                <div>Заказов: {summary.margin_pc.count}</div>
                <div>Сред. маржа: {fmt(summary.margin_pc.avg_margin)}</div>
                <div>Выручка: {fmt(summary.margin_pc.revenue)}</div>
              </div>
            ) : <div className="text-xs text-foreground/40">нажми для деталей</div>}
          </button>

          {/* Маржа заказов */}
          <button onClick={() => setDetailParts(v => !v)} className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors">
            <div className="text-xs text-foreground/50 mb-1 flex items-center gap-1"><Icon name="Package" size={14} /> Маржа заказов за месяц</div>
            <div className="text-lg font-bold text-green-400">{fmt(summary.margin_parts.total_margin)}</div>
            {detailParts ? (
              <div className="mt-1 text-xs text-foreground/60 space-y-0.5">
                <div>Заказов: {summary.margin_parts.count}</div>
                <div>Сред. маржа: {fmt(summary.margin_parts.avg_margin)}</div>
                <div>Выручка: {fmt(summary.margin_parts.revenue)}</div>
              </div>
            ) : <div className="text-xs text-foreground/40">нажми для деталей</div>}
          </button>

          {/* Касса */}
          <button onClick={() => setCashExpanded(v => !v)} className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors">
            <div className="text-xs text-foreground/50 mb-1 flex items-center gap-1">
              <Icon name="Banknote" size={14} /> Нал в кассе
              <Icon name={cashExpanded ? "ChevronUp" : "ChevronDown"} size={13} className="ml-auto" />
            </div>
            <div className={`text-lg font-bold ${summary.cash >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(summary.cash)}</div>
            <div className="mt-1 text-xs text-foreground/50">
              счетов сотрудников: {accounts.length}
            </div>
          </button>
        </div>
      )}

      {/* Раскрытие кассы: денежные счета (касса/Авито/терминал) */}
      {cashExpanded && cashAccounts.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-semibold flex items-center gap-2">
            <Icon name="Wallet" size={16} /> Счета зачисления
          </div>
          <div className="divide-y divide-border">
            {cashAccounts.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="text-sm flex-1 truncate">{c.name}{!c.is_active && <span className="text-foreground/30 text-xs"> (неактивен)</span>}</span>
                <span className={`font-semibold tabular-nums ${c.balance >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(c.balance)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Раскрытие кассы: счета сотрудников */}
      {cashExpanded && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-semibold flex items-center gap-2">
            <Icon name="Users" size={16} /> Счета сотрудников
          </div>
          {accounts.length === 0 ? (
            <div className="p-6 text-center text-foreground/40 text-sm">Нет сотрудников. Создайте их в разделе «Расписание».</div>
          ) : (
            <div className="divide-y divide-border">
              {accounts.map(a => (
                <AccountRow key={a.id} account={a} onCredited={load} />
              ))}
            </div>
          )}
          {summary && (
            <div className="px-4 py-2 text-xs text-foreground/40 border-t border-border">
              Передано в офис (инкассация): {fmt(summary.fin.collection)}
            </div>
          )}
        </div>
      )}

      {/* Баланс офиса */}
      {summary?.office && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-semibold flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><Icon name="Building2" size={16} /> Баланс офиса</span>
            <Button variant="outline" size="sm" onClick={recalcExpenses} disabled={recalcing} title="Пересчитать расходы на закупку из поставок">
              <Icon name={recalcing ? "Loader" : "RefreshCw"} size={14} className={`mr-1.5 ${recalcing ? "animate-spin" : ""}`} /> Обновить расходы
            </Button>
          </div>
          <div className="p-4">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xs text-foreground/50 mb-0.5">Текущий баланс офиса</div>
                <div className={`text-2xl font-bold ${summary.office.balance >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {fmt(summary.office.balance)}
                </div>
                <div className="text-xs text-foreground/40 mt-0.5">приходы (инкассация + поступления) − расходы</div>
              </div>
              {/* Передано в другой офис (инкассация) */}
              <div className="rounded-xl border border-blue-400/30 bg-blue-400/5 px-4 py-3">
                <div className="text-[11px] text-foreground/50 flex items-center gap-1"><Icon name="Building2" size={12} className="text-blue-400" /> Передано в другой офис</div>
                <div className="text-xl font-bold text-blue-400">{fmt(summary.office.transferred)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-green-400/20 bg-green-400/5 p-3">
                <div className="text-[11px] text-foreground/50 flex items-center gap-1"><Icon name="ArrowDownLeft" size={12} className="text-green-400" /> Приходы</div>
                <div className="text-base font-bold text-green-400">{fmt(summary.office.income)}</div>
              </div>
              <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3">
                <div className="text-[11px] text-foreground/50 flex items-center gap-1"><Icon name="ArrowUpRight" size={12} className="text-red-400" /> Расходы</div>
                <div className="text-base font-bold text-red-400">{fmt(summary.office.expense)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-[11px] text-foreground/50 flex items-center gap-1"><Icon name="PackagePlus" size={12} /> Закупка товара</div>
                <div className="text-base font-bold text-foreground/80">{fmt(summary.office.supply_expense)}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-[11px] text-foreground/50 flex items-center gap-1"><Icon name="Receipt" size={12} /> Прочие расходы</div>
                <div className="text-base font-bold text-foreground/80">{fmt(summary.office.other_expense)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Лог движения средств */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-semibold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Icon name="ArrowLeftRight" size={16} /> Движение средств</span>
          <Button variant="outline" size="sm" onClick={() => setReportOpen(true)}>
            <Icon name="FileText" size={14} className="mr-1.5" /> Отчёт PDF
          </Button>
        </div>
        {log.length === 0 ? (
          <div className="p-8 text-center text-foreground/40 text-sm">Пока нет операций</div>
        ) : (
          <div className="divide-y divide-border">
            {log.map(item => (
              <LogRow key={`${item.source}-${item.id}`} item={item} onDelete={delTx} />
            ))}
          </div>
        )}
      </div>

      {/* Модалка транзакции */}
      {modal && modal !== "types" && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {modal === "income" ? "Добавить приход" : modal === "expense" ? "Добавить расход" : "Передать в офис (инкассация)"}
              </h3>
              <button onClick={() => setModal(null)}><Icon name="X" size={18} /></button>
            </div>

            {modal !== "collection" && (
              <div>
                <label className="text-xs text-foreground/50 mb-1 block">Тип</label>
                <select value={typeId} onChange={e => setTypeId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  <option value="">Без типа</option>
                  {typesFor(modal).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Сумма, ₽</label>
              <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" autoFocus />
            </div>

            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Комментарий</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="необязательно"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>

            {modal === "collection" && (
              <p className="text-xs text-blue-400/80">Инкассация уменьшает кассу, но не считается расходом компании.</p>
            )}

            <Button onClick={submitTx} disabled={saving || !amount} className="w-full">
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </div>
      )}

      {/* Модалка типов */}
      {modal === "types" && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Типы операций</h3>
              <button onClick={() => setModal(null)}><Icon name="X" size={18} /></button>
            </div>

            {(["expense", "income", "collection"] as const).map(dir => (
              <div key={dir}>
                <div className="text-xs text-foreground/50 mb-1">{dir === "expense" ? "Расходы" : dir === "income" ? "Приходы" : "Инкассация"}</div>
                <div className="space-y-1">
                  {typesFor(dir).map(t => (
                    <div key={t.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{t.name}</span>
                      {t.is_system ? <span className="text-[10px] text-foreground/30">системный</span>
                        : <button onClick={() => delType(t.id)} className="text-foreground/30 hover:text-red-400"><Icon name="Trash2" size={14} /></button>}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-xs text-foreground/50">Добавить тип</div>
              <input value={newTypeName} onChange={e => setNewTypeName(e.target.value)} placeholder="Название типа"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              <select value={newTypeDir} onChange={e => setNewTypeDir(e.target.value as "income" | "expense")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="expense">Расход</option>
                <option value="income">Приход</option>
              </select>
              <Button onClick={addType} disabled={!newTypeName.trim()} className="w-full" size="sm">Добавить</Button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка отчёта PDF за период */}
      {reportOpen && <ReportModal onClose={() => setReportOpen(false)} />}
    </div>
  )
}

// ─── Модалка: отчёт по движению средств за период (PDF) ──────────────────────
function ReportModal({ onClose }: { onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const [from, setFrom] = useState(monthAgo)
  const [to, setTo] = useState(today)
  const [loading, setLoading] = useState(false)

  const setPreset = (days: number) => {
    setTo(today)
    setFrom(new Date(Date.now() - (days - 1) * 24 * 3600 * 1000).toISOString().slice(0, 10))
  }
  const setThisMonth = () => {
    const d = new Date()
    setFrom(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10))
    setTo(today)
  }

  const generate = async () => {
    if (from > to) { alert("Дата начала позже даты конца"); return }
    setLoading(true)
    const res = await api.finance.getLog(5000, 0, from, to)
    setLoading(false)
    generateFinanceReport(res.items || [], from, to)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><Icon name="FileText" size={18} /> Отчёт за период</h3>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPreset(7)} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-muted" style={{ cursor: "pointer" }}>7 дней</button>
          <button onClick={() => setPreset(30)} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-muted" style={{ cursor: "pointer" }}>30 дней</button>
          <button onClick={setThisMonth} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-muted" style={{ cursor: "pointer" }}>Этот месяц</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-foreground/50">С</label>
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">По</label>
            <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
        </div>

        <p className="text-xs text-foreground/40">Откроется окно печати — выберите «Сохранить как PDF».</p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={generate} disabled={loading}>
            {loading ? <><Icon name="Loader" size={14} className="mr-1.5 animate-spin" /> Готовлю...</> : <><Icon name="Download" size={14} className="mr-1.5" /> Сформировать</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Строка лога движения средств (раскрытие длинного комментария) ───────────
function LogRow({ item, onDelete }: { item: LogItem; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false)
  const meta = KIND_META[item.kind]
  const note = item.note || ""
  const isLong = note.length > 80
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30">
      <div className={`shrink-0 mt-0.5 ${meta.cls}`}><Icon name={meta.icon} size={18} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">
          {item.type_name || meta.label}
          {item.order_id ? (
            <>
              {" "}
              <a href={`/admin/order/${item.order_id}`}
                className="text-primary hover:underline font-medium">
                заказ #{item.order_id}
              </a>
            </>
          ) : null}
        </div>
        <div className={`text-xs text-foreground/40 ${expanded ? "whitespace-pre-wrap break-words" : "truncate"}`}>
          {note}{note ? " · " : ""}{fmtDate(item.occurred_at)}{item.user ? ` · ${item.user}` : ""}
        </div>
        {isLong && (
          <button onClick={() => setExpanded(v => !v)}
            className="mt-0.5 flex items-center gap-0.5 text-[11px] text-primary hover:underline" style={{ cursor: "pointer" }}>
            {expanded ? "Свернуть" : "Показать полностью"}
            <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={12} />
          </button>
        )}
      </div>
      <div className={`shrink-0 mt-0.5 font-semibold tabular-nums ${meta.cls}`}>{meta.sign}{fmt(item.amount)}</div>
      {item.source === "finance" && (
        <button onClick={() => onDelete(item.id)} className="shrink-0 mt-0.5 text-foreground/30 hover:text-red-400">
          <Icon name="X" size={15} />
        </button>
      )}
    </div>
  )
}

// ─── Строка счёта сотрудника (раскрытие истории + зачисление) ────────────────
interface AcctLogItem { id: number; amount: number; note: string; order_id: number | null; created_at: string }
function AccountRow({ account, onCredited }: { account: Account; onCredited: () => void }) {
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState<AcctLogItem[]>([])
  const [loadingLog, setLoadingLog] = useState(false)
  const [crediting, setCrediting] = useState(false)
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && log.length === 0) {
      setLoadingLog(true)
      const d = await api.finance.getAccountLog(account.id)
      setLog(d.items || [])
      setLoadingLog(false)
    }
  }

  const credit = async (sign: 1 | -1) => {
    const a = (parseFloat(amount.replace(",", ".")) || 0) * sign
    if (!a) return
    setCrediting(true)
    await api.finance.creditAccount({ employee_id: account.id, amount: a, note: note || "Корректировка" })
    setCrediting(false)
    setAmount(""); setNote("")
    const d = await api.finance.getAccountLog(account.id)
    setLog(d.items || [])
    onCredited()
  }

  return (
    <div>
      <button onClick={toggle} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 text-left" style={{ cursor: "pointer" }}>
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: account.color }} />
        <span className="text-sm flex-1 truncate">{account.name}{!account.is_active && <span className="text-foreground/30 text-xs"> (неактивен)</span>}</span>
        <span className={`font-semibold tabular-nums ${account.balance >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(account.balance)}</span>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} className="text-foreground/40" />
      </button>
      {open && (
        <div className="bg-muted/20 px-4 py-3 space-y-3">
          {/* Зачисление / списание */}
          <div className="flex flex-wrap items-center gap-2">
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="Сумма"
              className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-right" />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Комментарий"
              className="flex-1 min-w-[120px] rounded-lg border border-border bg-background px-2 py-1.5 text-sm" />
            <Button size="sm" variant="outline" disabled={crediting || !amount} onClick={() => credit(1)}
              className="border-green-500/40 text-green-400 hover:bg-green-500/10">+ Зачислить</Button>
            <Button size="sm" variant="outline" disabled={crediting || !amount} onClick={() => credit(-1)}
              className="border-red-500/40 text-red-400 hover:bg-red-500/10">− Списать</Button>
          </div>
          {/* История */}
          {loadingLog ? (
            <div className="text-foreground/40 text-xs flex items-center gap-1"><Icon name="Loader2" size={13} className="animate-spin" /> Загрузка…</div>
          ) : log.length === 0 ? (
            <div className="text-foreground/30 text-xs">Операций пока нет</div>
          ) : (
            <div className="space-y-1">
              {log.map(it => (
                <div key={it.id} className="flex items-center gap-2 text-xs">
                  <span className={`font-semibold tabular-nums ${it.amount >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {it.amount >= 0 ? "+" : "−"}{fmt(Math.abs(it.amount))}
                  </span>
                  <span className="text-foreground/50 truncate flex-1">{it.note}</span>
                  <span className="text-foreground/30">{fmtDate(it.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}