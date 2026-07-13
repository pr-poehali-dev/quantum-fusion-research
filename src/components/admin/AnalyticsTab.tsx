import { useState, useEffect, useCallback } from "react"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"
import SalesReport from "./analytics/SalesReport"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts"

type Group = { id: number; name: string; color: string; sort_order: number }
type Source = {
  id: number; group_id: number | null; name: string; utm_source: string | null
  utm_medium: string | null; is_paid: boolean; is_active: boolean; sort_order: number
  group_name: string | null; group_color: string | null
}
type Budget = {
  id: number; group_id: number; period_month: string; amount: number
  leads_manual: number | null; note: string | null; group_name: string; group_color: string
}
type GroupRow = {
  group_id: number; group_name: string; color: string; orders: number; done: number
  revenue: number; quiz_leads: number; budget: number; leads: number
  cpl: number | null; cac: number | null; romi: number | null
}
type SourceRow = {
  source_id: number; source_name: string; group_id: number; group_name: string
  color: string; orders: number; done: number; revenue: number
}
type Analytics = {
  period: { from: string; to: string }
  by_source: SourceRow[]
  by_group: GroupRow[]
  timeline: { date: string; orders: number; revenue: number }[]
  totals: { budget: number; revenue: number; orders: number; romi: number | null }
}

const INPUT_CLS = "w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none"

