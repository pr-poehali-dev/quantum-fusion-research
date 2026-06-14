import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import {
  Order, AdminTab,
  STATUS_LABELS, PC_STATUS_LABELS, ACTIVE_STATUSES, ARCHIVE_STATUSES,
} from "@/pages/admin/types"

interface Props {
  tab: AdminTab
  orders: Order[]
  loading: boolean
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>
  setTab: (t: AdminTab) => void
}

export function AdminOrdersTab({ tab, orders, loading, setOrders, setTab }: Props) {
  const navigate = useNavigate()
  const isArchive = tab === "orders_archive"

  const [orderTypeFilter, setOrderTypeFilter] = useState<"all" | "pc_build" | "parts">("all")
  const [newOrderModal, setNewOrderModal] = useState(false)
  const [newOrderForm, setNewOrderForm] = useState({ customer_name: "", customer_phone: "", customer_email: "", comment: "", order_type: "parts" as "parts" | "pc_build" })
  const [newOrderSaving, setNewOrderSaving] = useState(false)

  // OrderList modal
  const [orderListOpen, setOrderListOpen] = useState(false)
  const [orderListLoading, setOrderListLoading] = useState(false)
  const [orderListGroups, setOrderListGroups] = useState<{
    group_id: string; name: string; total_qty: number; shortage: number
    url_supplier?: string; url_site?: string; product_id?: number
    order_status: string
    orders: { order_id: number; customer_name: string; shortage: number }[]
  }[]>([])

  const [copiedOrderId, setCopiedOrderId] = useState<number | null>(null)
  const [warrantyLoadingId, setWarrantyLoadingId] = useState<number | null>(null)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncResultId, setSyncResultId] = useState<number | null>(null)

  const syncOrder = async (orderId: number) => {
    setSyncingId(orderId)
    setSyncResultId(null)
    const res = await api.orders.updateItem({ id: orderId, action: "sync_order", item_idx: 0 })
    setSyncingId(null)
    if (res.error) { alert(res.error); return }
    setSyncResultId(orderId)
    setTimeout(() => setSyncResultId(null), 3000)
    if (res.auto_status) {
      setOrders(o => o.map(ord => ord.id === orderId ? { ...ord, status: res.auto_status } : ord))
    }
  }

  const filtered = orders
    .filter(o => isArchive ? ARCHIVE_STATUSES.includes(o.status) : ACTIVE_STATUSES.includes(o.status))
    .filter(o => orderTypeFilter === "all" || o.order_type === orderTypeFilter)

  const updateStatus = async (id: number, status: string) => {
    await api.orders.updateStatus({ id, status })
    setOrders(o => o.map(ord => ord.id === id ? { ...ord, status } : ord))
  }

  const createOrder = async () => {
    if (!newOrderForm.customer_name.trim() || !newOrderForm.customer_phone.trim()) return
    setNewOrderSaving(true)
    const res = await api.orders.create({
      customer_name: newOrderForm.customer_name.trim(),
      customer_phone: newOrderForm.customer_phone.trim(),
      customer_email: newOrderForm.customer_email.trim(),
      comment: newOrderForm.comment.trim(),
      order_type: newOrderForm.order_type,
      items: [],
      total: 0,
    })
    if (res.id) {
      const d = await api.orders.getAll()
      setOrders(d.orders || [])
    }
    setNewOrderSaving(false)
    setNewOrderModal(false)
    setNewOrderForm({ customer_name: "", customer_phone: "", customer_email: "", comment: "", order_type: "parts" })
  }

  const copyOrderSheet = async (orderId: number) => {
    const data = await api.builds.getAll()
    const allBuilds = data.builds || []
    const padded = String(orderId).padStart(5, "0")
    const found = allBuilds.find((b: { name: string; description?: string }) =>
      b.name.includes(padded) || b.description?.includes(`#${padded}`)
    )
    if (!found) { alert("Сборка для этого заказа не найдена"); return }
    const url = `${window.location.origin}/order-sheet/${found.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedOrderId(orderId)
      setTimeout(() => setCopiedOrderId(null), 2000)
    })
  }

  const downloadWarranty = async (orderId: number) => {
    setWarrantyLoadingId(orderId)
    const res = await fetch(`https://functions.poehali.dev/4f468c20-b028-4d53-8dad-affcf1b45618?order_id=${orderId}`)
    const data = await res.json()
    setWarrantyLoadingId(null)
    if (!data.pdf_b64) { alert("Ошибка генерации PDF"); return }
    const bin = atob(data.pdf_b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: "application/pdf" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = data.filename || `warranty_${orderId}.pdf`; a.click()
    URL.revokeObjectURL(url)
  }

  const openOrderList = async () => {
    setOrderListOpen(true)
    setOrderListLoading(true)
    try {
      const saved = (() => { try { return JSON.parse(localStorage.getItem("order_list_statuses") || "{}") } catch { return {} } })()
      const activeOrders = orders.filter(o => ACTIVE_STATUSES.includes(o.status))
      const groups: Record<string, typeof orderListGroups[0]> = {}
      for (const order of activeOrders) {
        const data = await api.builds.getAll()
        const allBuilds = data.builds || []
        const padded = String(order.id).padStart(5, "0")
        const build = allBuilds.find((b: { name: string; description?: string }) =>
          b.name.includes(padded) || b.description?.includes(`#${padded}`)
        )
        if (!build) continue
        for (const comp of build.components || []) {
          const qty = comp.qty || 1
          const inStock = (build.in_stock ? qty : 0)
          const shortage = qty - inStock
          if (shortage <= 0) continue
          const key = `${comp.name}::${comp.source_id || comp.name}`
          if (!groups[key]) {
            groups[key] = {
              group_id: key,
              name: comp.name,
              total_qty: 0,
              shortage: 0,
              url_supplier: comp.url_supplier,
              url_site: comp.url_site,
              product_id: comp.source_id,
              order_status: saved[key] || "need_order",
              orders: [],
            }
          }
          groups[key].total_qty += qty
          groups[key].shortage += shortage
          groups[key].orders.push({ order_id: order.id, customer_name: order.customer_name, shortage })
        }
      }
      setOrderListGroups(Object.values(groups).sort((a, b) => b.shortage - a.shortage))
    } catch (e) {
      console.error(e)
    }
    setOrderListLoading(false)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-light text-foreground">
          {isArchive ? "Архив заказов" : "Активные заказы"} ({filtered.length})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {!isArchive && (
            <button onClick={openOrderList}
              className="flex items-center gap-2 rounded-lg border border-orange-400/40 bg-orange-400/5 px-4 py-2 text-sm font-medium text-orange-400 hover:bg-orange-400/10 transition-colors"
              style={{ cursor: "pointer" }}>
              <Icon name="ShoppingCart" size={15} />
              Заказной список
            </button>
          )}
          {!isArchive && (
            <button onClick={() => setNewOrderModal(true)}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              style={{ cursor: "pointer" }}>
              <Icon name="Plus" size={15} />
              Новый заказ
            </button>
          )}
        </div>
      </div>

      {/* Фильтр по типу */}
      <div className="mb-4 flex gap-2">
        {(["all", "pc_build", "parts"] as const).map(f => (
          <button key={f} onClick={() => setOrderTypeFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${orderTypeFilter === f ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>
            {f === "all" ? "Все" : f === "pc_build" ? "ПК-сборки" : "Комплектующие"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Icon name="ClipboardList" size={36} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">{isArchive ? "Архив пуст" : "Активных заказов нет"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(order => {
            const statusInfo = order.order_type === "pc_build"
              ? (PC_STATUS_LABELS[order.wip_stage || order.status] || STATUS_LABELS[order.status])
              : STATUS_LABELS[order.status]
            return (
              <div key={order.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="font-mono text-xs text-foreground/40">#{String(order.id).padStart(5, "0")}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo?.color || ""}`}>{statusInfo?.label || order.status}</span>
                      {order.order_type === "pc_build" && (
                        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">ПК-сборка</span>
                      )}
                    </div>
                    <p className="font-semibold text-foreground">{order.customer_name}</p>
                    <p className="text-sm text-foreground/60">{order.customer_phone}</p>
                    {order.customer_email && <p className="text-xs text-foreground/40">{order.customer_email}</p>}
                    {order.comment && <p className="mt-1 text-xs text-foreground/50 italic">«{order.comment}»</p>}
                    {order.items?.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {order.items.map((item, i) => (
                          <p key={i} className="text-xs text-foreground/60">
                            {item.name} × {item.quantity} — {item.price.toLocaleString("ru-RU")} ₽
                          </p>
                        ))}
                        <p className="text-xs font-semibold text-foreground mt-1">Итого: {order.total.toLocaleString("ru-RU")} ₽</p>
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-foreground/30">{new Date(order.created_at).toLocaleString("ru-RU")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {order.order_type === "pc_build" && (
                      <button
                        onClick={async () => {
                          const data = await api.builds.getAll()
                          const allBuilds = data.builds || []
                          const padded = String(order.id).padStart(5, "0")
                          const found = allBuilds.find((b: { name: string; description?: string }) =>
                            b.name.includes(padded) || b.description?.includes(`#${padded}`)
                          )
                          if (!found) { alert("Сборка для этого заказа не найдена"); return }
                          setTab("add_build")
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/50 hover:border-primary hover:text-primary transition-colors"
                        style={{ cursor: "pointer" }}>
                        <Icon name="Monitor" size={12} />
                        Сборка
                      </button>
                    )}
                    {order.order_type === "pc_build" && (
                      <button
                        onClick={() => copyOrderSheet(order.id)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${copiedOrderId === order.id ? "border-green-400/40 bg-green-400/5 text-green-400" : "border-border text-foreground/50 hover:border-primary hover:text-primary"}`}
                        style={{ cursor: "pointer" }}
                        title="Скопировать ссылку для приёмщика">
                        <Icon name={copiedOrderId === order.id ? "Check" : "Link"} size={12} />
                        {copiedOrderId === order.id ? "Скопировано" : "Ссылка"}
                      </button>
                    )}
                    <button
                      onClick={() => downloadWarranty(order.id)}
                      disabled={warrantyLoadingId === order.id}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/50 hover:border-green-400/50 hover:text-green-400 transition-colors disabled:opacity-50"
                      style={{ cursor: "pointer" }}
                      title="Скачать гарантийный лист PDF">
                      <Icon name={warrantyLoadingId === order.id ? "Loader" : "FileText"} size={12} className={warrantyLoadingId === order.id ? "animate-spin" : ""} />
                      Гарантийный лист
                    </button>
                    {order.order_type === "pc_build" && !isArchive && (
                      <button
                        onClick={() => syncOrder(order.id)}
                        disabled={syncingId === order.id}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${syncResultId === order.id ? "border-green-400/40 bg-green-400/5 text-green-400" : "border-yellow-400/40 bg-yellow-400/5 text-yellow-400 hover:bg-yellow-400/10"}`}
                        style={{ cursor: "pointer" }}
                        title="Выбить компоненты со склада, создать резервы">
                        <Icon name={syncingId === order.id ? "Loader" : syncResultId === order.id ? "Check" : "RefreshCw"} size={12} className={syncingId === order.id ? "animate-spin" : ""} />
                        {syncResultId === order.id ? "Готово" : "Синхронизировать"}
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/admin/order/${order.id}`)}
                      className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
                      style={{ cursor: "pointer" }}>
                      <Icon name="Settings2" size={12} />
                      Обработать
                    </button>
                    {order.order_type !== "pc_build" && (
                      <select
                        value={order.status}
                        onChange={e => updateStatus(order.id, e.target.value)}
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                        style={{ cursor: "pointer" }}>
                        {Object.entries(STATUS_LABELS).filter(([k]) => k !== "done").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* New Order Modal */}
      {newOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" style={{ cursor: "auto" }}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-medium text-foreground">Новый заказ</h3>
              <button onClick={() => setNewOrderModal(false)} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                <Icon name="X" size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Имя клиента *</label>
                <input value={newOrderForm.customer_name} onChange={e => setNewOrderForm(f => ({ ...f, customer_name: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Телефон *</label>
                <input value={newOrderForm.customer_phone} onChange={e => setNewOrderForm(f => ({ ...f, customer_phone: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Email</label>
                <input value={newOrderForm.customer_email} onChange={e => setNewOrderForm(f => ({ ...f, customer_email: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Тип заказа</label>
                <select value={newOrderForm.order_type} onChange={e => setNewOrderForm(f => ({ ...f, order_type: e.target.value as "parts" | "pc_build" }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                  <option value="parts">Комплектующие</option>
                  <option value="pc_build">ПК-сборка</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Комментарий</label>
                <textarea value={newOrderForm.comment} onChange={e => setNewOrderForm(f => ({ ...f, comment: e.target.value }))}
                  rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none resize-none" style={{ cursor: "text" }} />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={createOrder} disabled={newOrderSaving || !newOrderForm.customer_name.trim() || !newOrderForm.customer_phone.trim()}
                  className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors" style={{ cursor: "pointer" }}>
                  {newOrderSaving ? "Создание..." : "Создать"}
                </button>
                <button onClick={() => setNewOrderModal(false)}
                  className="rounded-lg border border-border px-4 py-2.5 text-sm text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order List Modal */}
      {orderListOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-10" style={{ cursor: "auto" }}>
          <div className="relative w-full max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <button onClick={() => setOrderListOpen(false)} className="absolute right-4 top-4 text-foreground/40 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="X" size={18} />
            </button>
            <div className="mb-5 flex items-center gap-3 flex-wrap">
              <Icon name="ShoppingCart" size={20} className="text-orange-400" />
              <h3 className="text-lg font-medium text-foreground">Заказной список</h3>
              {!orderListLoading && <span className="rounded-full bg-orange-400/10 px-2.5 py-0.5 text-xs font-medium text-orange-400">{orderListGroups.length} позиций</span>}
            </div>
            {orderListLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted/40 animate-pulse" />)}</div>
            ) : orderListGroups.length === 0 ? (
              <div className="py-12 text-center">
                <Icon name="CheckCircle" size={40} className="mx-auto mb-3 text-green-400/40" />
                <p className="text-sm text-foreground/40">Всё в наличии или нет активных заказов</p>
              </div>
            ) : (
              <div className="space-y-3">
                {orderListGroups.map(g => (
                  <div key={g.group_id} className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-sm text-foreground">{g.name}</span>
                          <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs text-red-400 font-medium">−{g.shortage} шт.</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {g.url_supplier && (
                            <a href={g.url_supplier} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:border-primary hover:text-primary transition-colors"
                              title="Купить у поставщика">
                              <Icon name="ExternalLink" size={12} />Купить
                            </a>
                          )}
                          {!g.url_supplier && (g.url_site || g.product_id) && (
                            <a href={g.url_site || `/product/${g.product_id}`} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:border-primary hover:text-primary transition-colors"
                              title="Карточка на сайте">
                              <Icon name="Globe" size={12} />Сайт
                            </a>
                          )}
                          {!g.url_supplier && !g.url_site && !g.product_id && (
                            <span className="text-xs text-foreground/25">нет ссылки</span>
                          )}
                        </div>
                        {g.orders.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {g.orders.map(o => (
                              <a key={o.order_id} href={`/admin/order/${o.order_id}`}
                                className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-xs text-foreground/50 hover:text-primary hover:bg-primary/10 transition-colors"
                                title={o.customer_name}>
                                <span className="font-mono font-semibold text-foreground/70">#{String(o.order_id).padStart(4, "0")}</span>
                                <span className="text-foreground/40">{o.customer_name}</span>
                                <span className="text-red-400 font-medium">−{o.shortage}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        <select
                          value={g.order_status}
                          onChange={e => {
                            const newStatus = e.target.value
                            setOrderListGroups(prev => prev.map(item => item.group_id === g.group_id ? { ...item, order_status: newStatus } : item))
                            const saved = (() => { try { return JSON.parse(localStorage.getItem("order_list_statuses") || "{}") } catch { return {} } })()
                            saved[g.group_id] = newStatus
                            localStorage.setItem("order_list_statuses", JSON.stringify(saved))
                          }}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium focus:outline-none transition-colors cursor-pointer ${
                            g.order_status === "need_order"      ? "border-red-400/40 bg-red-500/10 text-red-400" :
                            g.order_status === "ordered_delay"   ? "border-orange-400/40 bg-orange-500/10 text-orange-400" :
                            g.order_status === "ordered_transit" ? "border-yellow-400/40 bg-yellow-500/10 text-yellow-400" :
                            g.order_status === "ready"           ? "border-green-400/40 bg-green-500/10 text-green-400" :
                            "border-border bg-muted/50 text-foreground/40"
                          }`}
                          style={{ cursor: "pointer" }}>
                          <option value="need_order">Заказать</option>
                          <option value="ordered_delay">Задержка</option>
                          <option value="ordered_transit">Едет</option>
                          <option value="ready">Есть</option>
                          <option value="pending">—</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!orderListLoading && orderListGroups.length > 0 && (
              <p className="mt-4 text-xs text-foreground/30 text-center">Статусы сохраняются локально в браузере</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}