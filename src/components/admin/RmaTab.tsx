import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

interface RmaItem {
  id: number
  order_id: number | null
  group_id: number | null
  product_id: number | null
  slot: string | null
  item_name: string
  qty: number
  reason: string
  source_type: string
  status: string
  status_label: string
  supplier_note: string | null
  resolution: string | null
  detected_at: string
  resolved_at: string | null
  quarantine_qty: number
  customer_name: string | null
  customer_phone: string | null
  group_name: string | null
  group_sku: string | null
  created_at: string
}

interface OrderComponent {
  slot: string
  slot_label: string
  name: string
  product_id: number | null
  group_id: number | null
  warranty_until: string | null
  source: string
  qty?: number
}

const STATUS_COLORS: Record<string, string> = {
  new:          "bg-primary/10 text-primary border-primary/30",
  to_supplier:  "bg-orange-400/10 text-orange-400 border-orange-400/30",
  in_progress:  "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
  resolved:     "bg-green-400/10 text-green-400 border-green-400/30",
  closed:       "bg-muted text-foreground/40 border-border",
}

const STATUS_OPTIONS = [
  { value: "new",         label: "Новый" },
  { value: "to_supplier", label: "Отправлен поставщику" },
  { value: "in_progress", label: "В процессе" },
  { value: "resolved",    label: "Решён" },
  { value: "closed",      label: "Закрыт" },
]

const EMPTY_FORM = {
  order_id: "" as string,
  group_id: null as number | null,
  product_id: null as number | null,
  slot: "",
  item_name: "",
  qty: 1,
  reason: "",
  source_type: "order",
}