const money = (n: number) => n.toLocaleString("ru-RU") + " ₽"
const monthStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`

function periodFromMonth(m: string): { from: string; to: string } {
  const [y, mo] = m.split("-").map(Number)
  const from = `${y}-${String(mo).padStart(2, "0")}-01`
  const nextY = mo === 12 ? y + 1 : y
  const nextMo = mo === 12 ? 1 : mo + 1
  const to = `${nextY}-${String(nextMo).padStart(2, "0")}-01`
  return { from, to }
}

export default function AnalyticsTab() {
  const [sub, setSub] = useState<"dashboard" | "sales" | "sources" | "budgets">("dashboard")
  const [month, setMonth] = useState(monthStr(new Date()))

  return (
    <div style={{ padding: "24px 40px 48px" }}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Icon name="ChartColumnBig" size={24} /> Аналитика привлечения
        </h1>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {([["dashboard", "Дашборд"], ["sales", "Отчёт продаж"], ["sources", "Источники"], ["budgets", "Бюджеты"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSub(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${sub === k ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>

      {sub === "dashboard" && <Dashboard month={month} setMonth={setMonth} />}
      {sub === "sales" && <SalesReport />}
      {sub === "sources" && <SourcesManager />}
      {sub === "budgets" && <BudgetsManager month={month} setMonth={setMonth} />}
    </div>
  )
}

// ─────────────── ДАШБОРД ───────────────
function Dashboard({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { from, to } = periodFromMonth(month)
    const d = await api.marketing.analytics(from, to).catch(() => null)
    setData(d)
    setLoading(false)
  }, [month])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="text-foreground/40 py-12 text-center">Загрузка…</div>
  if (!data) return <div className="text-foreground/40 py-12 text-center">Нет данных</div>

  const t = data.totals
  const pieData = data.by_group.filter(g => g.revenue > 0).map(g => ({ name: g.group_name, value: g.revenue, color: g.color }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <label className="text-sm text-foreground/60">Месяц:</label>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm" style={{ cursor: "text" }} />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Выручка" value={money(t.revenue)} icon="Banknote" color="text-green-400" />
        <Kpi label="Рекл. бюджет" value={money(t.budget)} icon="Megaphone" color="text-red-400" />
        <Kpi label="Заказов" value={String(t.orders)} icon="ClipboardList" color="text-blue-400" />
        <Kpi label="ROMI" value={t.romi != null ? `${t.romi}%` : "—"} icon="TrendingUp"
          color={t.romi != null && t.romi >= 0 ? "text-green-400" : "text-red-400"} />
      </div>

      {/* Графики */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium mb-3">Выручка по каналам</p>
          {pieData.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => money(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-foreground/30 text-sm py-16 text-center">Нет выручки за период</p>}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium mb-3">Динамика заказов</p>
          {data.timeline.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(8)} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="text-foreground/30 text-sm py-16 text-center">Нет заказов за период</p>}
        </div>
      </div>

      {/* Таблица по группам */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <p className="text-sm font-medium px-4 py-3 border-b border-border">Эффективность каналов</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-foreground/50 text-xs border-b border-border">
                <th className="text-left px-4 py-2">Группа</th>
                <th className="text-right px-4 py-2">Заказов</th>
                <th className="text-right px-4 py-2">Выдано</th>
                <th className="text-right px-4 py-2">Выручка</th>
                <th className="text-right px-4 py-2">Бюджет</th>
                <th className="text-right px-4 py-2" title="Лиды">Лиды</th>
                <th className="text-right px-4 py-2" title="Цена за лид">CPL</th>
                <th className="text-right px-4 py-2" title="Цена привлечения покупателя">CAC</th>
                <th className="text-right px-4 py-2" title="Окупаемость рекламы">ROMI</th>
              </tr>
            </thead>
            <tbody>
              {data.by_group.map(g => (
                <tr key={g.group_id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2 flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: g.color }} />
                    {g.group_name}
                  </td>
                  <td className="text-right px-4 py-2">{g.orders}</td>
                  <td className="text-right px-4 py-2 text-green-400">{g.done}</td>
                  <td className="text-right px-4 py-2 font-medium">{money(g.revenue)}</td>
                  <td className="text-right px-4 py-2 text-red-400">{g.budget ? money(g.budget) : "—"}</td>
                  <td className="text-right px-4 py-2">{g.leads || "—"}</td>
                  <td className="text-right px-4 py-2">{g.cpl != null ? money(g.cpl) : "—"}</td>
                  <td className="text-right px-4 py-2">{g.cac != null ? money(g.cac) : "—"}</td>
                  <td className={`text-right px-4 py-2 font-medium ${g.romi == null ? "text-foreground/30" : g.romi >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {g.romi != null ? `${g.romi}%` : "—"}
                  </td>
                </tr>
              ))}
              {!data.by_group.length && (
                <tr><td colSpan={9} className="text-center text-foreground/30 py-8">Нет заказов с источником за период</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Разбивка по источникам */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-medium mb-3">Топ источников по выручке</p>
        {data.by_source.length ? (
          <ResponsiveContainer width="100%" height={Math.max(200, data.by_source.length * 36)}>
            <BarChart data={data.by_source} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="source_name" tick={{ fontSize: 11 }} width={140} />
              <Tooltip formatter={(v: number) => money(v)} />
              <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                {data.by_source.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="text-foreground/30 text-sm py-12 text-center">Нет данных</p>}
      </div>
    </div>
  )
}

function Kpi({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-foreground/50 text-xs mb-1">
        <Icon name={icon} size={14} className={color} /> {label}
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

// ─────────────── ИСТОЧНИКИ И ГРУППЫ ───────────────
function SourcesManager() {
  const [groups, setGroups] = useState<Group[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [editSrc, setEditSrc] = useState<Partial<Source> | null>(null)
  const [editGrp, setEditGrp] = useState<Partial<Group> | null>(null)

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([api.marketing.getGroups(), api.marketing.getSources()])
    setGroups(g?.groups || [])
    setSources(s?.sources || [])
  }, [])
  useEffect(() => { load() }, [load])

  const saveSource = async () => {
    if (!editSrc?.name?.trim()) return
    await api.marketing.saveSource({
      id: editSrc.id, group_id: editSrc.group_id ?? null, name: editSrc.name.trim(),
      utm_source: editSrc.utm_source || undefined, utm_medium: editSrc.utm_medium || undefined,
      is_paid: !!editSrc.is_paid, is_active: editSrc.is_active !== false, sort_order: editSrc.sort_order || 0,
    })
    setEditSrc(null); await load()
  }
  const saveGroup = async () => {
    if (!editGrp?.name?.trim()) return
    await api.marketing.saveGroup({ id: editGrp.id, name: editGrp.name.trim(), color: editGrp.color || "#64748b", sort_order: editGrp.sort_order || 0 })
    setEditGrp(null); await load()
  }

  return (
    <div className="space-y-6">
      {/* Группы */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium">Группы источников</p>
          <button onClick={() => setEditGrp({ color: "#64748b" })}
            className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={12} /> Группа
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {groups.map(g => (
            <button key={g.id} onClick={() => setEditGrp(g)}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary" style={{ cursor: "pointer" }}>
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: g.color }} />
              {g.name}
            </button>
          ))}
        </div>
      </div>

      {/* Источники */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-medium">Источники</p>
          <button onClick={() => setEditSrc({ is_active: true })}
            className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={12} /> Источник
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-foreground/50 text-xs border-b border-border">
              <th className="text-left px-4 py-2">Название</th>
              <th className="text-left px-4 py-2">Группа</th>
              <th className="text-left px-4 py-2">UTM source</th>
              <th className="text-center px-4 py-2">Платный</th>
              <th className="text-center px-4 py-2">Активен</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sources.map(s => (
              <tr key={s.id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2 font-medium">{s.name}</td>
                <td className="px-4 py-2">
                  {s.group_name && <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.group_color || "#64748b" }} />{s.group_name}
                  </span>}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-foreground/60">{s.utm_source || "—"}</td>
                <td className="text-center px-4 py-2">{s.is_paid ? "💰" : "—"}</td>
                <td className="text-center px-4 py-2">{s.is_active ? "✅" : "⛔"}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => setEditSrc(s)} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                    <Icon name="Pencil" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Модалка источника */}
      {editSrc && (
        <Modal title={editSrc.id ? "Источник" : "Новый источник"} onClose={() => setEditSrc(null)} onSave={saveSource}>
          <Field label="Название">
            <input value={editSrc.name || ""} onChange={e => setEditSrc({ ...editSrc, name: e.target.value })} className={INPUT_CLS} style={{ cursor: "text" }} />
          </Field>
          <Field label="Группа">
            <select value={editSrc.group_id ?? ""} onChange={e => setEditSrc({ ...editSrc, group_id: e.target.value ? Number(e.target.value) : null })} className={INPUT_CLS} style={{ cursor: "pointer" }}>
              <option value="">— без группы —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
          <Field label="UTM source (для авто-привязки)">
            <input value={editSrc.utm_source || ""} onChange={e => setEditSrc({ ...editSrc, utm_source: e.target.value })} className={INPUT_CLS} style={{ cursor: "text" }} placeholder="yandex, avito…" />
          </Field>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={!!editSrc.is_paid} onChange={e => setEditSrc({ ...editSrc, is_paid: e.target.checked })} /> Платный
            </label>
            <label className="flex items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={editSrc.is_active !== false} onChange={e => setEditSrc({ ...editSrc, is_active: e.target.checked })} /> Активен
            </label>
          </div>
        </Modal>
      )}

      {/* Модалка группы */}
      {editGrp && (
        <Modal title={editGrp.id ? "Группа" : "Новая группа"} onClose={() => setEditGrp(null)} onSave={saveGroup}>
          <Field label="Название">
            <input value={editGrp.name || ""} onChange={e => setEditGrp({ ...editGrp, name: e.target.value })} className={INPUT_CLS} style={{ cursor: "text" }} />
          </Field>
          <Field label="Цвет">
            <input type="color" value={editGrp.color || "#64748b"} onChange={e => setEditGrp({ ...editGrp, color: e.target.value })} className="h-9 w-16 rounded border border-border" style={{ cursor: "pointer" }} />
          </Field>
        </Modal>
      )}
    </div>
  )
}

// ─────────────── БЮДЖЕТЫ ───────────────
function BudgetsManager({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [drafts, setDrafts] = useState<Record<number, { amount: string; leads: string }>>({})
  const [saving, setSaving] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [g, b] = await Promise.all([api.marketing.getGroups(), api.marketing.getBudgets()])
    setGroups(g?.groups || [])
    setBudgets(b?.budgets || [])
  }, [])
  useEffect(() => { load() }, [load])

  const budgetFor = (gid: number) => budgets.find(b => b.group_id === gid && b.period_month.startsWith(month))

  const save = async (gid: number) => {
    const cur = budgetFor(gid)
    const draft = drafts[gid]
    const amount = draft?.amount !== undefined ? Number(draft.amount) : (cur?.amount || 0)
    const leadsRaw = draft?.leads !== undefined ? draft.leads : (cur?.leads_manual != null ? String(cur.leads_manual) : "")
    setSaving(gid)
    await api.marketing.saveBudget({
      group_id: gid, period_month: month + "-01", amount: amount || 0,
      leads_manual: leadsRaw === "" ? null : Number(leadsRaw),
    })
    setSaving(null)
    setDrafts(d => { const n = { ...d }; delete n[gid]; return n })
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm text-foreground/60">Месяц:</label>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm" style={{ cursor: "text" }} />
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-foreground/50 text-xs border-b border-border">
              <th className="text-left px-4 py-2">Группа источников</th>
              <th className="text-left px-4 py-2">Бюджет за месяц, ₽</th>
              <th className="text-left px-4 py-2" title="Лиды вручную (если нужно учесть обращения без заказа)">Лиды (вручную)</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const cur = budgetFor(g.id)
              const draft = drafts[g.id]
              const amount = draft?.amount !== undefined ? draft.amount : (cur ? String(cur.amount) : "")
              const leads = draft?.leads !== undefined ? draft.leads : (cur?.leads_manual != null ? String(cur.leads_manual) : "")
              return (
                <tr key={g.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2 flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: g.color }} />{g.name}
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" min={0} value={amount} placeholder="0"
                      onChange={e => setDrafts(d => ({ ...d, [g.id]: { amount: e.target.value, leads } }))}
                      className="w-32 rounded border border-border bg-background px-2 py-1" style={{ cursor: "text" }} />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" min={0} value={leads} placeholder="авто"
                      onChange={e => setDrafts(d => ({ ...d, [g.id]: { amount, leads: e.target.value } }))}
                      className="w-24 rounded border border-border bg-background px-2 py-1" style={{ cursor: "text" }} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => save(g.id)} disabled={saving === g.id}
                      className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50" style={{ cursor: "pointer" }}>
                      {saving === g.id ? "…" : "Сохранить"}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground/40">
        Цена лида и стоимость привлечения считаются автоматически: бюджет ÷ лиды. Если поле «Лиды» пустое —
        берётся большее из числа заявок и заказов по этому каналу.
      </p>
    </div>
  )
}

// ─────────────── ХЕЛПЕРЫ UI ───────────────
function Modal({ title, children, onClose, onSave }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
            <Icon name="X" size={18} />
          </button>
        </div>
        <div className="space-y-3">{children}</div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded border border-border px-3 py-1.5 text-sm text-foreground/60" style={{ cursor: "pointer" }}>Отмена</button>
          <button onClick={onSave} className="rounded bg-primary px-4 py-1.5 text-sm text-primary-foreground" style={{ cursor: "pointer" }}>Сохранить</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-foreground/50 mb-1">{label}</label>
      {children}
    </div>
  )
}