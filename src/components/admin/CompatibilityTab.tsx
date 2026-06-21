import { useState, useEffect, useMemo } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

// ── Типы ──────────────────────────────────────────────────────────────────
type Specs = Record<string, unknown>

interface SpecRow {
  product_id: number
  name: string
  category: string | null
  category_slug: string | null
  image_url: string | null
  component_type: string
  has_specs: boolean
  ready: boolean
  required: string[]
  specs: Specs
}

const TYPE_LABELS: Record<string, string> = {
  cpu: "Процессор",
  motherboard: "Материнская плата",
  ram: "Оперативная память",
  gpu: "Видеокарта",
  psu: "Блок питания",
  case: "Корпус",
  cooling: "Охлаждение",
  storage: "Накопитель",
  fan: "Вентилятор",
  other: "Прочее",
}

// Описание полей характеристик по типу компонента.
type FieldKind = "text" | "number" | "bool" | "select" | "multiselect"
interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  options?: string[]
  unit?: string
}

const SOCKETS = ["AM5", "AM4", "LGA1700", "LGA1851", "LGA1200", "sTR5", "sWRX8"]
const MEM_TYPES = ["DDR5", "DDR4"]
const FORM_FACTORS = ["ATX", "mATX", "Mini-ITX", "E-ATX"]
const PSU_FORMS = ["ATX", "SFX", "SFX-L"]
const POWER_CONNECTORS = ["8pin", "2x8pin", "3x8pin", "12VHPWR", "12V-2x6"]
const RADIATORS = ["120", "240", "280", "360", "420"]
const STORAGE_IF = ["M.2 NVMe", "M.2 SATA", "SATA"]

const FIELDS_BY_TYPE: Record<string, FieldDef[]> = {
  cpu: [
    { key: "socket", label: "Сокет", kind: "select", options: SOCKETS },
    { key: "mem_type", label: "Тип памяти", kind: "select", options: MEM_TYPES },
    { key: "tdp_watt", label: "TDP", kind: "number", unit: "Вт" },
    { key: "has_igpu", label: "Встроенная графика", kind: "bool" },
  ],
  motherboard: [
    { key: "socket", label: "Сокет", kind: "select", options: SOCKETS },
    { key: "chipset", label: "Чипсет", kind: "text" },
    { key: "form_factor", label: "Форм-фактор", kind: "select", options: FORM_FACTORS },
    { key: "mem_type", label: "Тип памяти", kind: "select", options: MEM_TYPES },
    { key: "mem_slots", label: "Слотов памяти", kind: "number" },
    { key: "m2_slots", label: "Слотов M.2", kind: "number" },
  ],
  ram: [
    { key: "mem_type", label: "Тип памяти", kind: "select", options: MEM_TYPES },
    { key: "ram_form", label: "Формат", kind: "select", options: ["DIMM", "SO-DIMM"] },
    { key: "ram_modules", label: "Кол-во планок", kind: "number" },
    { key: "ram_capacity_gb", label: "Объём комплекта", kind: "number", unit: "ГБ" },
    { key: "ram_freq", label: "Частота", kind: "number", unit: "МГц" },
  ],
  gpu: [
    { key: "gpu_length_mm", label: "Длина", kind: "number", unit: "мм" },
    { key: "tdp_watt", label: "Потребление (TGP)", kind: "number", unit: "Вт" },
    { key: "gpu_power_connector", label: "Разъём питания", kind: "select", options: POWER_CONNECTORS },
  ],
  psu: [
    { key: "psu_watt", label: "Мощность", kind: "number", unit: "Вт" },
    { key: "psu_form_factor", label: "Форм-фактор", kind: "select", options: PSU_FORMS },
    { key: "psu_connectors", label: "Разъёмы", kind: "multiselect", options: POWER_CONNECTORS },
  ],
  case: [
    { key: "case_form_factors", label: "Поддержка плат", kind: "multiselect", options: FORM_FACTORS },
    { key: "max_gpu_length_mm", label: "Макс. длина видеокарты", kind: "number", unit: "мм" },
    { key: "max_cooler_height_mm", label: "Макс. высота кулера", kind: "number", unit: "мм" },
    { key: "radiator_support", label: "Поддержка радиаторов", kind: "multiselect", options: RADIATORS },
    { key: "psu_form_factor", label: "Форм-фактор БП", kind: "select", options: PSU_FORMS },
  ],
  cooling: [
    { key: "cooler_sockets", label: "Поддерживаемые сокеты", kind: "multiselect", options: SOCKETS },
    { key: "cooler_type", label: "Тип", kind: "select", options: ["air", "aio"] },
    { key: "cooler_height_mm", label: "Высота (башня)", kind: "number", unit: "мм" },
    { key: "radiator_size", label: "Радиатор (СЖО)", kind: "select", options: RADIATORS },
    { key: "cooler_tdp_rating", label: "Рассеивание TDP", kind: "number", unit: "Вт" },
  ],
  storage: [
    { key: "storage_interface", label: "Интерфейс", kind: "select", options: STORAGE_IF },
  ],
  fan: [],
  other: [],
}

