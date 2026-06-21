import { useState, useEffect, useMemo } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { SpecSchema, SpecProduct, SpecAttribute } from "./types"
import { Modal, Field } from "./AttributesBuilder"

interface Props { schema: SpecSchema }

export default function ProductsValues({ schema }: Props) {
  const [rows, setRows] = useState<SpecProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [catFilter, setCatFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "ready">("all")
  const [editing, setEditing] = useState<SpecProduct | null>(null)

  const load = () => {
    setLoading(true)
    api.warehouse.specProducts().then((d: SpecProduct[]) => { setRows(Array.isArray(d) ? d : []); setLoading(false) })
  }
  useEffect(load, [])

  const filtered = useMemo(() => rows.filter(r => {
    if (catFilter !== "all" && r.spec_category_code !== catFilter) return false
    if (statusFilter === "new" && r.ready) return false
    if (statusFilter === "ready" && !r.ready) return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [rows, catFilter, statusFilter, search])

  const stats = useMemo(() => {
    const total = rows.length, ready = rows.filter(r => r.ready).length
    return { total, ready, neww: total - ready }
  }, [rows])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..."
            className="w-56 rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" style={{ cursor: "pointer" }}>
          <option value="all">Все категории</option>
          {schema.categories.map(c => <option key={c.id} value={c.code}>{c.name}</option>)}
        </select>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {([["all", "Все"], ["new", "Новые"], ["ready", "Готовые"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setStatusFilter(k)} className={`px-3 py-2 text-sm transition-colors ${statusFilter === k ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`} style={{ cursor: "pointer" }}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-amber-500">Новые: <b>{stats.neww}</b></span>
          <span className="rounded-lg bg-green-500/10 px-2.5 py-1 text-green-500">Готовы: <b>{stats.ready}</b></span>
          <button onClick={load} className="rounded-lg border border-border p-2 text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}><Icon name="RefreshCw" size={14} /></button>
        </div>
      </div>

      {loading ? <div className="py-20 text-center text-foreground/40">Загрузка...</div>
        : filtered.length === 0 ? <div className="py-20 text-center text-foreground/40">Ничего не найдено</div>
        : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase text-foreground/50">
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Товар</th>
                  <th className="px-4 py-3 font-medium">Категория</th>
                  <th className="px-4 py-3 font-medium">Заполнено</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.product_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      {!r.spec_category_id ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/40"><Icon name="Minus" size={11} /> Нет типа</span>
                      ) : r.ready ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-500"><Icon name="CircleCheck" size={12} /> Готов</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500"><Icon name="CircleAlert" size={12} /> Новый</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {r.image_url ? <img src={r.image_url} alt="" className="h-8 w-8 rounded object-cover" />
                          : <div className="flex h-8 w-8 items-center justify-center rounded bg-muted"><Icon name="Package" size={14} className="text-foreground/30" /></div>}
                        <span className="font-medium text-foreground">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground/60">{r.spec_category_name || r.category || "—"}</td>
                    <td className="px-4 py-3">
                      {!r.spec_category_id ? <span className="text-xs text-foreground/30">нет характеристик</span>
                        : r.required_total === 0 ? <span className="text-xs text-foreground/40">— не требуется</span>
                        : <span className={`text-xs ${r.required_done === r.required_total ? "text-green-500" : "text-foreground/50"}`}>{r.required_done} / {r.required_total} обяз.</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setEditing(r)} disabled={!r.spec_category_id}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 hover:border-primary hover:text-primary disabled:opacity-40" style={{ cursor: r.spec_category_id ? "pointer" : "not-allowed" }}>
                        Заполнить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {editing && <ValuesEditor row={editing} schema={schema} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

// ── Динамический редактор значений товара ────────────────────────────────────
function ValuesEditor({ row, schema, onClose, onSaved }:
  { row: SpecProduct; schema: SpecSchema; onClose: () => void; onSaved: () => void }) {
  const attrs = schema.attributes.filter(a => a.category_id === row.spec_category_id).sort((a, b) => a.sort_order - b.sort_order)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.warehouse.specValuesGet(row.product_id).then(d => { setValues(d.values || {}); setLoading(false) })
  }, [row.product_id])

  const setVal = (aid: number, v: unknown) => setValues(s => ({ ...s, [aid]: v }))
  const toArr = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : []

  const save = async () => {
    setSaving(true)
    await api.warehouse.specValuesSave(row.product_id, values)
    setSaving(false)
    onSaved()
  }

  return (
    <Modal title={row.name} onClose={onClose}>
      <p className="-mt-2 text-sm text-foreground/50">{row.spec_category_name}</p>
      {loading ? <div className="py-8 text-center text-foreground/40">Загрузка...</div>
        : attrs.length === 0 ? <p className="py-8 text-center text-sm text-foreground/40">Для этой категории нет характеристик.</p>
        : attrs.map(a => <ValueField key={a.id} attr={a} value={values[a.id]} setVal={setVal} toArr={toArr} />)}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>Отмена</button>
        <button onClick={save} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50" style={{ cursor: "pointer" }}>{saving ? "Сохранение..." : "Сохранить"}</button>
      </div>
    </Modal>
  )
}

function ValueField({ attr, value, setVal, toArr }:
  { attr: SpecAttribute; value: unknown; setVal: (aid: number, v: unknown) => void; toArr: (v: unknown) => string[] }) {
  const inp = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
  return (
    <Field label={`${attr.name}${attr.unit ? `, ${attr.unit}` : ""}${attr.is_required ? " *" : ""}${attr.affects_compat ? " 🔗" : ""}`}>
      {attr.field_type === "text" && <input value={(value as string) ?? ""} onChange={e => setVal(attr.id, e.target.value)} className={inp} />}
      {attr.field_type === "number" && <input type="number" value={(value as number) ?? ""} onChange={e => setVal(attr.id, e.target.value)} className={inp} />}
      {attr.field_type === "bool" && (
        <div className="flex gap-2">
          {[["Да", "true"], ["Нет", "false"]].map(([l, v]) => (
            <button key={v} onClick={() => setVal(attr.id, v)} className={`flex-1 rounded-lg border px-3 py-2 text-sm ${String(value) === v ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60"}`} style={{ cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      )}
      {attr.field_type === "select" && (
        <select value={(value as string) ?? ""} onChange={e => setVal(attr.id, e.target.value)} className={inp} style={{ cursor: "pointer" }}>
          <option value="">— не выбрано —</option>
          {attr.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {attr.field_type === "multiselect" && (
        <div className="flex flex-wrap gap-2">
          {attr.options.map(o => {
            const on = toArr(value).includes(o)
            return <button key={o} onClick={() => { const cur = toArr(value); setVal(attr.id, on ? cur.filter(x => x !== o) : [...cur, o]) }}
              className={`rounded-lg border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60"}`} style={{ cursor: "pointer" }}>{o}</button>
          })}
        </div>
      )}
    </Field>
  )
}
