import { useEffect, useState, useCallback } from "react"
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

function GroupModal({ group, stores, onClose, onSaved }: {
  group: Partial<Group> | null
  stores: Store[]
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
            <Input value={form.category} onChange={f("category")} placeholder="CPU" />
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
        <td className="px-3 py-2.5 text-center text-sm text-orange-400">{fmtNum(group.qty_reserved)}</td>
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

  const [groupModal, setGroupModal] = useState<Partial<Group> | null | false>(false)
  const [storesModal, setStoresModal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params: Record<string, string> = { limit: String(PAGE), offset: String(page * PAGE) }
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
  }, [search, filterCat, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [search, filterCat])

  const handleArchive = async (g: Group) => {
    if (!confirm(`Архивировать «${g.name}»?`)) return
    await api.warehouse.archiveGroup(g.id)
    load()
  }

  const totalPages = Math.ceil(total / PAGE)

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
            {!loading && groups.length === 0 && (
              <tr><td colSpan={16} className="px-3 py-12 text-center text-sm text-foreground/30">
                Товаров нет. Добавьте первый через кнопку выше.
              </td></tr>
            )}
            {!loading && groups.map(g => (
              <GroupRow
                key={g.id}
                group={g}
                stores={stores}
                onEdit={gr => setGroupModal(gr)}
                onArchive={handleArchive}
                onRefresh={load}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Пагинация */}
      {totalPages > 1 && (
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
    </div>
  )
}