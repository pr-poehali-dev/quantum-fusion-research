import { useState, useEffect, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"

interface FinType { id: number; name: string; direction: string; is_system: boolean; sort_order: number }
interface MarginBlock { count: number; total_margin: number; avg_margin: number; revenue: number }
interface Summary {
  stock: { purchase: number; sale: number }
  margin_pc: MarginBlock
  margin_parts: MarginBlock
  cash: number
  fin: { income: number; expense: number; collection: number; sales_cash: number }
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
  user: string | null
}

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽"
const fmtDate = (s: string) => {
  if (!s) return ""
  const d = new Date(s)
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
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

  const load = useCallback(async () => {
    setLoading(true)
    const [s, l, t] = await Promise.all([
      api.finance.getSummary(),
      api.finance.getLog(200, 0),
      api.finance.getTypes(),
    ])
    setSummary(s.summary || null)
    setLog(l.items || [])
    setTypes(t.types || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-foreground/50 mb-1 flex items-center gap-1"><Icon name="Banknote" size={14} /> Нал в кассе</div>
            <div className={`text-lg font-bold ${summary.cash >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(summary.cash)}</div>
            <div className="mt-1 text-xs text-foreground/50">
              передано в офис: {fmt(summary.fin.collection)}
            </div>
          </div>
        </div>
      )}

      {/* Лог движения средств */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-semibold flex items-center gap-2">
          <Icon name="ArrowLeftRight" size={16} /> Движение средств
        </div>
        {log.length === 0 ? (
          <div className="p-8 text-center text-foreground/40 text-sm">Пока нет операций</div>
        ) : (
          <div className="divide-y divide-border">
            {log.map(item => {
              const meta = KIND_META[item.kind]
              return (
                <div key={`${item.source}-${item.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
                  <div className={`shrink-0 ${meta.cls}`}><Icon name={meta.icon} size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{item.type_name || meta.label}</div>
                    <div className="text-xs text-foreground/40 truncate">{item.note} · {fmtDate(item.occurred_at)}{item.user ? ` · ${item.user}` : ""}</div>
                  </div>
                  <div className={`shrink-0 font-semibold tabular-nums ${meta.cls}`}>{meta.sign}{fmt(item.amount)}</div>
                  {item.source === "finance" && (
                    <button onClick={() => delTx(item.id)} className="shrink-0 text-foreground/30 hover:text-red-400">
                      <Icon name="X" size={15} />
                    </button>
                  )}
                </div>
              )
            })}
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
    </div>
  )
}
