import { useEffect, useState, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface SnRecord {
  id: number
  serial: string
  category: string | null
  product_name: string | null
  store_id: number | null
  store_name: string | null
  store_code: string | null
  purchase_date: string | null
  warranty_until: string | null
  status: string
  order_id: number | null
  note: string | null
  created_at: string
}

interface SnCategory {
  id: number
  category: string
  require_serial: boolean
}

interface Store {
  id: number
  name: string
  code: string
}

const STATUS_LABELS: Record<string, string> = {
  in_stock: "На складе",
  sold: "Продан",
  rma: "Гарантия",
}

export default function SnArchiveTab() {
  const [records, setRecords] = useState<SnRecord[]>([])
  const [cats, setCats] = useState<SnCategory[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)

  const [q, setQ] = useState("")
  const [filterCat, setFilterCat] = useState("")
  const [filterStore, setFilterStore] = useState("")
  const [filterStatus, setFilterStatus] = useState("")

  const [catModal, setCatModal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (q.trim()) params.q = q.trim()
    if (filterCat) params.category = filterCat
    if (filterStore) params.store_id = filterStore
    if (filterStatus) params.status = filterStatus
    const data = await api.snArchive.list(params)
    setLoading(false)
    if (!data.error) setRecords(data.serials || [])
  }, [q, filterCat, filterStore, filterStatus])

  const loadMeta = useCallback(async () => {
    const [c, s] = await Promise.all([
      api.snArchive.getCategories(),
      api.snArchive.getStores(),
    ])
    if (!c.error) setCats(c.categories || [])
    if (!s.error) setStores(s.stores || [])
  }, [])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => {
    const t = setTimeout(() => load(), 300)
    return () => clearTimeout(t)
  }, [load])

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить серийник из реестра?")) return
    await api.snArchive.deleteSerial(id)
    load()
  }

  return (
    <div className="space-y-4">
      {/* Шапка */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Архив серийных номеров</h2>
        <Badge variant="outline">{records.length}</Badge>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => { window.location.href = "/admin/warehouse" }}>
          <Icon name="Warehouse" size={14} className="mr-1.5" />На склад
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCatModal(true)}>
          <Icon name="Settings2" size={14} className="mr-1.5" />Категории учёта
        </Button>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <Input
            className="pl-9"
            placeholder="Поиск по серийнику или названию..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <select
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={filterCat} onChange={e => setFilterCat(e.target.value)}
        >
          <option value="">Все категории</option>
          {cats.map(c => <option key={c.id} value={c.category}>{c.category}</option>)}
        </select>
        <select
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={filterStore} onChange={e => setFilterStore(e.target.value)}
        >
          <option value="">Все магазины</option>
          {stores.map(s => <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>)}
        </select>
        <select
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="">Любой статус</option>
          <option value="in_stock">На складе</option>
          <option value="sold">Продан</option>
          <option value="rma">Гарантия</option>
        </select>
      </div>

      {/* Таблица */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-foreground/50">
              <th className="px-3 py-2 font-medium">Серийник</th>
              <th className="px-3 py-2 font-medium">Товар</th>
              <th className="px-3 py-2 font-medium">Категория</th>
              <th className="px-3 py-2 font-medium">Магазин</th>
              <th className="px-3 py-2 font-medium">Куплен</th>
              <th className="px-3 py-2 font-medium">Гарантия до</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-foreground/40">Загрузка...</td></tr>
            )}
            {!loading && records.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-foreground/40">Серийники не найдены</td></tr>
            )}
            {!loading && records.map(r => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2 font-mono font-medium">{r.serial}</td>
                <td className="px-3 py-2 text-foreground/70">{r.product_name || "—"}</td>
                <td className="px-3 py-2 text-foreground/60">{r.category || "—"}</td>
                <td className="px-3 py-2 text-foreground/70">
                  {r.store_name ? <><span className="font-mono text-foreground/40">[{r.store_code}]</span> {r.store_name}</> : "—"}
                </td>
                <td className="px-3 py-2 text-foreground/60">{r.purchase_date?.substring(0, 10) || "—"}</td>
                <td className="px-3 py-2 text-foreground/60">{r.warranty_until?.substring(0, 10) || "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant={r.status === "in_stock" ? "outline" : "secondary"}>
                    {STATUS_LABELS[r.status] || r.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => handleDelete(r.id)} title="Удалить">
                    <Icon name="Trash2" size={15} className="text-foreground/30 hover:text-red-500" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {catModal && (
        <CategoriesModal
          cats={cats}
          onClose={() => setCatModal(false)}
          onChanged={() => { loadMeta() }}
        />
      )}
    </div>
  )
}

// ─── Модалка настройки категорий учёта серийников ───
function CategoriesModal({ cats, onClose, onChanged }: {
  cats: SnCategory[]
  onClose: () => void
  onChanged: () => void
}) {
  const [whCats, setWhCats] = useState<string[]>([])
  const [adding, setAdding] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.warehouse.getCategories().then(d => {
      if (Array.isArray(d)) setWhCats(d.filter(Boolean))
    })
  }, [])

  const enabled = new Set(cats.map(c => c.category))
  const available = whCats.filter(c => !enabled.has(c))

  const add = async () => {
    if (!adding) return
    setLoading(true)
    await api.snArchive.addCategory({ category: adding, require_serial: true })
    setAdding("")
    setLoading(false)
    onChanged()
  }

  const remove = async (category: string) => {
    if (!confirm(`Убрать «${category}» из учёта серийников?`)) return
    await api.snArchive.removeCategory(category)
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Категории учёта серийников</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>
        <p className="mb-4 text-xs text-foreground/50">
          Для этих категорий при приёмке будет обязательный ввод серийных номеров с привязкой к магазину.
        </p>

        <div className="mb-4 space-y-2">
          {cats.length === 0 && <p className="text-sm text-foreground/40">Пока нет категорий</p>}
          {cats.map(c => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-sm">{c.category}</span>
              <button onClick={() => remove(c.category)} title="Убрать">
                <Icon name="Trash2" size={15} className="text-foreground/30 hover:text-red-500" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={adding} onChange={e => setAdding(e.target.value)}
          >
            <option value="">Выбрать категорию...</option>
            {available.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <Button size="sm" onClick={add} disabled={!adding || loading}>
            <Icon name="Plus" size={14} className="mr-1" />Добавить
          </Button>
        </div>
      </div>
    </div>
  )
}