const FILTER_TYPES = ["all", "cpu", "motherboard", "ram", "gpu", "psu", "case", "cooling", "storage", "fan", "other"]

// ── Компонент ───────────────────────────────────────────────────────────────
export default function CompatibilityTab() {
  const [rows, setRows] = useState<SpecRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "ready">("all")
  const [editing, setEditing] = useState<SpecRow | null>(null)

  const load = () => {
    setLoading(true)
    api.warehouse.specsList().then((d: SpecRow[]) => {
      setRows(Array.isArray(d) ? d : [])
      setLoading(false)
    })
  }
  useEffect(load, [])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (typeFilter !== "all" && r.component_type !== typeFilter) return false
      if (statusFilter === "new" && r.ready) return false
      if (statusFilter === "ready" && !r.ready) return false
      if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [rows, typeFilter, statusFilter, search])

  const stats = useMemo(() => {
    const total = rows.length
    const ready = rows.filter(r => r.ready).length
    return { total, ready, neww: total - ready }
  }, [rows])

  const onSaved = (productId: number, ready: boolean, specs: Specs) => {
    setRows(rs => rs.map(r => r.product_id === productId ? { ...r, ready, has_specs: true, specs } : r))
    setEditing(null)
  }

  return (
    <div>
      {/* Заголовок + статистика */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Совместимость комплектующих</h2>
          <p className="mt-1 text-sm text-foreground/50">
            Характеристики для умного конфигуратора. Заполните данные у каждой железки —
            и она станет «готовой».
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-lg bg-muted px-3 py-1.5 text-foreground/70">Всего: <b>{stats.total}</b></span>
          <span className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-amber-500">Новые: <b>{stats.neww}</b></span>
          <span className="rounded-lg bg-green-500/10 px-3 py-1.5 text-green-500">Готовы: <b>{stats.ready}</b></span>
        </div>
      </div>

      {/* Фильтры */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-64 rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" style={{ cursor: "pointer" }}>
          {FILTER_TYPES.map(t => <option key={t} value={t}>{t === "all" ? "Все категории" : TYPE_LABELS[t]}</option>)}
        </select>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([["all", "Все"], ["new", "Новые"], ["ready", "Готовые"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setStatusFilter(k)}
              className={`px-3 py-2 text-sm transition-colors ${statusFilter === k ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        <button onClick={load} className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>
          <Icon name="RefreshCw" size={14} /> Обновить
        </button>
      </div>

      {/* Таблица */}
      {loading ? (
        <div className="py-20 text-center text-foreground/40">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-foreground/40">Ничего не найдено</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase text-foreground/50">
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium">Товар</th>
                <th className="px-4 py-3 font-medium">Тип</th>
                <th className="px-4 py-3 font-medium">Заполнено</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const reqFilled = r.required.filter(k => isFilled(r.specs[k])).length
                return (
                  <tr key={r.product_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      {r.ready ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500">
                          <Icon name="CircleCheck" size={12} /> Готов
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500">
                          <Icon name="CircleAlert" size={12} /> Новый
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.image_url
                          ? <img src={r.image_url} alt="" className="h-8 w-8 rounded object-cover" />
                          : <div className="flex h-8 w-8 items-center justify-center rounded bg-muted"><Icon name="Package" size={14} className="text-foreground/30" /></div>}
                        <span className="font-medium text-foreground">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground/60">{TYPE_LABELS[r.component_type] || r.component_type}</td>
                    <td className="px-4 py-3">
                      {r.required.length === 0 ? (
                        <span className="text-xs text-foreground/40">— не требуется</span>
                      ) : (
                        <span className={`text-xs ${reqFilled === r.required.length ? "text-green-500" : "text-foreground/50"}`}>
                          {reqFilled} / {r.required.length}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setEditing(r)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:border-primary hover:text-primary transition-colors"
                        style={{ cursor: "pointer" }}>
                        Заполнить
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <SpecEditor row={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  )
}

// ── Утилиты ──────────────────────────────────────────────────────────────────
function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === "string") return v.trim() !== ""
  return true
}

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === "string" && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : [] } catch { return [] }
  }
  return []
}

// ── Модальный редактор характеристик ─────────────────────────────────────────
function SpecEditor({ row, onClose, onSaved }:
  { row: SpecRow; onClose: () => void; onSaved: (pid: number, ready: boolean, specs: Specs) => void }) {
  const fields = FIELDS_BY_TYPE[row.component_type] || []
  const [form, setForm] = useState<Specs>(() => ({ ...row.specs }))
  const [saving, setSaving] = useState(false)

  const setVal = (key: string, val: unknown) => setForm(f => ({ ...f, [key]: val }))

  const toggleMulti = (key: string, opt: string) => {
    const cur = toArray(form[key])
    setVal(key, cur.includes(opt) ? cur.filter(x => x !== opt) : [...cur, opt])
  }

  const requiredKeys = FIELDS_BY_TYPE[row.component_type]?.map(f => f.key).filter(k => row.required.includes(k)) || row.required
  const allReqFilled = row.required.every(k => isFilled(form[k]))

  const save = async () => {
    setSaving(true)
    const payload: Specs = {}
    fields.forEach(f => {
      if (f.kind === "multiselect") payload[f.key] = toArray(form[f.key])
      else payload[f.key] = form[f.key] ?? null
    })
    const res = await api.warehouse.specsUpdate(row.product_id, payload)
    setSaving(false)
    if (res?.ok) onSaved(row.product_id, !!res.ready, { ...form, component_type: row.component_type })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">{row.name}</h3>
            <p className="text-sm text-foreground/50">{TYPE_LABELS[row.component_type] || row.component_type}</p>
          </div>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
            <Icon name="X" size={20} />
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="my-8 text-center text-sm text-foreground/40">
            Для этого типа характеристики совместимости не требуются — товар уже готов.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {fields.map(f => {
              const required = row.required.includes(f.key)
              return (
                <div key={f.key}>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/80">
                    {f.label}{f.unit ? `, ${f.unit}` : ""}
                    {required && <span className="ml-1 text-amber-500">*</span>}
                  </label>
                  {f.kind === "text" && (
                    <input value={(form[f.key] as string) ?? ""} onChange={e => setVal(f.key, e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  )}
                  {f.kind === "number" && (
                    <input type="number" value={(form[f.key] as number) ?? ""} onChange={e => setVal(f.key, e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  )}
                  {f.kind === "bool" && (
                    <div className="flex gap-2">
                      {[["Да", true], ["Нет", false]].map(([l, v]) => (
                        <button key={String(v)} onClick={() => setVal(f.key, v)}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${form[f.key] === v ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:text-foreground"}`}
                          style={{ cursor: "pointer" }}>{l as string}</button>
                      ))}
                    </div>
                  )}
                  {f.kind === "select" && (
                    <select value={(form[f.key] as string) ?? ""} onChange={e => setVal(f.key, e.target.value || null)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" style={{ cursor: "pointer" }}>
                      <option value="">— не выбрано —</option>
                      {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                  {f.kind === "multiselect" && (
                    <div className="flex flex-wrap gap-2">
                      {f.options?.map(o => {
                        const on = toArray(form[f.key]).includes(o)
                        return (
                          <button key={o} onClick={() => toggleMulti(f.key, o)}
                            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:text-foreground"}`}
                            style={{ cursor: "pointer" }}>{o}</button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <span className={`text-xs ${allReqFilled ? "text-green-500" : "text-amber-500"}`}>
            {requiredKeys.length === 0 ? "Готов" : allReqFilled ? "Все обязательные поля заполнены" : "Заполните обязательные поля (*)"}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>Отмена</button>
            <button onClick={save} disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50" style={{ cursor: "pointer" }}>
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