export default function RmaTab() {
  const [items, setItems] = useState<RmaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [stats, setStats] = useState<Record<string, number>>({})

  // Форма создания
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [orderComponents, setOrderComponents] = useState<OrderComponent[]>([])
  const [orderInfo, setOrderInfo] = useState<{ customer_name: string; customer_phone: string; order_type: string } | null>(null)
  const [orderLoading, setOrderLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Детали / редактирование
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detail, setDetail] = useState<RmaItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [supplierNote, setSupplierNote] = useState("")
  const [resolveMode, setResolveMode] = useState<"" | "replacement" | "refund">("")
  const [replacementQty, setReplacementQty] = useState(1)
  const [replacementCost, setReplacementCost] = useState("")
  const [resolving, setResolving] = useState(false)

  const load = async () => {
    setLoading(true)
    const [listRes, statsRes] = await Promise.all([
      api.rma.list(statusFilter || undefined),
      api.rma.stats(),
    ])
    setItems(listRes.rma || [])
    setStats(statsRes.by_status || {})
    setLoading(false)
  }

  useEffect(() => { load() }, [statusFilter])

  // Загрузка компонентов заказа при вводе order_id
  const loadOrderComponents = async (orderId: string) => {
    if (!orderId.trim() || isNaN(Number(orderId))) {
      setOrderComponents([]); setOrderInfo(null); return
    }
    setOrderLoading(true)
    const res = await api.rma.orderComponents(Number(orderId))
    if (res.error) { setOrderComponents([]); setOrderInfo(null) }
    else {
      setOrderComponents(res.components || [])
      setOrderInfo({ customer_name: res.customer_name, customer_phone: res.customer_phone, order_type: res.order_type })
    }
    setOrderLoading(false)
  }

  const selectComponent = (comp: OrderComponent) => {
    setForm(f => ({
      ...f,
      group_id: comp.group_id,
      product_id: comp.product_id,
      slot: comp.slot,
      item_name: comp.name,
    }))
  }

  const submitCreate = async () => {
    if (!form.item_name.trim() || !form.reason.trim()) return
    setSaving(true)
    await api.rma.create({
      order_id: form.order_id ? Number(form.order_id) : null,
      group_id: form.group_id,
      product_id: form.product_id,
      slot: form.slot,
      item_name: form.item_name,
      qty: form.qty,
      reason: form.reason,
      source_type: form.source_type,
    })
    setSaving(false)
    setShowCreate(false)
    setForm({ ...EMPTY_FORM })
    setOrderComponents([])
    setOrderInfo(null)
    load()
  }

  const openDetail = async (id: number) => {
    setDetailId(id)
    setDetailLoading(true)
    setDetail(null)
    setResolveMode("")
    const res = await api.rma.get(id)
    setDetail(res.rma || null)
    setSupplierNote(res.rma?.supplier_note || "")
    setDetailLoading(false)
  }

  const updateStatus = async (id: number, status: string) => {
    await api.rma.update({ id, status })
    setItems(prev => prev.map(r => r.id === id ? { ...r, status, status_label: STATUS_OPTIONS.find(s => s.value === status)?.label || status } : r))
    if (detail?.id === id) setDetail(d => d ? { ...d, status } : d)
  }

  const saveNote = async () => {
    if (!detail) return
    await api.rma.update({ id: detail.id, supplier_note: supplierNote })
    setDetail(d => d ? { ...d, supplier_note: supplierNote } : d)
  }

  const doReplacement = async () => {
    if (!detail) return
    setResolving(true)
    await api.rma.resolveReplacement({
      rma_id: detail.id,
      group_id: detail.group_id,
      qty: replacementQty,
      cost_price: parseFloat(replacementCost) || 0,
    })
    setResolving(false)
    setResolveMode("")
    load()
    openDetail(detail.id)
  }

  const doRefund = async () => {
    if (!detail) return
    setResolving(true)
    await api.rma.resolveRefund({ rma_id: detail.id, group_id: detail.group_id })
    setResolving(false)
    setResolveMode("")
    load()
    openDetail(detail.id)
  }

  const totalOpen = (stats.new || 0) + (stats.to_supplier || 0) + (stats.in_progress || 0)

  return (
    <div>
      {/* Шапка */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-light text-foreground">Гарантийные случаи (RMA)</h2>
          {totalOpen > 0 && (
            <p className="text-xs text-foreground/50 mt-0.5">{totalOpen} открытых · {stats.resolved || 0} решено</p>
          )}
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={15} />Новый случай
        </button>
      </div>

      {/* Фильтр по статусу */}
      <div className="mb-5 flex flex-wrap gap-2">
        {[{ value: "", label: `Все (${Object.values(stats).reduce((a, b) => a + b, 0)})` },
          ...STATUS_OPTIONS.map(s => ({ value: s.value, label: `${s.label} (${stats[s.value] || 0})` }))
        ].map(f => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${statusFilter === f.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Список */}
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Icon name="ShieldCheck" size={40} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">{statusFilter ? "Нет записей с этим статусом" : "Гарантийных случаев пока нет"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(r => (
            <div key={r.id} onClick={() => openDetail(r.id)}
              className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 hover:border-primary/40 transition-all cursor-pointer">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status] || STATUS_COLORS.closed}`}>
                    {r.status_label}
                  </span>
                  {r.order_id && (
                    <span className="font-mono text-xs text-foreground/40">Заказ #{String(r.order_id).padStart(5, "0")}</span>
                  )}
                  {r.resolution && (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.resolution === "replacement" ? "bg-green-400/10 text-green-400" : "bg-foreground/10 text-foreground/50"}`}>
                      {r.resolution === "replacement" ? "Замена" : r.resolution === "refund" ? "Возврат денег" : "Ремонт"}
                    </span>
                  )}
                  {r.quarantine_qty > 0 && (
                    <span className="rounded-full bg-orange-400/10 px-2.5 py-0.5 text-xs text-orange-400">
                      <Icon name="AlertTriangle" size={10} className="inline mr-1" />Карантин {r.quarantine_qty} шт.
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-foreground truncate">{r.item_name}</p>
                <p className="text-xs text-foreground/50 mt-0.5 line-clamp-1">{r.reason}</p>
                <div className="flex gap-3 mt-1 text-xs text-foreground/40">
                  {r.customer_name && <span>{r.customer_name}</span>}
                  {r.customer_phone && <span className="font-mono text-primary/60">{r.customer_phone}</span>}
                  <span>{new Date(r.created_at).toLocaleDateString("ru-RU")}</span>
                </div>
              </div>
              <div className="shrink-0">
                <select
                  value={r.status}
                  onChange={e => { e.stopPropagation(); updateStatus(r.id, e.target.value) }}
                  onClick={e => e.stopPropagation()}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                  style={{ cursor: "pointer" }}>
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Форма создания ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-10" style={{ cursor: "auto" }}>
          <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <button onClick={() => { setShowCreate(false); setForm({ ...EMPTY_FORM }); setOrderComponents([]); setOrderInfo(null) }}
              className="absolute right-4 top-4 text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
              <Icon name="X" size={18} />
            </button>
            <h3 className="mb-5 text-lg font-medium text-foreground">Новый гарантийный случай</h3>

            <div className="space-y-4">
              {/* Источник */}
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Источник брака</label>
                <div className="flex gap-2">
                  {[{ v: "order", l: "От клиента (заказ)" }, { v: "stock", l: "Выявлен на складе" }].map(opt => (
                    <button key={opt.v} type="button" onClick={() => setForm(f => ({ ...f, source_type: opt.v }))}
                      className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${form.source_type === opt.v ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                      style={{ cursor: "pointer" }}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Выбор заказа */}
              {form.source_type === "order" && (
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Номер заказа</label>
                  <div className="flex gap-2">
                    <input
                      type="number" placeholder="Например: 48"
                      value={form.order_id}
                      onChange={e => setForm(f => ({ ...f, order_id: e.target.value }))}
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                      style={{ cursor: "text" }}
                    />
                    <button onClick={() => loadOrderComponents(form.order_id)}
                      disabled={orderLoading}
                      className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      style={{ cursor: "pointer" }}>
                      {orderLoading ? "..." : "Загрузить"}
                    </button>
                  </div>
                  {orderInfo && (
                    <p className="mt-1 text-xs text-foreground/50">
                      {orderInfo.customer_name} · {orderInfo.customer_phone}
                    </p>
                  )}
                </div>
              )}

              {/* Список компонентов заказа */}
              {orderComponents.length > 0 && (
                <div>
                  <label className="mb-2 block text-xs text-foreground/60">Выберите железку</label>
                  <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/50 max-h-52 overflow-y-auto">
                    {orderComponents.map((comp, i) => {
                      const selected = form.slot === comp.slot && form.item_name === comp.name
                      return (
                        <button key={i} type="button" onClick={() => selectComponent(comp)}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${selected ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}
                          style={{ cursor: "pointer" }}>
                          <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[10px] font-mono text-foreground/50">{comp.slot_label}</span>
                          <span className="flex-1 truncate font-medium">{comp.name}</span>
                          {comp.warranty_until && (
                            <span className="shrink-0 text-xs text-foreground/40">гарантия до {new Date(comp.warranty_until).toLocaleDateString("ru-RU")}</span>
                          )}
                          {selected && <Icon name="Check" size={14} className="text-primary shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Железка вручную (если нет заказа или не выбрано) */}
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Наименование железки *</label>
                <input
                  value={form.item_name}
                  onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
                  placeholder="AMD Ryzen 7 9800X3D"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  style={{ cursor: "text" }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Количество</label>
                  <input
                    type="number" min={1} value={form.qty}
                    onChange={e => setForm(f => ({ ...f, qty: Math.max(1, Number(e.target.value)) }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    style={{ cursor: "text" }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Дата выявления</label>
                  <input type="date" readOnly
                    defaultValue={new Date().toISOString().split("T")[0]}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground/50 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-foreground/60">Описание проблемы *</label>
                <textarea
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  rows={3} placeholder="Не запускается, артефакты на экране, не определяется системой..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none resize-none"
                  style={{ cursor: "text" }}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={submitCreate}
                  disabled={saving || !form.item_name.trim() || !form.reason.trim()}
                  className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  style={{ cursor: "pointer" }}>
                  {saving ? "Создание..." : "Создать RMA"}
                </button>
                <button onClick={() => { setShowCreate(false); setForm({ ...EMPTY_FORM }); setOrderComponents([]); setOrderInfo(null) }}
                  className="rounded-lg border border-border px-5 py-2.5 text-sm text-foreground/60 hover:border-primary transition-colors"
                  style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Детали RMA ── */}
      {detailId !== null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-10" style={{ cursor: "auto" }}>
          <div className="relative w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <button onClick={() => { setDetailId(null); setDetail(null) }}
              className="absolute right-4 top-4 text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
              <Icon name="X" size={18} />
            </button>

            {detailLoading || !detail ? (
              <div className="py-12 text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
            ) : (
              <>
                <div className="mb-5">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[detail.status] || STATUS_COLORS.closed}`}>
                      {STATUS_OPTIONS.find(s => s.value === detail.status)?.label || detail.status}
                    </span>
                    <span className="text-xs text-foreground/40">RMA #{detail.id}</span>
                    {detail.order_id && (
                      <span className="font-mono text-xs text-foreground/40">Заказ #{String(detail.order_id).padStart(5, "0")}</span>
                    )}
                  </div>
                  <h3 className="text-lg font-medium text-foreground">{detail.item_name}</h3>
                  {detail.customer_name && (
                    <p className="text-sm text-foreground/60 mt-0.5">{detail.customer_name} · {detail.customer_phone}</p>
                  )}
                </div>

                <div className="space-y-4 mb-5">
                  <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground/50">Количество</span>
                      <span className="text-foreground">{detail.qty} шт.</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground/50">Слот</span>
                      <span className="text-foreground">{detail.slot || "—"}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground/50">Дата выявления</span>
                      <span className="text-foreground">{new Date(detail.detected_at).toLocaleDateString("ru-RU")}</span>
                    </div>
                    {detail.quarantine_qty > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-foreground/50">В карантине</span>
                        <span className="text-orange-400 font-medium">{detail.quarantine_qty} шт.</span>
                      </div>
                    )}
                    {detail.resolved_at && (
                      <div className="flex justify-between text-sm">
                        <span className="text-foreground/50">Решено</span>
                        <span className="text-green-400">{new Date(detail.resolved_at).toLocaleDateString("ru-RU")}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs text-foreground/50 mb-1">Описание проблемы</p>
                    <p className="text-sm text-foreground/80 leading-relaxed">{detail.reason}</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-foreground/50">Комментарий поставщику</label>
                    <textarea
                      value={supplierNote}
                      onChange={e => setSupplierNote(e.target.value)}
                      rows={2}
                      placeholder="Связались с поставщиком, ждём ответа..."
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none resize-none"
                      style={{ cursor: "text" }}
                    />
                    <button onClick={saveNote}
                      className="mt-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                      style={{ cursor: "pointer" }}>
                      Сохранить заметку
                    </button>
                  </div>
                </div>

                {/* Смена статуса */}
                <div className="mb-4">
                  <label className="mb-1 block text-xs text-foreground/50">Статус</label>
                  <select
                    value={detail.status}
                    onChange={e => updateStatus(detail.id, e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    style={{ cursor: "pointer" }}>
                    {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>

                {/* Закрытие RMA */}
                {!["resolved", "closed"].includes(detail.status) && (
                  <div>
                    {resolveMode === "" && (
                      <div className="flex gap-2">
                        <button onClick={() => setResolveMode("replacement")}
                          className="flex-1 rounded-lg border border-green-400/30 bg-green-400/5 px-3 py-2 text-xs font-medium text-green-400 hover:bg-green-400/10 transition-colors"
                          style={{ cursor: "pointer" }}>
                          <Icon name="PackageCheck" size={13} className="inline mr-1.5" />Замена пришла
                        </button>
                        <button onClick={() => setResolveMode("refund")}
                          className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                          style={{ cursor: "pointer" }}>
                          <Icon name="RotateCcw" size={13} className="inline mr-1.5" />Возврат денег
                        </button>
                      </div>
                    )}

                    {resolveMode === "replacement" && (
                      <div className="rounded-xl border border-green-400/20 bg-green-400/5 p-4 space-y-3">
                        <p className="text-sm font-medium text-green-400">Замена от поставщика</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-xs text-foreground/50">Количество</label>
                            <input type="number" min={1} value={replacementQty}
                              onChange={e => setReplacementQty(Math.max(1, Number(e.target.value)))}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                              style={{ cursor: "text" }} />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-foreground/50">Себестоимость (₽)</label>
                            <input type="number" value={replacementCost} placeholder="0"
                              onChange={e => setReplacementCost(e.target.value)}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                              style={{ cursor: "text" }} />
                          </div>
                        </div>
                        <p className="text-xs text-foreground/40">Товар поступит на склад и автоматически погасит минус-резервы (при наличии).</p>
                        <div className="flex gap-2">
                          <button onClick={doReplacement} disabled={resolving}
                            className="flex-1 rounded-lg bg-green-500 px-4 py-2 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
                            style={{ cursor: "pointer" }}>
                            {resolving ? "Обработка..." : "Принять замену на склад"}
                          </button>
                          <button onClick={() => setResolveMode("")}
                            className="rounded-lg border border-border px-4 py-2 text-xs text-foreground/60 hover:border-primary transition-colors"
                            style={{ cursor: "pointer" }}>Отмена</button>
                        </div>
                      </div>
                    )}

                    {resolveMode === "refund" && (
                      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                        <p className="text-sm font-medium text-foreground">Возврат денег от поставщика</p>
                        <p className="text-xs text-foreground/50">Карантинный товар будет списан со склада. Деньги получены.</p>
                        <div className="flex gap-2">
                          <button onClick={doRefund} disabled={resolving}
                            className="flex-1 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            style={{ cursor: "pointer" }}>
                            {resolving ? "Обработка..." : "Подтвердить возврат"}
                          </button>
                          <button onClick={() => setResolveMode("")}
                            className="rounded-lg border border-border px-4 py-2 text-xs text-foreground/60 hover:border-primary transition-colors"
                            style={{ cursor: "pointer" }}>Отмена</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {["resolved", "closed"].includes(detail.status) && detail.resolution && (
                  <div className={`rounded-xl border p-4 ${detail.resolution === "replacement" ? "border-green-400/20 bg-green-400/5" : "border-border bg-muted/20"}`}>
                    <p className={`text-sm font-medium ${detail.resolution === "replacement" ? "text-green-400" : "text-foreground/60"}`}>
                      {detail.resolution === "replacement" ? "✓ Замена получена и принята на склад" :
                       detail.resolution === "refund" ? "✓ Возврат денег оформлен" : "✓ Ремонт выполнен"}
                    </p>
                    {detail.resolved_at && (
                      <p className="text-xs text-foreground/40 mt-0.5">{new Date(detail.resolved_at).toLocaleDateString("ru-RU")}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
