import React, { useEffect, useState, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

// ─── Типы ────────────────────────────────────────────────────────────────────

interface Store {
  id: number
  name: string
  code: string
  created_at: string
}

interface Supply {
  id: number
  group_id: number
  store_id: number | null
  store_name: string | null
  store_code: string | null
  qty: number
  qty_reserved: number
  cost_price: number
  cell: string | null
  purchase_date: string | null
  warranty_until: string | null
  created_at: string
}

interface PricePoint {
  price_retail: number
  avg_cost: number
  recorded_at: string
}

interface Group {
  id: number
  product_id: number | null
  name: string
  sku: string
  category: string | null
  part_number: string | null
  warranty_months: number
  price_retail: number
  price_opt1: number
  price_opt2: number
  url_site: string | null
  url_supplier: string | null
  is_archived: boolean
  created_at: string
  updated_at: string
  qty_total: number
  qty_reserved: number
  qty_negative: number
  avg_cost: number
  cell: string | null
  price_history: PricePoint[]
  supplies?: Supply[]
}

const fmt = (n: number) =>
  n ? n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽" : "—"

const fmtNum = (n: number) => (n ? n.toLocaleString("ru-RU") : "0")

// ─── PriceHistoryBadge ────────────────────────────────────────────────────────

function PriceHistoryBadge({ history, currentRetail, currentCost }: {
  history: PricePoint[]
  currentRetail: number
  currentCost: number
}) {
  if (!history.length) return <span className="text-foreground/30 text-xs">—</span>
  const oldest = history[0]
  const retailDelta = currentRetail - oldest.price_retail
  const costDelta = currentCost - oldest.avg_cost
  return (
    <div className="flex flex-col gap-0.5">
      {retailDelta !== 0 && (
        <span className={`flex items-center gap-0.5 text-xs font-medium ${retailDelta > 0 ? "text-emerald-500" : "text-red-500"}`}>
          <Icon name={retailDelta > 0 ? "TrendingUp" : "TrendingDown"} size={11} />
          {retailDelta > 0 ? "+" : ""}{retailDelta.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽
        </span>
      )}
      {costDelta !== 0 && (
        <span className={`flex items-center gap-0.5 text-xs ${costDelta > 0 ? "text-orange-400" : "text-sky-400"}`}>
          <Icon name={costDelta > 0 ? "ArrowUp" : "ArrowDown"} size={10} />
          {costDelta > 0 ? "+" : ""}{costDelta.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽ заход
        </span>
      )}
      {retailDelta === 0 && costDelta === 0 && (
        <span className="text-foreground/30 text-xs">= без изм.</span>
      )}
    </div>
  )
}

// ─── Модалка группы ──────────────────────────────────────────────────────────

function GroupModal({ group, stores, categories, onClose, onSaved }: {
  group: Partial<Group> | null
  stores: Store[]
  categories: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !group?.id
  const [form, setForm] = useState({
    name: group?.name || "",
    category: group?.category || "",
    part_number: group?.part_number || "",
    warranty_months: group?.warranty_months ?? 12,
    price_retail: group?.price_retail ?? 0,
    price_opt1: group?.price_opt1 ?? 0,
    price_opt2: group?.price_opt2 ?? 0,
    url_site: group?.url_site || "",
    url_supplier: group?.url_supplier || "",
    cell: group?.cell || "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    if (!form.name.trim()) { setError("Название обязательно"); return }
    setLoading(true)
    const data = isNew
      ? await api.warehouse.createGroup({ ...form })
      : await api.warehouse.updateGroup({ id: group!.id, ...form })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    onSaved()
    onClose()
  }

  const f = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }))
  const fNum = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [field]: parseFloat(e.target.value) || 0 }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isNew ? "Новая группа товара" : "Редактировать группу"}</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-foreground/50">Наименование *</label>
            <Input value={form.name} onChange={f("name")} placeholder="Intel Core i9-14900K" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Категория</label>
            <input
              list="group-categories"
              value={form.category}
              onChange={f("category")}
              placeholder="Выберите или введите..."
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <datalist id="group-categories">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Партнамбер</label>
            <Input value={form.part_number} onChange={f("part_number")} placeholder="BX8071514900K" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Ячейка</label>
            <Input value={form.cell} onChange={f("cell")} placeholder="A1-2" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Гарантия (мес.)</label>
            <Input type="number" value={form.warranty_months} onChange={fNum("warranty_months")} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Цена продажи</label>
            <Input type="number" value={form.price_retail} onChange={fNum("price_retail")} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Опт 1</label>
            <Input type="number" value={form.price_opt1} onChange={fNum("price_opt1")} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Опт 2</label>
            <Input type="number" value={form.price_opt2} onChange={fNum("price_opt2")} />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-foreground/50">Ссылка на сайте</label>
            <Input value={form.url_site} onChange={f("url_site")} placeholder="https://..." />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-foreground/50">Ссылка у поставщика</label>
            <Input value={form.url_supplier} onChange={f("url_supplier")} placeholder="https://..." />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={loading}>
            {loading ? "Сохранение..." : isNew ? "Создать" : "Сохранить"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Модалка поставки ─────────────────────────────────────────────────────────

function SupplyModal({ groupId, supply, stores, onClose, onSaved }: {
  groupId: number
  supply?: Supply | null
  stores: Store[]
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !supply?.id
  const [form, setForm] = useState({
    store_id: supply?.store_id ?? (stores[0]?.id || ""),
    qty: supply?.qty ?? 1,
    cost_price: supply?.cost_price ?? 0,
    purchase_date: supply?.purchase_date?.substring(0, 10) || new Date().toISOString().substring(0, 10),
    warranty_until: supply?.warranty_until?.substring(0, 10) || "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    setLoading(true)
    const data = isNew
      ? await api.warehouse.createSupply({ group_id: groupId, ...form })
      : await api.warehouse.updateSupply({ id: supply!.id, ...form })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    // Уведомление об отрицательном резерве
    if (data.negative_alerts?.length) {
      const msgs = data.negative_alerts.map((a: {product: string, reserved: number, orders: number[]}) =>
        `✓ ${a.product} (${a.reserved} шт.) → улетел в заказ${a.orders.length ? ` #${a.orders.join(', #')}` : ''}`
      ).join('\n')
      alert(`Товар из отрицательного резерва поставлен в резерв:\n\n${msgs}`)
    }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isNew ? "Новая поставка" : "Редактировать поставку"}</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-foreground/50">Магазин</label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={form.store_id}
              onChange={e => setForm(p => ({ ...p, store_id: parseInt(e.target.value) }))}
            >
              <option value="">— не указан —</option>
              {stores.map(s => <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Кол-во</label>
            <Input type="number" value={form.qty} onChange={e => setForm(p => ({ ...p, qty: parseInt(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Цена закупки</label>
            <Input type="number" value={form.cost_price} onChange={e => setForm(p => ({ ...p, cost_price: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-foreground/50">Дата покупки</label>
            <Input type="date" value={form.purchase_date} onChange={e => setForm(p => ({ ...p, purchase_date: e.target.value }))} />
          </div>

        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={loading}>{loading ? "Сохранение..." : isNew ? "Добавить" : "Сохранить"}</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Модалка магазинов ───────────────────────────────────────────────────────

function StoresModal({ stores, onClose, onSaved }: {
  stores: Store[]
  onClose: () => void
  onSaved: () => void
}) {
  const [newName, setNewName] = useState("")
  const [newCode, setNewCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const add = async () => {
    if (!newName.trim() || newCode.length !== 3) { setError("Название и ровно 3 цифры кода"); return }
    setLoading(true)
    const data = await api.warehouse.createStore({ name: newName.trim(), code: newCode })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    setNewName(""); setNewCode(""); setError("")
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Магазины</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        <div className="mb-4 space-y-1 max-h-48 overflow-y-auto">
          {stores.length === 0 && <p className="text-sm text-foreground/40">Нет магазинов</p>}
          {stores.map(s => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg bg-background px-3 py-2">
              <span className="font-mono text-xs text-foreground/50">[{s.code}]</span>
              <span className="text-sm">{s.name}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-xs text-foreground/50">Добавить магазин</p>
          <div className="flex gap-2">
            <Input className="w-20 font-mono" maxLength={3} value={newCode} onChange={e => setNewCode(e.target.value.replace(/\D/g, ""))} placeholder="001" />
            <Input className="flex-1" value={newName} onChange={e => setNewName(e.target.value)} placeholder="DNS" />
            <Button onClick={add} disabled={loading}>+</Button>
          </div>
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Строка группы с разворотом ──────────────────────────────────────────────

function GroupRow({ group, stores, onEdit, onArchive, onRefresh }: {
  group: Group
  stores: Store[]
  onEdit: (g: Group) => void
  onArchive: (g: Group) => void
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [supplyModal, setSupplyModal] = useState<Supply | null | "new">(null)
  const [detail, setDetail] = useState<Group | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [reservesModal, setReservesModal] = useState(false)

  const load = useCallback(async () => {
    if (!expanded) return
    setLoadingDetail(true)
    const data = await api.warehouse.getGroup(group.id)
    setLoadingDetail(false)
    if (!data.error) setDetail(data)
  }, [expanded, group.id])

  useEffect(() => { load() }, [load])

  const margin = group.price_retail && group.avg_cost
    ? group.price_retail - group.avg_cost : 0
  const marginPct = group.price_retail ? (margin / group.price_retail * 100) : 0

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} className="text-foreground/30 shrink-0" />
            <span className="font-medium text-sm">{group.name}</span>
          </div>
        </td>
        <td className="px-3 py-2.5">
          {group.category && <Badge variant="outline" className="text-xs">{group.category}</Badge>}
        </td>
        <td className="px-3 py-2.5 font-mono text-xs text-foreground/50">{group.sku}</td>
        <td className="px-3 py-2.5 text-xs text-foreground/50">{group.part_number || "—"}</td>
        <td className="px-3 py-2.5 text-center">
          <span className={`text-sm font-semibold ${group.qty_total - group.qty_reserved <= 0 ? "text-red-500" : "text-foreground"}`}>
            {fmtNum(group.qty_total)}
          </span>
        </td>
        <td className="px-3 py-2.5 text-center text-sm">
          {(group.qty_reserved > 0 || group.qty_negative > 0) ? (
            <button
              onClick={e => { e.stopPropagation(); setReservesModal(true) }}
              className="hover:opacity-70 transition-opacity cursor-pointer"
            >
              {group.qty_reserved > 0 && <span className="text-orange-400">{fmtNum(group.qty_reserved)}</span>}
              {group.qty_negative > 0 && <span className="text-red-400 ml-1">−{fmtNum(group.qty_negative)}</span>}
            </button>
          ) : (
            <span className="text-foreground/30">0</span>
          )}
          {reservesModal && (
            <ReservesModal group={group} onClose={() => setReservesModal(false)} />
          )}
        </td>
        <td className="px-3 py-2.5 text-xs text-foreground/50">{group.warranty_months} мес.</td>
        <td className="px-3 py-2.5 text-sm font-medium">{fmt(group.price_retail)}</td>
        <td className="px-3 py-2.5 text-xs font-mono text-foreground/60">{group.cell || "—"}</td>
        <td className="px-3 py-2.5 text-xs text-foreground/60">{fmt(group.price_opt1)}</td>
        <td className="px-3 py-2.5 text-xs text-foreground/60">{fmt(group.price_opt2)}</td>
        <td className="px-3 py-2.5 text-xs text-foreground/50">{fmt(group.avg_cost)}</td>
        <td className="px-3 py-2.5">
          {margin !== 0 && (
            <span className={`text-xs font-medium ${margin > 0 ? "text-emerald-500" : "text-red-500"}`}>
              {fmt(margin)} ({marginPct.toFixed(0)}%)
            </span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <PriceHistoryBadge history={group.price_history} currentRetail={group.price_retail} currentCost={group.avg_cost} />
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            {(group.url_site || group.product_id) && (
              <a
                href={group.url_site || `/product/${group.product_id}`}
                target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                className="text-foreground/30 hover:text-primary transition-colors"
                title="Карточка на сайте"
              >
                <Icon name="Globe" size={13} />
              </a>
            )}
            {group.url_supplier && (
              <a href={group.url_supplier} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                className="text-foreground/30 hover:text-foreground/70 transition-colors"
                title="У поставщика">
                <Icon name="ShoppingCart" size={13} />
              </a>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button className="rounded p-1 hover:bg-muted transition-colors" onClick={() => onEdit(group)}>
              <Icon name="Pencil" size={13} className="text-foreground/40" />
            </button>
            <button className="rounded p-1 hover:bg-muted transition-colors" onClick={() => setSupplyModal("new")}>
              <Icon name="PackagePlus" size={13} className="text-foreground/40" />
            </button>
            <button className="rounded p-1 hover:bg-muted transition-colors" onClick={() => onArchive(group)}>
              <Icon name="Archive" size={13} className="text-foreground/40" />
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={15} className="px-6 pb-3 pt-1">
            {loadingDetail && <p className="text-xs text-foreground/40 py-2">Загрузка...</p>}
            {detail && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs text-foreground/40 font-semibold uppercase tracking-wide">Поставки</p>
                  <button
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                    onClick={() => setSupplyModal("new")}
                  >
                    <Icon name="Plus" size={11} /> Добавить поставку
                  </button>
                </div>
                {detail.supplies?.length === 0 && (
                  <p className="text-xs text-foreground/30 py-1">Поставок нет</p>
                )}
                {detail.supplies && detail.supplies.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-foreground/40">
                        <th className="pb-1 text-left font-normal">Магазин</th>
                        <th className="pb-1 text-left font-normal">Дата</th>
                        <th className="pb-1 text-right font-normal">Кол-во</th>
                        <th className="pb-1 text-right font-normal">Резерв</th>
                        <th className="pb-1 text-right font-normal">Заход</th>
                        <th className="pb-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.supplies.map(s => (
                        <tr key={s.id} className="border-t border-border/30">
                          <td className="py-1">
                            {s.store_name
                              ? <><span className="font-mono text-foreground/40">[{s.store_code}]</span> {s.store_name}</>
                              : <span className="text-foreground/30">—</span>}
                          </td>
                          <td className="py-1 text-foreground/50">{s.purchase_date?.substring(0, 10) || "—"}</td>
                          <td className="py-1 text-right font-medium">{fmtNum(s.qty)}</td>
                          <td className="py-1 text-right text-orange-400">{fmtNum(s.qty_reserved)}</td>
                          <td className="py-1 text-right text-foreground/60">{fmt(s.cost_price)}</td>
                          <td className="py-1 text-right">
                            <button className="text-foreground/30 hover:text-foreground/70 transition-colors"
                              onClick={() => setSupplyModal(s)}>
                              <Icon name="Pencil" size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </td>
        </tr>
      )}

      {supplyModal !== null && (
        <SupplyModal
          groupId={group.id}
          supply={supplyModal === "new" ? null : supplyModal}
          stores={stores}
          onClose={() => setSupplyModal(null)}
          onSaved={() => { load(); onRefresh() }}
        />
      )}
    </>
  )
}

// ─── Главный компонент ───────────────────────────────────────────────────────

export default function WarehouseTab() {
  const [groups, setGroups] = useState<Group[]>([])
  const [total, setTotal] = useState(0)
  const [stores, setStores] = useState<Store[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState("")
  const [filterCat, setFilterCat] = useState("")
  const [page, setPage] = useState(0)
  const PAGE = 50

  // Фильтр просмотра резервов: null → 'all' → 'only' → 'negative' → null
  type ReserveFilter = null | 'all' | 'only' | 'negative'
  const [reserveFilter, setReserveFilter] = useState<ReserveFilter>(null)

  const RESERVE_FILTER_CYCLE: ReserveFilter[] = [null, 'all', 'only', 'negative']
  const RESERVE_FILTER_LABELS: Record<string, string> = {
    all: 'Все резервы',
    only: 'Только резервы',
    negative: 'Только отрицательные',
  }

  const cycleReserveFilter = () => {
    setReserveFilter(prev => {
      const idx = RESERVE_FILTER_CYCLE.indexOf(prev)
      return RESERVE_FILTER_CYCLE[(idx + 1) % RESERVE_FILTER_CYCLE.length]
    })
    setPage(0)
  }

  const [groupModal, setGroupModal] = useState<Partial<Group> | null | false>(false)
  const [storesModal, setStoresModal] = useState(false)
  const [quickSupplyModal, setQuickSupplyModal] = useState(false)
  const [inventoryModal, setInventoryModal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    // При активном фильтре резервов — грузим все товары (большой limit), пагинация не нужна
    const params: Record<string, string> = reserveFilter
      ? { limit: "9999", offset: "0" }
      : { limit: String(PAGE), offset: String(page * PAGE) }
    if (search) params.search = search
    if (filterCat) params.category = filterCat
    const [gData, sData, cData] = await Promise.all([
      api.warehouse.getGroups(params),
      api.warehouse.getStores(),
      api.warehouse.getCategories(),
    ])
    setLoading(false)
    if (!gData.error) { setGroups(gData.groups || []); setTotal(gData.total || 0) }
    if (!sData.error && Array.isArray(sData)) setStores(sData)
    if (!cData.error && Array.isArray(cData)) setCategories(cData)
  }, [search, filterCat, page, reserveFilter])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [search, filterCat])

  const handleArchive = async (g: Group) => {
    if (!confirm(`Архивировать «${g.name}»?`)) return
    await api.warehouse.archiveGroup(g.id)
    load()
  }

  const totalPages = Math.ceil(total / PAGE)

  // Применяем фильтр и сортировку резервов
  const displayGroups = (() => {
    if (!reserveFilter) return groups
    if (reserveFilter === 'only') {
      return [...groups].filter(g => g.qty_reserved > 0).sort((a, b) => b.qty_reserved - a.qty_reserved)
    }
    if (reserveFilter === 'negative') {
      return [...groups].filter(g => g.qty_negative > 0).sort((a, b) => b.qty_negative - a.qty_negative)
    }
    // 'all': сначала обычные резервы (без отрицательных), потом отрицательные
    const withReserve = groups.filter(g => g.qty_reserved > 0).sort((a, b) => b.qty_reserved - a.qty_reserved)
    const withNegative = groups.filter(g => g.qty_negative > 0).sort((a, b) => b.qty_negative - a.qty_negative)
    // убираем дубли: товары которые есть в обоих списках — только в negative
    const negativeIds = new Set(withNegative.map(g => g.id))
    const pureReserve = withReserve.filter(g => !negativeIds.has(g.id))
    return [...pureReserve, ...withNegative]
  })()

  return (
    <div className="space-y-4">
      {/* Шапка */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Склад</h2>
        <Badge variant="outline">{total} позиций</Badge>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setStoresModal(true)}>
          <Icon name="Store" size={14} className="mr-1.5" />Магазины
        </Button>
        <Button variant="outline" size="sm" onClick={() => setQuickSupplyModal(true)}>
          <Icon name="PackagePlus" size={14} className="mr-1.5" />Принять поставку
        </Button>
        <Button variant="outline" size="sm" onClick={() => setInventoryModal(true)}>
          <Icon name="ClipboardList" size={14} className="mr-1.5" />Инвентаризация
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={cycleReserveFilter}
          className={
            reserveFilter === 'negative'
              ? "border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-400"
              : reserveFilter === 'only'
              ? "border-orange-500/50 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 hover:text-orange-400"
              : reserveFilter === 'all'
              ? "border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-400"
              : ""
          }
        >
          <Icon
            name={reserveFilter === 'negative' ? "AlertTriangle" : "Layers"}
            size={14}
            className="mr-1.5"
          />
          {reserveFilter ? RESERVE_FILTER_LABELS[reserveFilter] : "Просмотр резервов"}
        </Button>
        <Button size="sm" onClick={() => setGroupModal({})}>
          <Icon name="Plus" size={14} className="mr-1.5" />Добавить товар
        </Button>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Icon name="Search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/30" />
          <Input
            className="pl-8 w-56"
            placeholder="Поиск по имени, артикулу..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
        >
          <option value="">Все категории</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Таблица */}
      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full min-w-[1200px]">
          <thead className="border-b border-border bg-muted/30">
            <tr className="text-xs text-foreground/50">
              <th className="px-3 py-2.5 text-left font-medium">Наименование</th>
              <th className="px-3 py-2.5 text-left font-medium">Тип</th>
              <th className="px-3 py-2.5 text-left font-medium">Артикул</th>
              <th className="px-3 py-2.5 text-left font-medium">Партнамбер</th>
              <th className="px-3 py-2.5 text-center font-medium">Кол-во</th>
              <th className="px-3 py-2.5 text-center font-medium">Резерв</th>
              <th className="px-3 py-2.5 text-left font-medium">Гарантия</th>
              <th className="px-3 py-2.5 text-left font-medium">Продажа</th>
              <th className="px-3 py-2.5 text-left font-medium">Ячейка</th>
              <th className="px-3 py-2.5 text-left font-medium">Опт 1</th>
              <th className="px-3 py-2.5 text-left font-medium">Опт 2</th>
              <th className="px-3 py-2.5 text-left font-medium">Заход ср.</th>
              <th className="px-3 py-2.5 text-left font-medium">Маржа</th>
              <th className="px-3 py-2.5 text-left font-medium">История цены</th>
              <th className="px-3 py-2.5 text-left font-medium">Ссылки</th>
              <th className="px-3 py-2.5 text-left font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={16} className="px-3 py-8 text-center text-sm text-foreground/40">Загрузка...</td></tr>
            )}
            {!loading && displayGroups.length === 0 && (
              <tr><td colSpan={16} className="px-3 py-12 text-center text-sm text-foreground/30">
                {reserveFilter
                  ? reserveFilter === 'negative'
                    ? "Отрицательных резервов нет"
                    : "Товаров с резервами нет"
                  : "Товаров нет. Добавьте первый через кнопку выше."}
              </td></tr>
            )}
            {!loading && (() => {
              if (reserveFilter === 'all') {
                const negativeIds = new Set(
                  groups.filter(g => g.qty_negative > 0).map(g => g.id)
                )
                const pureReserveCount = displayGroups.filter(g => !negativeIds.has(g.id)).length
                const rows: React.ReactNode[] = []
                if (pureReserveCount > 0) {
                  rows.push(
                    <tr key="divider-reserve">
                      <td colSpan={16} className="px-3 py-1.5 bg-orange-500/5 border-y border-orange-500/20">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-orange-400">
                          <Icon name="Layers" size={12} />
                          Резервы
                        </span>
                      </td>
                    </tr>
                  )
                }
                displayGroups.forEach((g, idx) => {
                  if (idx === pureReserveCount && displayGroups.length > pureReserveCount) {
                    rows.push(
                      <tr key="divider-negative">
                        <td colSpan={16} className="px-3 py-1.5 bg-red-500/5 border-y border-red-500/20">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                            <Icon name="AlertTriangle" size={12} />
                            Отрицательные резервы
                          </span>
                        </td>
                      </tr>
                    )
                  }
                  rows.push(
                    <GroupRow
                      key={g.id}
                      group={g}
                      stores={stores}
                      onEdit={gr => setGroupModal(gr)}
                      onArchive={handleArchive}
                      onRefresh={load}
                    />
                  )
                })
                return rows
              }
              return displayGroups.map(g => (
                <GroupRow
                  key={g.id}
                  group={g}
                  stores={stores}
                  onEdit={gr => setGroupModal(gr)}
                  onArchive={handleArchive}
                  onRefresh={load}
                />
              ))
            })()}
          </tbody>
        </table>
      </div>

      {/* Пагинация */}
      {totalPages > 1 && !reserveFilter && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            <Icon name="ChevronLeft" size={14} />
          </Button>
          <span className="text-sm text-foreground/60">{page + 1} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            <Icon name="ChevronRight" size={14} />
          </Button>
        </div>
      )}

      {/* Модалки */}
      {groupModal !== false && (
        <GroupModal
          group={groupModal}
          stores={stores}
          categories={categories}
          onClose={() => setGroupModal(false)}
          onSaved={load}
        />
      )}
      {storesModal && (
        <StoresModal
          stores={stores}
          onClose={() => setStoresModal(false)}
          onSaved={load}
        />
      )}
      {quickSupplyModal && (
        <QuickSupplyModal
          stores={stores}
          onClose={() => setQuickSupplyModal(false)}
          onSaved={load}
        />
      )}
      {inventoryModal && (
        <InventoryModal
          categories={categories}
          groups={groups}
          onClose={() => setInventoryModal(false)}
          onApplied={load}
        />
      )}
    </div>
  )
}

// ─── Модалка резервов по заказам ──────────────────────────────────────────────

function ReservesModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const [reserves, setReserves] = useState<{ order_id: number; qty: number; customer_name: string | null }[]>([])
  const [negReserves, setNegReserves] = useState<{ order_id: number; qty: number; customer_name: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.warehouse.getGroupReserves(group.id).then(d => {
      setReserves(d.reserves || [])
      setNegReserves(d.negative_reserves || [])
      setLoading(false)
    })
  }, [group.id])

  const OrderRow = ({ r, color }: { r: { order_id: number | null; qty: number; customer_name: string | null }; color: string }) => (
    <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
      {r.order_id ? (
        <a
          href={`/admin/orders?id=${r.order_id}`}
          onClick={e => e.stopPropagation()}
          className="text-sm font-mono font-semibold text-primary hover:underline"
        >
          #{String(r.order_id).padStart(4, "0")}
          {r.customer_name && <span className="font-sans font-normal text-foreground/60 ml-1.5">{r.customer_name}</span>}
        </a>
      ) : (
        <span className="text-sm text-foreground/50">Нет привязки к заказу</span>
      )}
      <span className={`text-sm font-semibold ${color}`}>{r.qty} шт.</span>
    </div>
  )

  const isEmpty = reserves.length === 0 && negReserves.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Резервы</h2>
            <p className="text-xs text-foreground/40 mt-0.5">{group.name}</p>
          </div>
          <button onClick={onClose} style={{ cursor: "pointer" }}><Icon name="X" size={16} className="text-foreground/40" /></button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-foreground/40 text-sm">
            <Icon name="Loader" size={14} className="animate-spin" />Загружаю...
          </div>
        ) : isEmpty ? (
          <p className="py-6 text-center text-sm text-foreground/40">Нет активных резервов</p>
        ) : (
          <div className="space-y-4">
            {/* Обычные резервы */}
            {reserves.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-400/80 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-orange-400 inline-block" />
                  В резерве — {reserves.reduce((s, r) => s + r.qty, 0)} шт.
                </p>
                <div className="space-y-1.5">
                  {reserves.map(r => <OrderRow key={r.order_id} r={r} color="text-orange-400" />)}
                </div>
              </div>
            )}

            {/* Отрицательные резервы (нехватка) */}
            {negReserves.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-400/80 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-400 inline-block" />
                  Нехватка — {negReserves.reduce((s, r) => s + r.qty, 0)} шт.
                </p>
                <div className="space-y-1.5">
                  {negReserves.map(r => (
                    <div key={r.order_id} className="flex items-center justify-between rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2.5">
                      <a
                        href={`/admin/orders?id=${r.order_id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-sm font-mono font-semibold text-primary hover:underline"
                      >
                        #{String(r.order_id).padStart(4, "0")}
                        {r.customer_name && <span className="font-sans font-normal text-foreground/60 ml-1.5">{r.customer_name}</span>}
                      </a>
                      <span className="text-sm font-semibold text-red-400">−{r.qty} шт.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Быстрая приёмка поставки ─────────────────────────────────────────────────

function QuickSupplyModal({ stores, onClose, onSaved }: {
  stores: Store[]
  onClose: () => void
  onSaved: () => void
}) {
  const [searchQ, setSearchQ] = useState("")
  const [searchResults, setSearchResults] = useState<Group[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [form, setForm] = useState({
    store_id: stores[0]?.id || "",
    qty: 1,
    cost_price: 0,
    purchase_date: new Date().toISOString().substring(0, 10),
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [alerts, setAlerts] = useState<{product: string, reserved: number, orders: number[]}[]>([])

  useEffect(() => {
    if (!searchQ || searchQ.length < 2) { setSearchResults([]); return }
    let cancelled = false
    setSearchLoading(true)
    api.warehouse.getGroups({ search: searchQ, limit: "10", offset: "0" })
      .then(d => { if (!cancelled) { setSearchResults(d.groups || []); setSearchLoading(false) } })
      .catch(() => { if (!cancelled) setSearchLoading(false) })
    return () => { cancelled = true }
  }, [searchQ])

  const save = async () => {
    if (!selectedGroup) return
    setLoading(true)
    setError("")
    const data = await api.warehouse.createSupply({
      group_id: selectedGroup.id,
      store_id: form.store_id || null,
      qty: form.qty,
      cost_price: form.cost_price,
      purchase_date: form.purchase_date,
    })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    if (data.negative_alerts?.length) {
      setAlerts(data.negative_alerts)
      return
    }
    onSaved()
    onClose()
  }

  if (alerts.length) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-400/15">
            <Icon name="Bell" size={18} className="text-yellow-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Товар из резерва</h2>
            <p className="text-xs text-foreground/50">Поставка принята, резерв перераспределён</p>
          </div>
        </div>
        <div className="space-y-2 mb-5">
          {alerts.map((a, i) => (
            <div key={i} className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-sm">
              <span className="text-yellow-400 font-medium">{a.product}</span>
              <span className="text-foreground/60"> — {a.reserved} шт. → </span>
              {a.orders.length ? <span className="text-foreground">заказ #{a.orders.join(', #')}</span> : <span className="text-foreground/40">заказы</span>}
            </div>
          ))}
        </div>
        <Button className="w-full" onClick={() => { onSaved(); onClose() }}>Понятно</Button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Принять поставку</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        {!selectedGroup ? (
          <div>
            <label className="mb-1.5 block text-xs text-foreground/50">Найдите товар</label>
            <Input
              autoFocus
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Название, артикул..."
            />
            {searchLoading && (
              <div className="flex items-center gap-2 py-4 text-foreground/40 text-sm">
                <Icon name="Loader" size={14} className="animate-spin" />Ищу...
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                {searchResults.map(g => (
                  <button key={g.id} onClick={() => setSelectedGroup(g)} style={{ cursor: "pointer" }}
                    className="w-full flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-sm hover:border-primary/40 hover:bg-muted transition-colors text-left">
                    <div>
                      <p className="font-medium">{g.name}</p>
                      <p className="text-xs text-foreground/40 font-mono">{g.sku} {g.category ? `· ${g.category}` : ""}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-bold text-primary">{g.price_retail ? g.price_retail.toLocaleString("ru-RU") + " ₽" : "—"}</p>
                      <p className="text-xs text-foreground/40">в наличии: {g.qty_total - g.qty_reserved}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searchQ.length >= 2 && !searchLoading && searchResults.length === 0 && (
              <p className="mt-3 text-center text-sm text-foreground/40">Ничего не найдено</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <div>
                <p className="font-medium text-sm">{selectedGroup.name}</p>
                <p className="text-xs text-foreground/40 font-mono">{selectedGroup.sku}</p>
              </div>
              <button onClick={() => setSelectedGroup(null)} style={{ cursor: "pointer" }}
                className="text-xs text-foreground/40 hover:text-foreground transition-colors">
                Изменить
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Кол-во *</label>
                <Input type="number" min={1} value={form.qty}
                  onChange={e => setForm(p => ({ ...p, qty: parseInt(e.target.value) || 1 }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Цена закупки</label>
                <Input type="number" value={form.cost_price}
                  onChange={e => setForm(p => ({ ...p, cost_price: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Магазин</label>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={form.store_id}
                  onChange={e => setForm(p => ({ ...p, store_id: parseInt(e.target.value) }))}>
                  <option value="">— не указан —</option>
                  {stores.map(s => <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Дата</label>
                <Input type="date" value={form.purchase_date}
                  onChange={e => setForm(p => ({ ...p, purchase_date: e.target.value }))} />
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>Отмена</Button>
              <Button onClick={save} disabled={loading}>
                <Icon name={loading ? "Loader" : "PackagePlus"} size={14} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Сохраняю..." : "Принять"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Инвентаризация ────────────────────────────────────────────────────────────

type InvItem = {
  id: number; group_id: number; name: string; category: string;
  cell: string; qty_expected: number; qty_reserved: number; qty_actual: number | null; note: string;
}

type InventoryRecord = {
  id: number
  filter_desc: { cells?: string[]; cats?: string[] }
  status: string
  total_items: number
  filled_items: number
  changes_count: number
  applied_list: { name: string; delta: number }[]
  applied_at: string | null
  created_at: string | null
}

function InventoryModal({ categories, groups, onClose, onApplied }: {
  categories: string[]
  groups: Group[]
  onClose: () => void
  onApplied: () => void
}) {
  // Шаг 1 — выбор фильтров, Шаг 2 — заполнение, Шаг 3 — подтверждение, "history" — история
  const [step, setStep] = useState<1 | 2 | 3 | "history">(1)
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
    setStep(3)
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
              {step === "history" ? "История инвентаризаций" : "Инвентаризация"}
            </h2>
            <p className="text-xs text-foreground/40 mt-0.5">
              {step === 1 && "Шаг 1 из 3 — выбор позиций"}
              {step === 2 && `Шаг 2 из 3 — подсчёт (заполнено ${filledCount} из ${items.length})`}
              {step === 3 && "Шаг 3 из 3 — результат"}
              {step === "history" && "Все проведённые инвентаризации"}
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
                        <span>Ожидается: <span className="font-semibold text-foreground">{it.qty_expected}</span></span>
                        {it.qty_reserved > 0 && <span>Резерв: <span className="text-orange-400 font-semibold">{it.qty_reserved}</span></span>}
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
        </div>

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
        </div>
      </div>
    </div>
  )
}