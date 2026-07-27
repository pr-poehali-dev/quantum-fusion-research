import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Order, AdminTab } from "@/pages/admin/types"
import {
  STATUS_LABELS, PC_STATUS_LABELS, ACTIVE_STATUSES,
} from "@/pages/admin/constants"

interface Props {
  tab: AdminTab
  orders: Order[]
  loading: boolean
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>
  setTab: (t: AdminTab) => void
}

export function AdminOrdersTab({ tab, orders, loading, setOrders, setTab }: Props) {
  const navigate = useNavigate()
  const [viewArchive, setViewArchive] = useState(false)
  const isArchive = viewArchive

  const [orderTypeFilter, setOrderTypeFilter] = useState<"all" | "pc_build" | "parts">("all")
  const [newOrderModal, setNewOrderModal] = useState(false)
  const [newOrderForm, setNewOrderForm] = useState({ customer_name: "", customer_phone: "", customer_email: "", comment: "", order_type: "parts" as "parts" | "pc_build", source_id: "" as string })
  const [newOrderSaving, setNewOrderSaving] = useState(false)
  // Источники лидов из аналитики (marketing). Управление — во вкладке «Аналитика → Источники».
  const [leadSources, setLeadSources] = useState<{ id: number; name: string; group_name: string | null }[]>([])

  const [copiedOrderId, setCopiedOrderId] = useState<number | null>(null)
  const [warrantyLoadingId, setWarrantyLoadingId] = useState<number | null>(null)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [syncResultId, setSyncResultId] = useState<number | null>(null)

  // Заявки из квиза — для ручной привязки к заказу
  const [leads, setLeads] = useState<Array<{ id: number; name: string | null; phone: string | null; created_at: string }>>([])
  const [linkingOrderId, setLinkingOrderId] = useState<number | null>(null)
  useEffect(() => {
    api.quiz.getRequests().then(d => setLeads(d.requests || [])).catch(() => {})
  }, [])

  const linkQuiz = async (orderId: number, quizId: number) => {
    await api.orders.linkQuiz(orderId, quizId)
    setOrders(o => o.map(ord => ord.id === orderId ? { ...ord, quiz_request_id: quizId } : ord))
    setLinkingOrderId(null)
  }
  const unlinkQuiz = async (orderId: number) => {
    await api.orders.unlinkQuiz(orderId)
    setOrders(o => o.map(ord => ord.id === orderId ? { ...ord, quiz_request_id: null } : ord))
  }

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

  // Очистить резерв: снять складской резерв и пометку «в резерве» (for_sale),
  // но заказ остаётся активным и привязанным к сборке для дальнейшей обработки.
  const clearReservation = async (orderId: number) => {
    if (!confirm("Снять резерв с этого заказа?\nПометка «в резерве» исчезнет, складской резерв снимется, но заказ останется активным для обработки.")) return
    const res = await api.orders.updateItem({ id: orderId, action: "clear_reservation" })
    if (res.error) { alert(res.error); return }
    // Заказ остаётся, снимаем только признак резерва (for_sale)
    setOrders(o => o.map(ord => ord.id === orderId ? { ...ord, for_sale: false } : ord))
  }

  // Сборка-заказ считается активной, пока WIP-стадия не «Забрали»/«Отменён»/«Архив»
  // (даже на «Готов, можно забрать» её ещё надо выдать). Для остальных — по статусу.
  const WIP_DONE_STAGES = ["Забрали", "Отменён", "Архив"]
  const isOrderActive = (o: Order) => {
    if (o.order_type === "pc_build") {
      if (o.status === "cancelled") return false
      if (o.wip_stage) return !WIP_DONE_STAGES.includes(o.wip_stage)
      return ACTIVE_STATUSES.includes(o.status)
    }
    return ACTIVE_STATUSES.includes(o.status)
  }
  const filtered = orders
    .filter(o => isArchive ? !isOrderActive(o) : isOrderActive(o))
    .filter(o => orderTypeFilter === "all" || o.order_type === orderTypeFilter)

  const updateStatus = async (id: number, status: string) => {
    await api.orders.updateStatus({ id, status })
    setOrders(o => o.map(ord => ord.id === id ? { ...ord, status } : ord))
  }

  const [deletingId, setDeletingId] = useState<number | null>(null)
  const deleteOrder = async (id: number, num: string) => {
    if (!confirm(`Удалить заказ ${num} НАВСЕГДА?\n\nРезервы снимутся (товар вернётся на склад), заказ и сборка удалятся безвозвратно.\n\nЕсли по заказу была внесена предоплата — она будет обнулена (считается, что деньги возвращены клиенту), в кассе создастся возвратная проводка. История склада сохранится.`)) return
    setDeletingId(id)
    const res = await api.orders.remove(id)
    setDeletingId(null)
    if (res.error) { alert(res.error); return }
    setOrders(o => o.filter(ord => ord.id !== id))
  }

  // Подгружаем активные источники при первом открытии модалки нового заказа
  useEffect(() => {
    if (newOrderModal && leadSources.length === 0) {
      api.marketing.getSources(true).then(d => setLeadSources(d.sources || d || [])).catch(() => {})
    }
  }, [newOrderModal, leadSources.length])

  const createOrder = async () => {
    if (!newOrderForm.customer_name.trim() || !newOrderForm.customer_phone.trim()) return
    setNewOrderSaving(true)
    const res = await api.orders.create({
      customer_name: newOrderForm.customer_name.trim(),
      customer_phone: newOrderForm.customer_phone.trim(),
      customer_email: newOrderForm.customer_email.trim(),
      comment: newOrderForm.comment.trim(),
      order_type: newOrderForm.order_type,
      source_id: newOrderForm.source_id ? Number(newOrderForm.source_id) : null,
      items: [],
      total: 0,
    })
    if (res.id) {
      const d = await api.orders.getAll()
      setOrders(d.orders || [])
    }
    setNewOrderSaving(false)
    setNewOrderModal(false)
    setNewOrderForm({ customer_name: "", customer_phone: "", customer_email: "", comment: "", order_type: "parts", source_id: "" })
  }

  // Массовая сборка: создаём пустой заказ-партию и переходим в его редактор
  const [batchCreating, setBatchCreating] = useState(false)
  const createBatch = async () => {
    setBatchCreating(true)
    const res = await api.orders.createBatch({ customer_name: "Партия", customer_phone: "-" })
    setBatchCreating(false)
    if (res.id) navigate(`/admin/batch/${res.id}`)
    else alert(res.error || "Не удалось создать партию")
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


  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-light text-foreground">
          {isArchive ? "Архив заказов" : "Активные заказы"} ({filtered.length})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setViewArchive(v => !v)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isArchive ? "bg-amber-400/15 text-amber-400 border border-amber-400/40" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>
            <Icon name="Archive" size={15} />
            {isArchive ? "Скрыть архив" : "Архив"}
          </button>
          {!isArchive && (
            <>
              <button onClick={createBatch} disabled={batchCreating}
                className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                style={{ cursor: "pointer" }}
                title="Один заказ на партию ПК с разными конфигурациями">
                <Icon name={batchCreating ? "Loader" : "Boxes"} size={15} className={batchCreating ? "animate-spin" : ""} />
                Массовая сборка
              </button>
              <button onClick={() => setNewOrderModal(true)}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={15} />
                Новый заказ
              </button>
            </>
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
            let statusInfo = order.order_type === "pc_build"
              ? (PC_STATUS_LABELS[order.wip_stage || order.status] || STATUS_LABELS[order.status])
              : STATUS_LABELS[order.status]
            // Сборка свободной продажи на стадии «Готов, можно забрать» = «В продаже»
            if (order.is_stock_sale && order.wip_stage === "Готов, можно забрать") {
              statusInfo = { label: "В продаже", color: "text-green-400 bg-green-400/10" }
            }
            // «В резерве» = сборка свободной продажи, у которой в заказе-затычке
            // есть реальные данные клиента (телефон заполнен и не «-»).
            const _phone = (order.customer_phone || "").trim()
            const hasClient = !!_phone && _phone !== "-"
            const isReserved = !!order.is_stock_sale && hasClient && order.wip_stage !== "Забрали"
            return (
              <div key={order.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="font-mono text-xs text-foreground/40">{order.display_number || "#" + String(order.id).padStart(5, "0")}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo?.color || ""}`}>{statusInfo?.label || order.status}</span>
                      {order.order_type === "pc_build" && (
                        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">ПК-сборка</span>
                      )}
                      {order.order_type === "pc_batch" && (
                        <span className="rounded-full bg-purple-400/15 px-2.5 py-0.5 text-xs font-medium text-purple-400">Массовая сборка</span>
                      )}
                      {isReserved && (
                        <span className="rounded-full bg-orange-400/15 px-2.5 py-0.5 text-xs font-medium text-orange-400" title="Готовый ПК из наличия зарезервирован под этого клиента">В резерве</span>
                      )}
                      {order.quiz_request_id ? (
                        <button onClick={() => unlinkQuiz(order.id)} style={{ cursor: "pointer" }}
                          title="Заказ связан с заявкой. Нажмите, чтобы отвязать"
                          className="flex items-center gap-1 rounded-full bg-blue-400/15 px-2.5 py-0.5 text-xs font-medium text-blue-400 hover:bg-blue-400/25 transition-colors">
                          Из заявки #{order.quiz_request_id}<Icon name="X" size={11} />
                        </button>
                      ) : linkingOrderId === order.id ? (
                        <select autoFocus defaultValue="" onChange={e => e.target.value && linkQuiz(order.id, Number(e.target.value))}
                          onBlur={() => setLinkingOrderId(null)} style={{ cursor: "pointer" }}
                          className="rounded-full border border-border bg-background px-2 py-0.5 text-xs">
                          <option value="" disabled>Выберите заявку…</option>
                          {leads.map(l => (
                            <option key={l.id} value={l.id}>#{l.id} {l.name || "—"} · {l.phone || "—"}</option>
                          ))}
                        </select>
                      ) : leads.length > 0 && (
                        <button onClick={() => setLinkingOrderId(order.id)} style={{ cursor: "pointer" }}
                          className="flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground/50 hover:border-primary hover:text-foreground transition-colors">
                          <Icon name="Link2" size={11} />Привязать заявку
                        </button>
                      )}
                      {/* Предоплата неактуальна для сборок из свободной продажи (catalog) */}
                      {order.status !== "cancelled" && !order.is_stock_sale && (
                        order.prepayment_confirmed ? (
                          <span className="rounded-full bg-green-400/10 px-2.5 py-0.5 text-xs font-medium text-green-400">Предоплата внесена</span>
                        ) : (
                          <span className="rounded-full bg-yellow-400/10 px-2.5 py-0.5 text-xs font-medium text-yellow-400">Предоплата не внесена</span>
                        )
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
                            {item.name}
                            {item.preorder && <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Под заказ</span>}
                            {" "}× {item.quantity} — {item.price.toLocaleString("ru-RU")} ₽
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
                        onClick={() => copyOrderSheet(order.id)}
                        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 ${copiedOrderId === order.id ? "border-green-400/40 bg-green-400/5 text-green-400" : "border-border text-foreground/50 hover:border-primary hover:text-primary"}`}
                        style={{ cursor: "pointer" }}
                        title="Скопировать ссылку для приёмщика">
                        <Icon name={copiedOrderId === order.id ? "Check" : "Link"} size={12} />
                        <span className="hidden sm:inline">{copiedOrderId === order.id ? "Скопировано" : "Ссылка"}</span>
                      </button>
                    )}
                    <button
                      onClick={() => downloadWarranty(order.id)}
                      disabled={warrantyLoadingId === order.id}
                      className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground/50 hover:border-green-400/50 hover:text-green-400 transition-colors disabled:opacity-50 sm:px-3"
                      style={{ cursor: "pointer" }}
                      title="Скачать гарантийный лист PDF">
                      <Icon name={warrantyLoadingId === order.id ? "Loader" : "FileText"} size={12} className={warrantyLoadingId === order.id ? "animate-spin" : ""} />
                      <span className="hidden sm:inline">Гарантийный лист</span>
                    </button>
                    {order.order_type === "pc_build" && !isArchive && (
                      <button
                        onClick={() => syncOrder(order.id)}
                        disabled={syncingId === order.id}
                        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 sm:px-3 ${syncResultId === order.id ? "border-green-400/40 bg-green-400/5 text-green-400" : "border-yellow-400/40 bg-yellow-400/5 text-yellow-400 hover:bg-yellow-400/10"}`}
                        style={{ cursor: "pointer" }}
                        title="Выбить компоненты со склада, создать резервы">
                        <Icon name={syncingId === order.id ? "Loader" : syncResultId === order.id ? "Check" : "RefreshCw"} size={12} className={syncingId === order.id ? "animate-spin" : ""} />
                        <span className="hidden sm:inline">{syncResultId === order.id ? "Готово" : "Синхронизировать"}</span>
                      </button>
                    )}
                    {isReserved && (
                      <button
                        onClick={() => clearReservation(order.id)}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-orange-400/40 bg-orange-400/5 px-2.5 py-1.5 text-xs font-medium text-orange-400 hover:bg-orange-400/10 transition-colors sm:px-3"
                        style={{ cursor: "pointer" }}
                        title="Снять резерв: вернуть сборку в наличие, стереть данные клиента, отменить заказ">
                        <Icon name="Eraser" size={12} />
                        <span className="hidden sm:inline">Очистить резерв</span>
                      </button>
                    )}
                    <button
                      onClick={() => navigate(order.order_type === "pc_batch" ? `/admin/batch/${order.id}` : `/admin/order/${order.id}`)}
                      className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-accent/40 bg-accent/5 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors sm:px-3"
                      style={{ cursor: "pointer" }}
                      title="Обработать заказ">
                      <Icon name="Settings2" size={12} />
                      <span className="hidden sm:inline">Обработать</span>
                    </button>
                    {/* Вернуть в работу — для завершённых/отменённых заказов (не ПК-сборок) */}
                    {order.order_type !== "pc_build" && !ACTIVE_STATUSES.includes(order.status) && (
                      <button
                        onClick={() => updateStatus(order.id, "processing")}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors sm:px-3"
                        style={{ cursor: "pointer" }}
                        title="Вернуть заказ в работу">
                        <Icon name="Undo2" size={12} />
                        <span className="hidden sm:inline">Вернуть в работу</span>
                      </button>
                    )}
                    {/* Удалить заказ навсегда: снимает резервы, обнуляет предоплату
                        (возврат клиенту), удаляет заказ и сборку. Доступно в любом
                        списке заказов. */}
                    <button
                      onClick={() => deleteOrder(order.id, order.display_number || `#${order.id}`)}
                      disabled={deletingId === order.id}
                      className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-500/40 bg-red-500/5 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50 sm:px-3"
                      style={{ cursor: "pointer" }}
                      title="Удалить заказ навсегда (снять резервы, обнулить предоплату)">
                      <Icon name={deletingId === order.id ? "Loader" : "Trash2"} size={12} className={deletingId === order.id ? "animate-spin" : ""} />
                      <span className="hidden sm:inline">Удалить</span>
                    </button>
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
                <label className="mb-1 block text-xs text-foreground/60">Откуда лид</label>
                <select value={newOrderForm.source_id} onChange={e => setNewOrderForm(f => ({ ...f, source_id: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                  <option value="">— не указан —</option>
                  {leadSources.map(s => (
                    <option key={s.id} value={s.id}>{s.group_name ? `${s.group_name} · ${s.name}` : s.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-foreground/40">Список источников настраивается в «Аналитика → Источники»</p>
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


    </div>
  )
}