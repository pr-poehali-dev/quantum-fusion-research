import { useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Store, Group, InvItem, InventoryRecord, OverflowItem } from "./types"

// ─── Приёмка излишка инвентаризации (товар уже известен) ─────────────────────

function InventoryReceiveModal({ stores, item, onClose, onSaved }: {
  stores: Store[]
  item: { group_id: number; name: string; delta: number; cell: string }
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    store_id: "" as number | "",
    qty: String(item.delta),
    cost_price: "" as string,
    purchase_date: new Date().toISOString().substring(0, 10),
    has_vat: null as boolean | null,
    cell: item.cell || "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showErrors, setShowErrors] = useState(false)

  const qtyNum = parseInt(form.qty) || 0
  const costNum = parseFloat(form.cost_price) || 0
  const storeInvalid = form.store_id === "" || form.store_id == null
  const qtyInvalid = qtyNum <= 0
  const priceInvalid = costNum <= 0
  const vatInvalid = form.has_vat === null
  const canSave = !storeInvalid && !qtyInvalid && !priceInvalid && !vatInvalid

  const save = async () => {
    if (!canSave) { setShowErrors(true); return }
    setLoading(true); setError("")
    const data = await api.warehouse.createSupply({
      group_id: item.group_id,
      store_id: form.store_id || null,
      qty: qtyNum,
      price_with_vat: costNum,
      has_vat: form.has_vat,
      purchase_date: form.purchase_date,
      cell: form.cell || null,
    })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Приёмка товара</h2>
            <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
          </div>
          <p className="mt-0.5 text-xs text-foreground/40">Товар не был проведён на складе</p>
        </div>

        <div className="space-y-4 px-6 py-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-sm font-medium">{item.name}</p>
            <p className="mt-0.5 text-xs text-foreground/50">Найдено при инвентаризации: +{item.delta} шт.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/60">Магазин *</label>
            <select
              className={`w-full rounded-lg border bg-background px-3 py-2 text-sm ${showErrors && storeInvalid ? "border-red-500" : "border-border"}`}
              value={form.store_id}
              onChange={e => setForm(p => ({ ...p, store_id: e.target.value ? Number(e.target.value) : "" }))}
            >
              <option value="">Выбери магазин</option>
              {stores.map(s => <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground/60">Количество *</label>
              <Input type="number" min={1} value={form.qty}
                className={showErrors && qtyInvalid ? "border-red-500" : ""}
                onChange={e => setForm(p => ({ ...p, qty: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground/60">Цена закупки *</label>
              <Input type="number" min={0} placeholder="₽ за шт." value={form.cost_price}
                className={showErrors && priceInvalid ? "border-red-500" : ""}
                onChange={e => setForm(p => ({ ...p, cost_price: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/60">Цена с НДС? *</label>
            <div className="flex gap-2">
              <button onClick={() => setForm(p => ({ ...p, has_vat: true }))}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${form.has_vat === true ? "border-primary bg-primary text-primary-foreground" : showErrors && vatInvalid ? "border-red-500" : "border-border hover:border-primary/40"}`}>
                С НДС
              </button>
              <button onClick={() => setForm(p => ({ ...p, has_vat: false }))}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${form.has_vat === false ? "border-primary bg-primary text-primary-foreground" : showErrors && vatInvalid ? "border-red-500" : "border-border hover:border-primary/40"}`}>
                Без НДС
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground/60">Дата закупки</label>
              <Input type="date" value={form.purchase_date}
                onChange={e => setForm(p => ({ ...p, purchase_date: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground/60">Ячейка</label>
              <Input placeholder="Ячейка" value={form.cell}
                onChange={e => setForm(p => ({ ...p, cell: e.target.value }))} />
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="flex justify-between border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>Назад</Button>
          <Button onClick={save} disabled={loading}>
            {loading ? <><Icon name="Loader" size={14} className="mr-1.5 animate-spin" />Принимаю...</>
              : <><Icon name="Check" size={14} className="mr-1.5" />Принять</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Инвентаризация ────────────────────────────────────────────────────────────

export function InventoryModal({ categories, groups, stores, onClose, onApplied }: {
  categories: string[]
  groups: Group[]
  stores: Store[]
  onClose: () => void
  onApplied: () => void
}) {
  // Шаг 1 — выбор фильтров, Шаг 2 — заполнение, Шаг 3 — подтверждение, "history" — история
  const [step, setStep] = useState<1 | 2 | 3 | "history" | "receive">(1)
  const [selCells, setSelCells] = useState<string[]>([])
  const [selCats, setSelCats] = useState<string[]>([])
  const [inventoryId, setInventoryId] = useState<number | null>(null)
  const [items, setItems] = useState<InvItem[]>([])
  const [actuals, setActuals] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ name: string; delta: number }[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [historyList, setHistoryList] = useState<InventoryRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  // Приёмка излишков (пересорт «+»): открывается последовательно по каждой позиции
  const [overflowItems, setOverflowItems] = useState<OverflowItem[]>([])
  const [receiveIdx, setReceiveIdx] = useState<number | null>(null)
  const [receivedIdx, setReceivedIdx] = useState<Set<number>>(new Set())

  // Уникальные ячейки из текущих групп
  const allCells = Array.from(new Set(groups.map(g => g.cell).filter(Boolean))).sort()

  const openHistory = async () => {
    setStep("history")
    setHistoryLoading(true)
    const d = await api.warehouse.inventoryList()
    setHistoryList(d.inventories || [])
    setHistoryLoading(false)
  }

  const toggleCell = (c: string) => setSelCells(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c])
  const toggleCat = (c: string) => setSelCats(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c])

  const startInventory = async () => {
    if (!selCells.length && !selCats.length) { setError("Выберите хотя бы одну ячейку или категорию"); return }
    setError(""); setLoading(true)
    const d = await api.warehouse.inventoryCreate({ filter_cells: selCells, filter_cats: selCats })
    setLoading(false)
    if (d.error) { setError(d.error); return }
    setInventoryId(d.inventory_id)
    const initActuals: Record<number, string> = {}
    d.items.forEach((it: InvItem) => { initActuals[it.id] = it.qty_actual !== null ? String(it.qty_actual) : "" })
    setActuals(initActuals)
    setItems(d.items)
    setStep(2)
  }

  const saveItem = async (itemId: number) => {
    const val = actuals[itemId]
    const qty = val === "" ? null : parseInt(val)
    setSaving(p => ({ ...p, [itemId]: true }))
    await api.warehouse.inventoryUpdateItem({ item_id: itemId, qty_actual: qty })
    setSaving(p => ({ ...p, [itemId]: false }))
  }

  const applyInventory = async () => {
    if (!inventoryId) return
    setApplying(true)
    const d = await api.warehouse.inventoryApply(inventoryId)
    setApplying(false)
    if (d.error) { setError(d.error); return }
    setApplyResult(d.applied || [])
    onApplied()
    // Излишки (пересорт «+») требуют оформления приёмки — открываем окно
    // последовательно на каждую позицию. Иначе сразу показываем результат.
    const ovf: OverflowItem[] = d.overflow || []
    if (ovf.length > 0) {
      setOverflowItems(ovf)
      setReceivedIdx(new Set())
      setReceiveIdx(0)
      setStep("receive")
    } else {
      setStep(3)
    }
  }

  // Приёмка одной позиции-излишка завершена → зелёная подсветка + переход к следующей
  const onReceived = (idx: number) => {
    setReceivedIdx(prev => new Set(prev).add(idx))
    setReceiveIdx(null)
    onApplied()
  }

  const filledCount = items.filter(it => actuals[it.id] !== "").length
  const changedItems = items.filter(it => {
    const v = actuals[it.id]
    return v !== "" && parseInt(v) !== it.qty_expected
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl" style={{ maxHeight: "90vh" }} onClick={e => e.stopPropagation()}>

        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 className="text-lg font-semibold">
              {step === "history" ? "История инвентаризаций"
                : step === "receive" ? "Приёмка излишков"
                : "Инвентаризация"}
            </h2>
            <p className="text-xs text-foreground/40 mt-0.5">
              {step === 1 && "Шаг 1 из 3 — выбор позиций"}
              {step === 2 && `Шаг 2 из 3 — подсчёт (заполнено ${filledCount} из ${items.length})`}
              {step === 3 && "Шаг 3 из 3 — результат"}
              {step === "history" && "Все проведённые инвентаризации"}
              {step === "receive" && "Оформи поступление найденного товара"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {step !== "history" && (
              <button onClick={openHistory} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary/40 hover:text-foreground transition-colors">
                <Icon name="History" size={13} />История
              </button>
            )}
            {step === "history" && (
              <button onClick={() => setStep(1)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary/40 hover:text-foreground transition-colors">
                <Icon name="Plus" size={13} />Новая
              </button>
            )}
            <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
          </div>
        </div>

        {/* Контент */}
        <div className="flex-1 overflow-y-auto px-6 py-4">

          {/* ШАГ 1 — фильтры */}
          {step === 1 && (
            <div className="space-y-5">
              {allCells.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">По ячейкам</p>
                  <div className="flex flex-wrap gap-2">
                    {allCells.map(c => (
                      <button key={c} onClick={() => toggleCell(c)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${selCells.includes(c) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/40"}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {categories.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">По типам товаров</p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map(c => (
                      <button key={c} onClick={() => toggleCat(c)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${selCats.includes(c) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/40"}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* ШАГ 2 — заполнение */}
          {step === 2 && (
            <div className="space-y-2">
              {items.map(it => (
                <div key={it.id} className={`rounded-xl border px-4 py-3 ${actuals[it.id] !== "" && parseInt(actuals[it.id]) !== it.qty_expected ? "border-orange-400/40 bg-orange-400/5" : "border-border bg-background"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{it.name}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-foreground/40">
                        {it.category && <span>{it.category}</span>}
                        {it.cell && <><span>·</span><span className="font-mono">📦 {it.cell}</span></>}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-foreground/60">
                        <span>Числится на полке: <span className="font-semibold text-foreground">{it.qty_expected}</span></span>
                        {it.qty_reserved > 0 && <span title="Из них отложено под заказы (физически тоже лежит на полке — считать нужно всё)">в т.ч. резерв: <span className="text-orange-400 font-semibold">{it.qty_reserved}</span></span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        type="number" min={0}
                        placeholder="Факт"
                        className="w-24 text-center"
                        value={actuals[it.id] ?? ""}
                        onChange={e => setActuals(p => ({ ...p, [it.id]: e.target.value }))}
                        onBlur={() => saveItem(it.id)}
                      />
                      {saving[it.id] && <Icon name="Loader" size={12} className="animate-spin text-foreground/30" />}
                      {!saving[it.id] && actuals[it.id] !== "" && (
                        parseInt(actuals[it.id]) === it.qty_expected
                          ? <Icon name="Check" size={14} className="text-emerald-500" />
                          : <Icon name="AlertCircle" size={14} className="text-orange-400" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ИСТОРИЯ */}
          {step === "history" && (
            <div className="space-y-3">
              {historyLoading && (
                <div className="flex items-center justify-center gap-2 py-10 text-foreground/40 text-sm">
                  <Icon name="Loader" size={14} className="animate-spin" />Загружаю...
                </div>
              )}
              {!historyLoading && historyList.length === 0 && (
                <div className="py-10 text-center text-sm text-foreground/40">Инвентаризаций ещё не проводилось</div>
              )}
              {!historyLoading && historyList.map(inv => {
                const filters = [
                  ...(inv.filter_desc.cells || []),
                  ...(inv.filter_desc.cats || []),
                ].join(", ")
                const dt = inv.applied_at || inv.created_at
                const dateStr = dt ? new Date(dt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"
                return (
                  <details key={inv.id} className="group rounded-xl border border-border bg-background overflow-hidden">
                    <summary className="flex cursor-pointer items-center justify-between px-4 py-3 list-none hover:bg-muted transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${inv.status === "applied" ? "bg-emerald-500" : "bg-yellow-400"}`} />
                        <div>
                          <p className="text-sm font-medium">#{inv.id} — {filters || "весь склад"}</p>
                          <p className="text-xs text-foreground/40">{dateStr} · {inv.total_items} позиций</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {inv.status === "applied" && inv.changes_count > 0 && (
                          <span className="text-xs text-orange-400 font-medium">{inv.changes_count} изм.</span>
                        )}
                        {inv.status === "applied" && inv.changes_count === 0 && (
                          <span className="text-xs text-emerald-500">без изменений</span>
                        )}
                        {inv.status === "draft" && (
                          <span className="text-xs text-yellow-400">черновик</span>
                        )}
                        <Icon name="ChevronDown" size={14} className="text-foreground/30 transition-transform group-open:rotate-180" />
                      </div>
                    </summary>
                    {inv.applied_list.length > 0 && (
                      <div className="border-t border-border px-4 py-3 space-y-1.5">
                        {inv.applied_list.map((r, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-foreground/70">{r.name}</span>
                            <span className={`font-semibold ${r.delta > 0 ? "text-emerald-500" : "text-red-500"}`}>
                              {r.delta > 0 ? "+" : ""}{r.delta} шт.
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {inv.applied_list.length === 0 && inv.status === "applied" && (
                      <div className="border-t border-border px-4 py-3 text-xs text-foreground/40">Расхождений не было</div>
                    )}
                  </details>
                )
              })}
            </div>
          )}

          {/* ШАГ 3 — результат */}
          {step === 3 && applyResult && (
            <div className="space-y-3">
              {applyResult.length === 0 ? (
                <div className="py-8 text-center">
                  <Icon name="CheckCircle" size={40} className="mx-auto mb-3 text-emerald-500" />
                  <p className="font-medium">Расхождений нет</p>
                  <p className="text-sm text-foreground/40 mt-1">Фактическое количество совпало с учётным</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-foreground/60 mb-3">Скорректировано позиций: <span className="font-semibold text-foreground">{applyResult.length}</span></p>
                  {applyResult.map((r, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
                      <span className="text-sm">{r.name}</span>
                      <span className={`text-sm font-semibold ${r.delta > 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {r.delta > 0 ? "+" : ""}{r.delta} шт.
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ПРИЁМКА ИЗЛИШКОВ — товар найден при инвентаризации, но не проведён на складе */}
          {step === "receive" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-orange-400/30 bg-orange-400/5 px-4 py-3 text-sm">
                <p className="font-medium text-orange-400">Приёмка товара, не проведённого на складе</p>
                <p className="mt-0.5 text-xs text-foreground/50">
                  Излишки при инвентаризации нужно оформить как поступление. Прими каждую позицию.
                </p>
              </div>
              {overflowItems.map((o, i) => {
                const done = receivedIdx.has(i)
                return (
                  <div key={i} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${done ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-background"}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{o.name}</p>
                      {o.cell && <p className="mt-0.5 text-xs text-foreground/40 font-mono">📦 {o.cell}</p>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-sm font-semibold ${done ? "text-emerald-500" : "text-foreground/70"}`}>+{o.delta} шт.</span>
                      {done ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
                          <Icon name="Check" size={14} />принято
                        </span>
                      ) : (
                        <Button size="sm" onClick={() => setReceiveIdx(i)}>
                          <Icon name="PackagePlus" size={14} className="mr-1.5" />Принять
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Модалка приёмки конкретной позиции-излишка */}
        {receiveIdx !== null && overflowItems[receiveIdx] && (
          <InventoryReceiveModal
            stores={stores}
            item={overflowItems[receiveIdx]}
            onClose={() => setReceiveIdx(null)}
            onSaved={() => onReceived(receiveIdx)}
          />
        )}

        {/* Футер */}
        <div className="border-t border-border px-6 py-4 shrink-0 flex items-center justify-between gap-3">
          {step === "history" && (
            <div className="flex w-full justify-end">
              <Button variant="outline" onClick={onClose}>Закрыть</Button>
            </div>
          )}
          {step === 1 && (
            <>
              <span className="text-xs text-foreground/40">
                {selCells.length + selCats.length === 0 ? "Ничего не выбрано" : `Выбрано: ${[...selCells, ...selCats].join(", ")}`}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Отмена</Button>
                <Button onClick={startInventory} disabled={loading}>
                  {loading ? <><Icon name="Loader" size={14} className="mr-1.5 animate-spin" />Создаю...</> : "Начать →"}
                </Button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <span className="text-xs text-foreground/40">
                {changedItems.length > 0 ? `Расхождений: ${changedItems.length}` : filledCount === items.length ? "Всё заполнено" : `Не заполнено: ${items.length - filledCount}`}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>← Назад</Button>
                <Button onClick={() => setStep(3)} disabled={filledCount === 0}>
                  Проверить итог →
                </Button>
              </div>
            </>
          )}
          {step === 3 && !applyResult && (
            <div className="w-full space-y-3">
              {changedItems.length > 0 && (
                <div className="rounded-xl border border-orange-400/30 bg-orange-400/5 p-3">
                  <p className="text-sm font-medium text-orange-400 mb-2">Будет скорректировано {changedItems.length} позиций:</p>
                  <div className="space-y-1">
                    {changedItems.map(it => {
                      const actual = parseInt(actuals[it.id])
                      const delta = actual - it.qty_expected
                      return (
                        <div key={it.id} className="flex items-center justify-between text-sm">
                          <span className="text-foreground/70">{it.name}</span>
                          <span className={delta > 0 ? "text-emerald-500 font-medium" : "text-red-500 font-medium"}>
                            {delta > 0 ? "+" : ""}{delta} шт.
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>← Назад</Button>
                <Button onClick={applyInventory} disabled={applying}>
                  {applying
                    ? <><Icon name="Loader" size={14} className="mr-1.5 animate-spin" />Применяю...</>
                    : <><Icon name="CheckCircle" size={14} className="mr-1.5" />Применить инвентаризацию</>}
                </Button>
              </div>
            </div>
          )}
          {step === 3 && applyResult && (
            <div className="flex w-full justify-end">
              <Button onClick={onClose}>Закрыть</Button>
            </div>
          )}
          {step === "receive" && (
            <>
              <span className="text-xs text-foreground/40">
                Принято: {receivedIdx.size} из {overflowItems.length}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(3)}>← Назад</Button>
                <Button onClick={() => setStep(3)} disabled={receivedIdx.size < overflowItems.length}>
                  <Icon name="Check" size={14} className="mr-1.5" />Готово
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
