import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import PrepaymentEditor from "@/components/admin/PrepaymentEditor"
import PrepaymentConfirmModal from "@/components/admin/PrepaymentConfirmModal"
import ContractDialog, { contractQuery, ContractParams } from "@/components/admin/ContractDialog"
import { useUiScale } from "@/store/uiScale"

const ORDERS_URL = "https://functions.poehali.dev/92fb1cdd-4b87-4bcb-8154-75a499dd1745"
const PRODUCTS_URL = "https://functions.poehali.dev/ab453741-d994-4115-9a77-276036d19dbd"
const WARRANTY_URL = "https://functions.poehali.dev/4f468c20-b028-4d53-8dad-affcf1b45618"
const CONTRACT_URL = "https://functions.poehali.dev/7db163ee-2c8f-43e0-af32-d7c98db8f5e4"

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Новый", color: "text-primary bg-primary/10" },
  processing: { label: "В работе", color: "text-accent bg-accent/10" },
  done: { label: "Выполнен", color: "text-green-400 bg-green-400/10" },
  cancelled: { label: "Отменён", color: "text-foreground/50 bg-muted" },
}

const RMA_STATUS_LABELS: Record<string, string> = {
  new: "Новый", to_supplier: "У поставщика", in_progress: "В работе",
  resolved: "Решён", closed: "Закрыт",
}

const ITEM_STATUS: Record<string, { label: string; color: string; icon: string }> = {
  reserved:  { label: "В резерве",  color: "text-yellow-400 bg-yellow-400/10", icon: "Clock" },
  issued:    { label: "Выдан",      color: "text-green-400 bg-green-400/10",   icon: "CheckCircle" },
  returned:  { label: "Возврат",    color: "text-red-400 bg-red-400/10",       icon: "RotateCcw" },
}

interface Supply {
  id: number
  qty: number
  qty_reserved: number
  free: number
  qty_negative: number
  warranty_months: number
  group_id: number
  reserved_for_order?: number
}

interface OrderItem {
  id: number
  name: string
  price: number
  quantity: number
  build_qty?: number
  item_type: string
  serial_number?: string
  serial_numbers?: string[]
  final_price?: number
  item_status?: string
  slot?: string
  slot_label?: string
  wip_status?: string
  warranty_months?: number
  preorder?: boolean
  ram_modules?: number
  _supplies?: Supply[]
}

interface WipComponent {
  slot: string
  label: string
  name: string
  status: string
}

interface WipBuildInfo {
  id: number
  stage: string
  build_id?: number | null
  components: WipComponent[]
}

interface Order {
  id: number
  customer_name: string
  customer_phone: string
  customer_email?: string
  order_type: string
  items: OrderItem[]
  total: number
  comment?: string
  status: string
  created_at: string
  _wip_build?: WipBuildInfo
  _build_qty?: number
  prepayment_percent?: number
  prepayment_amount?: number
  remaining_amount?: number
  prepayment_confirmed?: boolean
  remaining_paid?: boolean
  remaining_paid_amount?: number
  is_stock_sale?: boolean
  source_id?: number | null
  source_name?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
}

function fmt(n: number) {
  return n.toLocaleString("ru-RU") + " ₽"
}

export default function OrderProcessPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const uiScale = useUiScale(s => s.scale)
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  // Гарантийные случаи (RMA) по этому заказу
  const [rmaList, setRmaList] = useState<Array<{ id: number; item_name: string; status: string; status_label?: string; qty: number; created_at: string }>>([])

  // Модалка выдачи заказа
  const [showWriteoff, setShowWriteoff] = useState(false)
  const [writeoffLoading, setWriteoffLoading] = useState(false)

  // Модалки оплаты: внесение предоплаты и оплата остатка
  const [showPrepay, setShowPrepay] = useState(false)
  const [showRemaining, setShowRemaining] = useState(false)

  // Гарантийное письмо
  const [warrantyLoading, setWarrantyLoading] = useState(false)
  // Договор поставки — выбор юрлица
  const [contractLoading, setContractLoading] = useState(false)
  const [contractOpen, setContractOpen] = useState(false)
  // Редактирование данных клиента (имя/телефон)
  const [editCustomer, setEditCustomer] = useState(false)
  const [custName, setCustName] = useState("")
  const [custPhone, setCustPhone] = useState("")
  const [custSaving, setCustSaving] = useState(false)

  // Источник клиента (канал привлечения)
  const [sources, setSources] = useState<{ id: number; name: string; group_name: string | null }[]>([])
  const [sourceSaving, setSourceSaving] = useState(false)

  // Синхронизация заказа ПК
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncResult, setSyncResult] = useState<{reserved: {slot:string,name:string}[], need_order: {slot:string,name:string}[], auto_status: string|null} | null>(null)

  // Редактирование кол-ва ПК
  const [editBuildQty, setEditBuildQty] = useState(false)
  const [buildQtyInput, setBuildQtyInput] = useState(1)
  const [buildQtySaving, setBuildQtySaving] = useState(false)

  // Голосовое сопровождение при сканировании серийников (по умолчанию выкл, состояние в localStorage)
  const [voiceOn, setVoiceOn] = useState(isVoiceEnabled())
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceName, setVoiceNameState] = useState(getVoiceName())
  const [voiceRate, setVoiceRateState] = useState(getVoiceRate())
  const [voicePitch, setVoicePitchState] = useState(getVoicePitch())

  useEffect(() => {
    warmUpVoices(() => setVoices(getRussianVoices()))
    setVoices(getRussianVoices())
  }, [])

  const toggleVoice = () => {
    const next = !voiceOn
    setVoiceOn(next)
    setVoiceEnabled(next)
    if (next) { setVoices(getRussianVoices()); speak("Озвучка включена") }
  }

  const syncOrder = async () => {
    setSyncLoading(true)
    setSyncResult(null)
    const res = await api.orders.updateItem({ id: Number(id), action: "sync_order", item_idx: 0 })
    setSyncLoading(false)
    if (res.error) { alert(res.error); return }
    setSyncResult(res)
    await load()
  }
  const downloadWarranty = async () => {
    setWarrantyLoading(true)
    const res = await fetch(`${WARRANTY_URL}?order_id=${id}`).then(r => r.json()).catch(() => null)
    setWarrantyLoading(false)
    if (!res?.pdf_b64) return
    const link = document.createElement("a")
    link.href = `data:application/pdf;base64,${res.pdf_b64}`
    link.download = res.filename || `warranty_${id}.pdf`
    link.click()
  }
  // Печать договора с параметрами из диалога (юрлицо, предоплата, срок, ФИО…)
  const printContract = async (p: ContractParams) => {
    setContractLoading(true)
    const res = await fetch(`${CONTRACT_URL}?order_id=${id}${contractQuery(p)}`)
      .then(r => r.json()).catch(() => null)
    setContractLoading(false)
    if (!res?.pdf_b64) { alert("Не удалось создать договор"); return }
    setContractOpen(false)
    const link = document.createElement("a")
    link.href = `data:application/pdf;base64,${res.pdf_b64}`
    link.download = res.filename || `contract_${id}.pdf`
    link.click()
  }

  // Редактирование данных клиента
  const startEditCustomer = () => {
    setCustName(order?.customer_name || "")
    setCustPhone(order?.customer_phone || "")
    setEditCustomer(true)
  }
  const saveCustomer = async () => {
    if (!custName.trim() || !custPhone.trim()) { alert("Имя и телефон обязательны"); return }
    setCustSaving(true)
    const res = await api.orders.updateItem({ id: Number(id), action: "set_customer", customer_name: custName.trim(), customer_phone: custPhone.trim() })
    setCustSaving(false)
    if (res?.error) { alert(res.error); return }
    setEditCustomer(false)
    await load()
  }

  // Загрузка справочника источников (один раз)
  useEffect(() => {
    api.marketing.getSources(true).then(d => setSources(d?.sources || [])).catch(() => {})
  }, [])

  const changeSource = async (sourceId: number | null) => {
    setSourceSaving(true)
    await api.orders.setSource(Number(id), sourceId).catch(() => {})
    setSourceSaving(false)
    await load()
  }

  // Поиск товаров для замены
  const [replaceIdx, setReplaceIdx] = useState<number | null>(null)
  const [searchQ, setSearchQ] = useState("")
  const [searchResults, setSearchResults] = useState<{ id: number; name: string; price: number; category: string }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // Добавление нового товара
  const [showAddItem, setShowAddItem] = useState(false)
  const [addSearchQ, setAddSearchQ] = useState("")
  const [addSearchResults, setAddSearchResults] = useState<{ id: number; name: string; price: number; category: string }[]>([])
  const [addSearchLoading, setAddSearchLoading] = useState(false)
  const [addingItem, setAddingItem] = useState(false)
  const [addQty, setAddQty] = useState(1)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const data = await api.orders.getById(Number(id))
    setOrder(data.order || null)
    if (data.order?._build_qty) setBuildQtyInput(data.order._build_qty)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // Подгружаем гарантийные случаи (RMA) по этому заказу
  useEffect(() => {
    if (!id) return
    api.rma.listByOrder(Number(id)).then(d => setRmaList(d.rma || [])).catch(() => {})
  }, [id])

  const callPut = async (action: string, itemIdx: number, extra: Record<string, unknown> = {}) => {
    setSaving(`${action}-${itemIdx}`)
    const res = await api.orders.updateItem({ id: Number(id), action, item_idx: itemIdx, ...extra })
    setSaving(null)
    if (res.error) { alert(res.message || res.error); return res }
    if (res.ok) {
      if (action === "set_serial") {
        // set_serial не перезагружает — SerialInput сам отражает новое значение
      } else if (order?.order_type === "pc_build" && action === "set_price") {
        // ПК-заказ: цена компонента сохранена на бэке по slot. Обновляем ТОЧЕЧНО
        // только нужную позицию по индексу — без рефетча и без потери остальных.
        const newPrice = Number(extra.price)
        setOrder(prev => {
          if (!prev) return prev
          const items = prev.items.map((it, i) => i === itemIdx ? { ...it, final_price: newPrice } : it)
          const total = items.reduce((s, it) => it.item_status === "returned" ? s : s + (it.final_price ?? it.price) * it.quantity, 0)
          return { ...prev, items, total }
        })
      } else if (action === "change_qty") {
        // Кол-во меняем точечно по позиции — без рефетча (и для ПК, и для обычных).
        const newQty = Number(extra.quantity)
        setOrder(prev => {
          if (!prev) return prev
          const items = prev.items.map((it, i) => i === itemIdx ? { ...it, quantity: newQty } : it)
          const total = items.reduce((s, it) => it.item_status === "returned" ? s : s + (it.final_price ?? it.price) * it.quantity, 0)
          return { ...prev, items, total }
        })
      } else if (order?.order_type === "pc_build") {
        // Прочие ПК-действия меняют состав сборки — нужен полный рефетч.
        await load()
      } else if (res.items) {
        // Обычный заказ: обновляем локально без перезагрузки — цена/сумма налету
        setOrder(prev => prev ? { ...prev, items: res.items, total: res.items.reduce((s: number, it: OrderItem) => s + (it.final_price ?? it.price) * it.quantity, 0) } : prev)
      }
    }
    return res
  }

  const saveBuildQty = async () => {
    if (!id || buildQtyInput < 1) return
    setBuildQtySaving(true)
    await api.orders.updateItem({ id: Number(id), action: "set_build_qty", item_idx: 0, build_qty: buildQtyInput })
    await load()
    setBuildQtySaving(false)
    setEditBuildQty(false)
  }

  const doWriteoff = async () => {
    setWriteoffLoading(true)
    const res = await api.orders.updateItem({ id: Number(id), action: "writeoff_order", item_idx: 0 })
    setWriteoffLoading(false)
    if (res.error === "remaining_unpaid") {
      setShowWriteoff(false)
      setShowRemaining(true)
      return
    }
    setShowWriteoff(false)
    if (res.ok) {
      await load()
    }
  }

  // ── Поиск товаров ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchQ || searchQ.length < 2) { setSearchResults([]); return }
    let cancelled = false
    setSearchLoading(true)
    fetch(`${PRODUCTS_URL}?search=${encodeURIComponent(searchQ)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setSearchResults(Array.isArray(d.products) ? d.products : []); setSearchLoading(false) } })
      .catch(() => { if (!cancelled) setSearchLoading(false) })
    return () => { cancelled = true }
  }, [searchQ])

  useEffect(() => {
    if (!addSearchQ || addSearchQ.length < 2) { setAddSearchResults([]); return }
    let cancelled = false
    setAddSearchLoading(true)
    fetch(`${PRODUCTS_URL}?search=${encodeURIComponent(addSearchQ)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setAddSearchResults(Array.isArray(d.products) ? d.products : []); setAddSearchLoading(false) } })
      .catch(() => { if (!cancelled) setAddSearchLoading(false) })
    return () => { cancelled = true }
  }, [addSearchQ])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!order) return (
    <div className="flex items-center justify-center min-h-screen bg-background text-foreground/50">
      Заказ не найден
    </div>
  )

  const total = order.items.reduce((s, it) => it.item_status === "returned" ? s : s + (it.final_price ?? it.price) * it.quantity, 0)
  // Заказ комплектующих: предоплаты нет, оплата целиком при выдаче.
  const isParts = order.order_type !== "pc_build"

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Шапка */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <button onClick={() => navigate("/admin/orders")}
            className="flex items-center gap-2 text-foreground/50 hover:text-foreground transition-colors text-sm"
            style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={16} />
            Назад к заказам
          </button>
          <div className="flex-1" />
          <span className="font-mono text-xs text-foreground/40">{order.display_number || "#" + order.id}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${(STATUS_LABELS[order.status] || STATUS_LABELS.new).color}`}>
            {(STATUS_LABELS[order.status] || STATUS_LABELS.new).label}
          </span>
          {order.order_type === "pc_build" && order.status !== "new" && order.status !== "done" && order.status !== "cancelled" && (
            <button
              onClick={syncOrder}
              disabled={syncLoading}
              style={{ cursor: "pointer" }}
              className="flex items-center gap-2 rounded-lg border border-yellow-400/40 bg-yellow-400/5 px-4 py-2 text-sm font-medium text-yellow-400 hover:bg-yellow-400/10 transition-colors disabled:opacity-50"
            >
              <Icon name={syncLoading ? "Loader" : "RefreshCw"} size={15} className={syncLoading ? "animate-spin" : ""} />
              Синхронизировать заказ
            </button>
          )}
          {order.status !== "done" && order.status !== "cancelled" && (
            <button
              onClick={() => { setShowAddItem(v => !v); setAddSearchQ(""); setAddSearchResults([]) }}
              style={{ cursor: "pointer" }}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${showAddItem ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:text-foreground hover:border-primary"}`}
            >
              <Icon name="PackagePlus" size={15} />
              Добавить со склада
            </button>
          )}
          <button
            onClick={downloadWarranty}
            disabled={warrantyLoading}
            style={{ cursor: "pointer" }}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/70 hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
          >
            <Icon name={warrantyLoading ? "Loader" : "FileText"} size={15} className={warrantyLoading ? "animate-spin" : ""} />
            Гарантийка
          </button>
          <button
            onClick={() => setContractOpen(true)}
            disabled={contractLoading}
            style={{ cursor: "pointer" }}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/70 hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
          >
            <Icon name={contractLoading ? "Loader" : "FileSignature"} size={15} className={contractLoading ? "animate-spin" : ""} />
            Договор поставки
          </button>
          {/* Заказ комплектующих: предоплаты нет — деньги берём целиком при
              выдаче. Для сборок ПК предоплата осталась (см. раздел сборок). */}
          {order.status !== "done" && order.status !== "cancelled" && isParts && order.prepayment_confirmed && (
            <span className="flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2 text-xs font-medium text-green-400">
              <Icon name="CheckCircle2" size={14} />
              Внесено {fmt(order.prepayment_amount ?? 0)}
            </span>
          )}
          {order.status !== "done" && order.status !== "cancelled" && !isParts && !order.prepayment_confirmed && (
            <button
              onClick={() => setShowPrepay(true)}
              style={{ cursor: "pointer" }}
              className="flex items-center gap-2 rounded-lg border border-primary/50 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              <Icon name="BadgeRussianRuble" size={15} />
              Внести предоплату
            </button>
          )}
          {order.status !== "done" && order.status !== "cancelled" && !isParts && order.prepayment_confirmed && !order.remaining_paid && (
            <span className="flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2 text-xs font-medium text-green-400">
              <Icon name="CheckCircle2" size={14} />
              Предоплата {fmt(order.prepayment_amount ?? 0)}
            </span>
          )}
          {order.status !== "done" && order.status !== "cancelled" && (
            <button
              onClick={() => { if (order.remaining_paid) setShowWriteoff(true); else setShowRemaining(true) }}
              style={{ cursor: "pointer" }}
              className="flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 transition-colors"
            >
              <Icon name="PackageCheck" size={15} />
              Выдать заказ
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6" style={{ zoom: uiScale }}>
        {/* Результат синхронизации */}
        {syncResult && (
          <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Icon name="RefreshCw" size={15} className="text-yellow-400" />
                <span className="text-sm font-medium">Результат синхронизации</span>
              </div>
              <button onClick={() => setSyncResult(null)} className="text-foreground/30 hover:text-foreground/60" style={{cursor:"pointer"}}>
                <Icon name="X" size={14} />
              </button>
            </div>
            {syncResult.auto_status === "waiting_assembly" && (
              <div className="mb-3 rounded-lg bg-green-400/10 border border-green-400/20 px-3 py-2 text-sm text-green-400">
                Всё железо в наличии — статус переведён в «Ожидание сборки»
              </div>
            )}
            {syncResult.reserved.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-foreground/50 mb-1">Зарезервировано ({syncResult.reserved.length}):</p>
                {syncResult.reserved.map((r, i) => (
                  <p key={i} className="text-xs text-green-400">✓ {r.name} <span className="text-foreground/30">({r.slot})</span></p>
                ))}
              </div>
            )}
            {syncResult.need_order.length > 0 && (
              <div>
                <p className="text-xs text-foreground/50 mb-1">Нужно заказать ({syncResult.need_order.length}):</p>
                {syncResult.need_order.map((r, i) => (
                  <p key={i} className="text-xs text-orange-400">⚠ {r.name} <span className="text-foreground/30">({r.slot})</span></p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Инфо о заказе */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-foreground/40 mb-1">Покупатель</p>
              {editCustomer ? (
                <div className="flex flex-col gap-1.5">
                  <input value={custName} onChange={e => setCustName(e.target.value)} placeholder="Имя клиента"
                    className="w-56 rounded border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                  <input value={custPhone} onChange={e => setCustPhone(e.target.value)} placeholder="Телефон"
                    className="w-56 rounded border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                  <div className="flex items-center gap-1.5">
                    <button onClick={saveCustomer} disabled={custSaving}
                      className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" style={{ cursor: "pointer" }}>
                      <Icon name={custSaving ? "Loader" : "Check"} size={12} className={custSaving ? "animate-spin" : ""} />Сохранить
                    </button>
                    <button onClick={() => setEditCustomer(false)}
                      className="rounded border border-border px-2.5 py-1 text-xs text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>Отмена</button>
                  </div>
                </div>
              ) : (
                <div className="group flex items-start gap-2">
                  <div>
                    <p className="font-medium">{order.customer_name}</p>
                    <p className="text-sm text-foreground/60">{order.customer_phone}</p>
                    {order.customer_email && <p className="text-sm text-foreground/50">{order.customer_email}</p>}
                  </div>
                  <button onClick={startEditCustomer} title="Изменить данные клиента"
                    className="mt-0.5 rounded p-1 text-foreground/30 hover:bg-muted hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Pencil" size={13} />
                  </button>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-foreground/40 mb-1">Тип заказа</p>
              <p className="text-sm">{order.order_type === "pc_build" ? "Сборка ПК" : "Комплектующие"}</p>
            </div>
            <div>
              <p className="text-xs text-foreground/40 mb-1">Источник клиента</p>
              <div className="flex items-center gap-1.5">
                <select
                  value={order.source_id ?? ""}
                  onChange={e => changeSource(e.target.value ? Number(e.target.value) : null)}
                  disabled={sourceSaving}
                  className="w-52 rounded border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
                  style={{ cursor: "pointer" }}>
                  <option value="">— не указан —</option>
                  {sources.map(s => (
                    <option key={s.id} value={s.id}>{s.group_name ? `${s.group_name}: ${s.name}` : s.name}</option>
                  ))}
                </select>
                {sourceSaving && <Icon name="Loader" size={13} className="animate-spin text-foreground/40" />}
              </div>
              {order.utm_source && (
                <p className="text-[10px] text-foreground/40 mt-1">UTM: {order.utm_source}{order.utm_medium ? ` / ${order.utm_medium}` : ""}</p>
              )}
            </div>
            {order.order_type === "pc_build" && (
              <div>
                <p className="text-xs text-foreground/40 mb-1">Кол-во ПК</p>
                {editBuildQty ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={1} value={buildQtyInput}
                      onChange={e => setBuildQtyInput(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 rounded border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
                      style={{ cursor: "text" }}
                    />
                    <button onClick={saveBuildQty} disabled={buildQtySaving}
                      className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      style={{ cursor: "pointer" }}>
                      {buildQtySaving ? "..." : "✓"}
                    </button>
                    <button onClick={() => setEditBuildQty(false)}
                      className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                      <Icon name="X" size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{order._build_qty ?? 1} шт.</p>
                    {order.status === "new" && (
                      <button onClick={() => { setBuildQtyInput(order._build_qty ?? 1); setEditBuildQty(true) }}
                        className="text-foreground/30 hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name="Pencil" size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <div>
              <p className="text-xs text-foreground/40 mb-1">Дата</p>
              <p className="text-sm">{new Date(order.created_at).toLocaleDateString("ru-RU")}</p>
            </div>
            {order.comment && (
              <div>
                <p className="text-xs text-foreground/40 mb-1">Комментарий</p>
                <p className="text-sm text-foreground/70">{order.comment}</p>
              </div>
            )}
            <div className="ml-auto text-right">
              <p className="text-xs text-foreground/40 mb-1">Итого</p>
              <p className="text-xl font-bold">{fmt(total)}</p>
            </div>
            <div className="text-right min-w-[160px]">
              <p className="text-xs text-foreground/40 mb-1">Предоплата и остаток</p>
              <PrepaymentEditor
                total={total}
                percent={order.prepayment_percent}
                amount={order.prepayment_amount}
                highlight={order.status === "done"}
                defaultPercent={order.is_stock_sale ? 0 : 30}
                onSave={async (payload) => {
                  const res = await api.orders.setPrepayment({ id: order.id, ...payload })
                  setOrder(prev => prev ? { ...prev, prepayment_percent: res.prepayment_percent, prepayment_amount: res.prepayment_amount, remaining_amount: res.remaining_amount } : prev)
                  return res
                }}
              />
            </div>
          </div>
        </div>

        {/* Баннер: гарантийные случаи (RMA) по заказу */}
        {rmaList.length > 0 && (
          <div className="rounded-xl border border-orange-400/30 bg-orange-400/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Icon name="ShieldAlert" size={16} className="text-orange-400" />
              <span className="text-sm font-medium text-foreground">Гарантийные случаи по заказу ({rmaList.length})</span>
            </div>
            <div className="space-y-1.5">
              {rmaList.map(r => (
                <button key={r.id} onClick={() => navigate(`/admin/rma?id=${r.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-orange-400/20 bg-card/40 px-3 py-2 text-left text-sm hover:bg-orange-400/10 transition-colors"
                  style={{ cursor: "pointer" }}>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{r.item_name}{r.qty > 1 ? ` ×${r.qty}` : ""}</p>
                    <p className="text-xs text-foreground/40">
                      RMA #{r.id} · {r.status_label || RMA_STATUS_LABELS[r.status] || r.status} · {new Date(r.created_at).toLocaleDateString("ru-RU")}
                    </p>
                  </div>
                  <Icon name="ChevronRight" size={15} className="shrink-0 text-orange-400/60" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Панель добавления товара */}
        {showAddItem && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-sm font-medium mb-3">Добавить товар со склада</p>
            <div className="mb-2 flex items-center gap-2">
              <label className="text-xs text-foreground/60">Кол-во:</label>
              <input
                type="number"
                min={1}
                value={addQty}
                onChange={e => setAddQty(Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
                className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-center focus:border-primary focus:outline-none"
                style={{ cursor: "text" }}
              />
            </div>
            <input
              autoFocus
              value={addSearchQ}
              onChange={e => setAddSearchQ(e.target.value)}
              placeholder="Поиск товара по названию..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              style={{ cursor: "text" }}
            />
            {addSearchLoading && (
              <div className="flex items-center gap-2 py-4 text-foreground/40 text-sm">
                <Icon name="Loader" size={14} className="animate-spin" />
                Ищу...
              </div>
            )}
            {addSearchResults.length > 0 && (
              <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                {addSearchResults.map(p => (
                  <button key={p.id}
                    disabled={addingItem}
                    onClick={async () => {
                      setAddingItem(true)
                      const res = await api.orders.updateItem({ id: Number(id), action: "add_item", item_idx: 0, new_product_id: p.id, quantity: addQty })
                      setAddingItem(false)
                      if (res.error) { alert(res.error); return }
                      await load()
                      setShowAddItem(false)
                      setAddSearchQ("")
                      setAddSearchResults([])
                      setAddQty(1)
                    }}
                    style={{ cursor: "pointer" }}
                    className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm bg-background hover:bg-muted border border-border hover:border-primary/30 transition-colors text-left disabled:opacity-50">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="text-xs text-foreground/40 mt-0.5">
                        {typeof p.category === "object" ? (p.category as {name: string})?.name : p.category}
                      </p>
                    </div>
                    <div className="shrink-0 ml-3 text-right">
                      <p className="text-sm font-bold text-primary">{fmt(p.price)}</p>
                      <p className="text-xs text-foreground/40">за шт.</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {addSearchQ.length >= 2 && !addSearchLoading && addSearchResults.length === 0 && (
              <p className="mt-3 text-center text-sm text-foreground/40">Ничего не найдено</p>
            )}
            {addSearchQ.length === 0 && (
              <p className="mt-3 text-center text-xs text-foreground/30">Начните вводить название товара</p>
            )}
          </div>
        )}

        {/* Позиции */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-medium">Позиции заказа</h2>
            <div className="relative flex items-center gap-1.5">
              <button
                onClick={toggleVoice}
                style={{ cursor: "pointer" }}
                title="Озвучивать название железки при сканировании серийников"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  voiceOn
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-foreground/50 hover:text-foreground hover:border-primary"
                }`}>
                <Icon name={voiceOn ? "Volume2" : "VolumeX"} size={14} />
                Озвучка {voiceOn ? "вкл" : "выкл"}
              </button>
              <button
                onClick={() => setVoiceSettingsOpen(o => !o)}
                style={{ cursor: "pointer" }}
                title="Настройки голоса"
                className={`inline-flex items-center justify-center rounded-lg border h-[30px] w-[30px] transition-colors ${
                  voiceSettingsOpen ? "border-primary text-primary" : "border-border text-foreground/50 hover:text-foreground hover:border-primary"
                }`}>
                <Icon name="Settings2" size={14} />
              </button>

              {voiceSettingsOpen && (
                <div className="absolute right-0 top-full mt-2 z-30 w-72 rounded-xl border border-border bg-background p-4 shadow-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Настройки голоса</p>
                    <button onClick={() => setVoiceSettingsOpen(false)} style={{ cursor: "pointer" }} className="text-foreground/40 hover:text-foreground">
                      <Icon name="X" size={15} />
                    </button>
                  </div>

                  <div>
                    <label className="text-xs text-foreground/50 mb-1 block">Голос</label>
                    <select
                      value={voiceName}
                      onChange={e => { setVoiceNameState(e.target.value); setVoiceSetting("name", e.target.value) }}
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none">
                      <option value="">Авто (лучший)</option>
                      {voices.map(v => (
                        <option key={v.name} value={v.name}>{v.name}{v.localService ? "" : " ☁"}</option>
                      ))}
                    </select>
                    {voices.length === 0 && (
                      <p className="text-[10px] text-foreground/40 mt-1">Голоса не найдены — включите озвучку и обновите страницу.</p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-foreground/50 mb-1 flex justify-between">
                      <span>Скорость</span><span className="text-foreground/40">{voiceRate.toFixed(2)}×</span>
                    </label>
                    <input type="range" min={0.5} max={2} step={0.05} value={voiceRate}
                      onChange={e => { const n = Number(e.target.value); setVoiceRateState(n); setVoiceSetting("rate", n) }}
                      className="w-full accent-primary" style={{ cursor: "pointer" }} />
                  </div>

                  <div>
                    <label className="text-xs text-foreground/50 mb-1 flex justify-between">
                      <span>Тон</span><span className="text-foreground/40">{voicePitch.toFixed(2)}</span>
                    </label>
                    <input type="range" min={0.5} max={2} step={0.05} value={voicePitch}
                      onChange={e => { const n = Number(e.target.value); setVoicePitchState(n); setVoiceSetting("pitch", n) }}
                      className="w-full accent-primary" style={{ cursor: "pointer" }} />
                  </div>

                  <button
                    onClick={() => { setVoiceEnabled(true); setVoiceOn(true); speak("Проверка голоса. Процессор, видеокарта, оперативная память.") }}
                    style={{ cursor: "pointer" }}
                    className="w-full rounded-lg border border-primary bg-primary/15 text-primary px-3 py-1.5 text-xs hover:bg-primary/25 transition-colors inline-flex items-center justify-center gap-1.5">
                    <Icon name="Play" size={13} /> Прослушать
                  </button>
                </div>
              )}
            </div>
          </div>

          {order.items.map((item, idx) => {
            const isAssembly = item.item_type === "assembly"
            const itemStatus = item.item_status || "reserved"
            const statusInfo = ITEM_STATUS[itemStatus] || ITEM_STATUS.reserved
            const finalPrice = item.final_price ?? item.price
            const supplies = item._supplies || []
            const totalReserved = supplies.reduce((s, s2) => s + s2.qty_reserved, 0)
            const totalFree = supplies.reduce((s, s2) => s + s2.free, 0)

            // Строка услуги (сборка)
            if (isAssembly) return (
              <div key={idx} className="rounded-xl border border-accent/20 bg-card p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    {item.slot_label && <p className="text-xs text-foreground/40 mb-0.5">{item.slot_label}</p>}
                    <p className="font-medium">{item.name}</p>
                  </div>
                  <p className="text-lg font-bold shrink-0">{fmt(finalPrice)}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-foreground/40 mb-1.5 block">Серийный номер</label>
                    <SerialInput
                      value={(item.serial_numbers?.[0]) || ""}
                      saving={saving === `set_serial-${idx}-0`}
                      onSave={val => callPut("set_serial", idx, { serial_numbers: [val], slot: "assembly" })}
                    />
                  </div>
                  <PriceInput
                    value={finalPrice}
                    saving={saving === `set_price-${idx}`}
                    onSave={val => callPut("set_price", idx, { price: val, slot: "assembly" })}
                  />
                  <WarrantyInput
                    value={item.warranty_months ?? 12}
                    saving={saving === `set_warranty-${idx}`}
                    onSave={val => callPut("set_warranty", idx, { warranty_months: val })}
                  />
                </div>
              </div>
            )

            return (
              <div key={idx} className={`rounded-xl border bg-card p-5 transition-colors ${
                itemStatus === "returned" ? "border-border opacity-50 grayscale" :
                itemStatus === "issued" ? "border-green-400/20" :
                item.wip_status === "ready" ? "border-green-400/20" :
                item.wip_status === "need_order" ? "border-red-400/20" :
                item.wip_status === "ordered_transit" ? "border-yellow-400/20" :
                item.wip_status === "ordered_delay" ? "border-orange-400/20" :
                "border-border"
              }`}>
                {/* Заголовок позиции */}
                <div className="flex flex-wrap items-start gap-3 mb-4">
                  <div className="flex-1 min-w-0">
                    {item.slot_label && <p className="text-xs text-foreground/40 mb-0.5">{item.slot_label}</p>}
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{item.name}</p>
                      {item.preorder && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-primary bg-primary/10">
                          <Icon name="Clock" size={11} />
                          Под заказ
                        </span>
                      )}
                      {item.item_status && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
                          <Icon name={statusInfo.icon as "Clock"} size={11} />
                          {statusInfo.label}
                        </span>
                      )}
                      {item.wip_status && (() => {
                        const WIP_STATUS_STYLE: Record<string, {label: string, color: string}> = {
                          ready:           { label: "Есть",      color: "text-green-400 bg-green-400/10" },
                          need_order:      { label: "Заказать",  color: "text-red-400 bg-red-400/10" },
                          ordered_transit: { label: "В пути",    color: "text-yellow-400 bg-yellow-400/10" },
                          ordered_delay:   { label: "Задержка",  color: "text-orange-400 bg-orange-400/10" },
                          pending:         { label: "Ожидание",  color: "text-foreground/40 bg-muted" },
                        }
                        const ws = WIP_STATUS_STYLE[item.wip_status] || WIP_STATUS_STYLE.pending
                        const reservedForOrder = supplies.reduce((s, s2) => s + (s2.reserved_for_order || 0), 0)
                        const needToOrder = item.wip_status === "need_order"
                          ? Math.max(0, item.quantity - reservedForOrder)
                          : 0
                        return (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ws.color}`}>
                            {ws.label}
                            {needToOrder > 0 && (
                              <span className="font-bold">— {needToOrder} шт.</span>
                            )}
                          </span>
                        )
                      })()}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {item.item_type === "product" && itemStatus !== "issued" ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-foreground/40">Кол-во:</span>
                          <button
                            onClick={() => { if (item.quantity > 1) callPut("change_qty", idx, { quantity: item.quantity - 1, slot: item.slot || null, product_id: item.id }) }}
                            disabled={item.quantity <= 1 || saving === `change_qty-${idx}`}
                            style={{ cursor: "pointer" }}
                            className="flex h-5 w-5 items-center justify-center rounded border border-border text-foreground/50 hover:text-foreground hover:border-primary transition-colors disabled:opacity-30">
                            <Icon name="Minus" size={10} />
                          </button>
                          <span className="w-6 text-center text-xs font-medium text-foreground">
                            {saving === `change_qty-${idx}` ? <Icon name="Loader" size={10} className="animate-spin mx-auto" /> : item.quantity}
                          </span>
                          <button
                            onClick={() => callPut("change_qty", idx, { quantity: item.quantity + 1, slot: item.slot || null, product_id: item.id })}
                            disabled={saving === `change_qty-${idx}`}
                            style={{ cursor: "pointer" }}
                            className="flex h-5 w-5 items-center justify-center rounded border border-border text-foreground/50 hover:text-foreground hover:border-primary transition-colors disabled:opacity-30">
                            <Icon name="Plus" size={10} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-foreground/40">Кол-во: {item.quantity}</span>
                      )}
                      {totalReserved > 0 && <span className="text-xs text-yellow-400">В резерве: {totalReserved}</span>}
                      {totalFree > 0 && <span className="text-xs text-foreground/40">Свободно: {totalFree}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {item.final_price !== undefined && item.final_price !== item.price && (
                      <p className="text-xs text-foreground/40 line-through">{fmt(item.price * item.quantity)}</p>
                    )}
                    <p className="text-lg font-bold">{fmt(finalPrice * item.quantity)}</p>
                    {item.quantity > 1 && (
                      <p className="text-xs text-foreground/40">{fmt(finalPrice)} × {item.quantity} шт.</p>
                    )}
                  </div>
                </div>

                {/* Поля редактирования */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {/* Серийные номера. Для ОЗУ — поле на каждую планку (ram_modules) × кол-во */}
                  {(() => {
                    const perUnit = item.slot === "ram" && item.ram_modules && item.ram_modules > 1
                      ? item.ram_modules : 1
                    const fieldCount = perUnit * item.quantity
                    const multi = fieldCount > 1
                    return (
                  <div className={multi ? "sm:col-span-2" : ""}>
                    <label className="text-xs text-foreground/40 mb-1.5 block">
                      Серийный номер{multi ? ` (${fieldCount} шт.${perUnit > 1 ? `, ${perUnit} планки` : ""})` : ""}
                    </label>
                    <div className="space-y-1.5">
                      {Array.from({ length: fieldCount }).map((_, qIdx) => {
                        const serials = item.serial_numbers || (item.serial_number ? [item.serial_number] : [])
                        return (
                          <div key={qIdx} className="flex items-center gap-1">
                            {multi && <span className="text-xs text-foreground/30 shrink-0 w-5 text-right">#{qIdx + 1}</span>}
                            <SerialInput
                              value={serials[qIdx] || ""}
                              itemName={item.name}
                              saving={saving === `set_serial-${idx}-${qIdx}`}
                              onSave={val => {
                                const next = Array.from({ length: fieldCount }, (_, i) =>
                                  (item.serial_numbers || [])[i] || ""
                                )
                                next[qIdx] = val
                                callPut("set_serial", idx, { serial_numbers: next, slot: item.slot || null })
                              }}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                    )
                  })()}

                  {/* Финальная цена */}
                  <PriceInput
                    value={finalPrice}
                    saving={saving === `set_price-${idx}`}
                    onSave={val => callPut("set_price", idx, { price: val, slot: item.slot || null })}
                  />
                </div>

                {/* Кнопки действий */}
                <div className="flex flex-wrap gap-2">
                  {/* Статус */}
                  {["reserved", "issued"].map(s => (
                    <button key={s}
                      onClick={() => callPut("set_status", idx, { item_status: s })}
                      disabled={itemStatus === s || saving === `set_status-${idx}`}
                      style={{ cursor: "pointer" }}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                        itemStatus === s
                          ? `${ITEM_STATUS[s].color} border-current/20`
                          : "border-border text-foreground/50 hover:text-foreground"
                      } disabled:opacity-50`}>
                      <Icon name={ITEM_STATUS[s].icon as "Clock"} size={12} />
                      {ITEM_STATUS[s].label}
                    </button>
                  ))}

                  {/* Снять с резерва (вернуть на склад) */}
                  {item.item_type === "product" && itemStatus !== "returned" && itemStatus !== "issued" && (
                    <button
                      onClick={async () => { await callPut("unreserve", idx); load() }}
                      disabled={saving === `unreserve-${idx}`}
                      style={{ cursor: "pointer" }}
                      className="flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50">
                      <Icon name={saving === `unreserve-${idx}` ? "Loader" : "Undo2"} size={12}
                        className={saving === `unreserve-${idx}` ? "animate-spin" : ""} />
                      Вернуть на склад
                    </button>
                  )}

                  {/* Вернуть товар обратно в заказ (для возвращённых) */}
                  {item.item_type === "product" && itemStatus === "returned" && (
                    <button
                      onClick={async () => { await callPut("restore_item", idx); load() }}
                      disabled={saving === `restore_item-${idx}`}
                      style={{ cursor: "pointer" }}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground/60 hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50">
                      <Icon name={saving === `restore_item-${idx}` ? "Loader" : "Undo2"} size={12}
                        className={saving === `restore_item-${idx}` ? "animate-spin" : ""} />
                      Вернуть товар в заказ
                    </button>
                  )}

                  {/* Заменить товар */}
                  {item.item_type === "product" && (
                    <button
                      onClick={() => {
                        if (replaceIdx === idx) { setReplaceIdx(null); setSearchQ(""); setSearchResults([]) }
                        else { setReplaceIdx(idx); setSearchQ(""); setSearchResults([]) }
                      }}
                      style={{ cursor: "pointer" }}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${replaceIdx === idx ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/50 hover:text-foreground"}`}>
                      <Icon name="RefreshCw" size={12} className={replaceIdx === idx ? "text-primary" : ""} />
                      {replaceIdx === idx ? "Закрыть" : "Заменить товар"}
                    </button>
                  )}
                </div>

                {/* Инлайн-панель замены — как в конфигураторе */}
                {replaceIdx === idx && item.item_type === "product" && (
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <p className="text-xs text-foreground/50 mb-3">
                      Выберите замену для: <span className="text-foreground font-medium">{item.name}</span>
                    </p>
                    <input
                      autoFocus
                      value={searchQ}
                      onChange={e => setSearchQ(e.target.value)}
                      placeholder="Поиск товара по названию..."
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                      style={{ cursor: "text" }}
                    />
                    {searchLoading && (
                      <div className="flex items-center gap-2 py-4 text-foreground/40 text-sm">
                        <Icon name="Loader" size={14} className="animate-spin" />
                        Ищу...
                      </div>
                    )}
                    {searchResults.length > 0 && (
                      <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                        {searchResults.map(p => (
                          <button key={p.id}
                            onClick={async () => {
                              await callPut("replace_item", idx, { new_product_id: p.id, slot: item.slot })
                              await load()
                              setReplaceIdx(null)
                              setSearchQ("")
                              setSearchResults([])
                            }}
                            style={{ cursor: "pointer" }}
                            className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm bg-background hover:bg-muted border border-border hover:border-primary/30 transition-colors text-left">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium truncate">{p.name}</p>
                              <p className="text-xs text-foreground/40 mt-0.5">
                                {typeof p.category === "object" ? (p.category as {name: string})?.name : p.category}
                              </p>
                            </div>
                            <div className="shrink-0 ml-3 text-right">
                              <p className="text-sm font-bold text-primary">{fmt(p.price)}</p>
                              <p className="text-xs text-foreground/40">за шт.</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchQ.length >= 2 && !searchLoading && searchResults.length === 0 && (
                      <p className="mt-3 text-center text-sm text-foreground/40">Ничего не найдено</p>
                    )}
                    {searchQ.length === 0 && (
                      <p className="mt-3 text-center text-xs text-foreground/30">Начните вводить название товара</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Итог */}
        <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-between">
          <span className="text-foreground/60">Итого по заказу</span>
          <span className="text-2xl font-bold">{fmt(total)}</span>
        </div>
      </div>

      {/* Диалог печати договора поставки */}
      <ContractDialog
        open={contractOpen}
        onClose={() => setContractOpen(false)}
        onPrint={printContract}
        loading={contractLoading}
        defaultName={order?.customer_name}
        defaultPhone={order?.customer_phone}
        defaultPrepay={order?.prepayment_amount ?? (total ? total * 0.3 : null)}
      />

      {/* Модалка выдачи / списания */}
      {showWriteoff && order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={e => { if (e.target === e.currentTarget && !writeoffLoading) setShowWriteoff(false) }}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/15">
                <Icon name="PackageCheck" size={20} className="text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold">Выдать заказ #{order.id}</h3>
                <p className="text-xs text-foreground/50">Товары будут списаны со склада</p>
              </div>
            </div>

            {/* Перечень списываемых товаров */}
            <div className="rounded-xl border border-border bg-background mb-4 divide-y divide-border">
              {order.items.filter(it => it.item_status !== "returned" && it.item_type === "product").map((it, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{it.name}</p>
                    {it.serial_numbers?.filter(Boolean).length ? (
                      <p className="text-xs text-foreground/40 font-mono mt-0.5">
                        S/N: {it.serial_numbers.filter(Boolean).join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className="text-sm font-medium text-green-400">−{it.quantity} шт.</span>
                    <p className="text-xs text-foreground/40">{fmt((it.final_price ?? it.price) * it.quantity)}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowWriteoff(false)} disabled={writeoffLoading}
                style={{ cursor: "pointer" }}
                className="flex-1 rounded-lg border border-border py-2.5 text-sm text-foreground/60 hover:text-foreground transition-colors disabled:opacity-40">
                Отмена
              </button>
              <button onClick={doWriteoff} disabled={writeoffLoading}
                style={{ cursor: "pointer" }}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-green-500 py-2.5 text-sm font-medium text-white hover:bg-green-600 transition-colors disabled:opacity-60">
                {writeoffLoading
                  ? <><Icon name="Loader" size={15} className="animate-spin" /> Списываю...</>
                  : <><Icon name="Check" size={15} /> Подтвердить выдачу</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка внесения предоплаты */}
      {showPrepay && order && (
        <PrepaymentConfirmModal
          orderId={order.id}
          total={total}
          mode="prepayment"
          defaultAmount={order.prepayment_amount}
          onClose={() => setShowPrepay(false)}
          onConfirmed={() => { setShowPrepay(false); load() }}
        />
      )}

      {/* Модалка оплаты остатка (перед выдачей) */}
      {showRemaining && order && (
        <PrepaymentConfirmModal
          orderId={order.id}
          total={total}
          mode={isParts && !order.prepayment_confirmed ? "full" : "remaining"}
          defaultAmount={Math.max(0, total - (order.prepayment_confirmed ? (order.prepayment_amount ?? 0) : 0))}
          onClose={() => setShowRemaining(false)}
          onConfirmed={() => { setShowRemaining(false); load().then(() => setShowWriteoff(true)) }}
        />
      )}

    </div>
  )
}

// ── Компонент ввода серийного номера ──────────────────────────────────────────
// Звук подтверждения сохранения
function playConfirmSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
    osc.start(); osc.stop(ctx.currentTime + 0.15)
  } catch (_) { /* AudioContext недоступен */ }
}

// ── Голосовое сопровождение (Web Speech API, улучшенное) ──────────────────────
const VOICE_KEY = "serial_voice_enabled"
const VOICE_NAME_KEY = "serial_voice_name"   // выбранный голос (по имени)
const VOICE_RATE_KEY = "serial_voice_rate"   // скорость 0.5–2
const VOICE_PITCH_KEY = "serial_voice_pitch" // тон 0.5–2

export function isVoiceEnabled(): boolean {
  try { return localStorage.getItem(VOICE_KEY) === "1" } catch { return false }
}
export function setVoiceEnabled(on: boolean) {
  try { localStorage.setItem(VOICE_KEY, on ? "1" : "0") } catch { /* недоступно */ }
}
export function getVoiceRate(): number {
  try { return Number(localStorage.getItem(VOICE_RATE_KEY)) || 1 } catch { return 1 }
}
export function getVoicePitch(): number {
  try { return Number(localStorage.getItem(VOICE_PITCH_KEY)) || 1 } catch { return 1 }
}
export function getVoiceName(): string {
  try { return localStorage.getItem(VOICE_NAME_KEY) || "" } catch { return "" }
}
export function setVoiceSetting(key: "name" | "rate" | "pitch", val: string | number) {
  try {
    const k = key === "name" ? VOICE_NAME_KEY : key === "rate" ? VOICE_RATE_KEY : VOICE_PITCH_KEY
    localStorage.setItem(k, String(val))
  } catch { /* недоступно */ }
}

// Список доступных русских голосов (с «прогревом» — голоса грузятся асинхронно)
export function getRussianVoices(): SpeechSynthesisVoice[] {
  try {
    const synth = window.speechSynthesis
    if (!synth) return []
    return synth.getVoices().filter(v => v.lang.toLowerCase().startsWith("ru"))
  } catch { return [] }
}

// Выбор «лучшего» русского голоса: приоритет качественным движкам
function pickBestVoice(): SpeechSynthesisVoice | undefined {
  const voices = getRussianVoices()
  if (!voices.length) return undefined
  const saved = getVoiceName()
  if (saved) {
    const found = voices.find(v => v.name === saved)
    if (found) return found
  }
  // Приоритет: Google → Yandex/Alyona → Microsoft → онлайн (не localService) → любой
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase()
    let s = 0
    if (n.includes("google")) s += 100
    if (n.includes("yandex") || n.includes("alyona") || n.includes("milena")) s += 90
    if (n.includes("microsoft") || n.includes("irina") || n.includes("pavel") || n.includes("svetlana")) s += 70
    if (!v.localService) s += 30   // облачные обычно качественнее
    return s
  }
  return [...voices].sort((a, b) => score(b) - score(a))[0]
}

// Чистим название железки для более естественного произношения
function cleanForSpeech(text: string): string {
  return text
    .replace(/[_/|]+/g, " ")        // подчёркивания и слэши → пробел
    .replace(/\s+/g, " ")
    .trim()
}

// Озвучить текст голосом (только если озвучка включена)
export function speak(text: string) {
  if (!text || !isVoiceEnabled()) return
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance(cleanForSpeech(text))
    u.lang = "ru-RU"
    u.rate = Math.min(2, Math.max(0.5, getVoiceRate()))
    u.pitch = Math.min(2, Math.max(0.5, getVoicePitch()))
    u.volume = 1
    const v = pickBestVoice()
    if (v) u.voice = v
    synth.speak(u)
  } catch (_) { /* speechSynthesis недоступен */ }
}

// Прогрев голосов: вызываем заранее, чтобы getVoices() вернул список
export function warmUpVoices(cb?: () => void) {
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    if (synth.getVoices().length === 0) {
      synth.onvoiceschanged = () => { cb?.() }
    } else {
      cb?.()
    }
  } catch { /* недоступно */ }
}

// Переход к следующему пустому полю серийника по всему списку позиций + озвучка его железки.
function focusNextSerial(currentEl: HTMLInputElement | null) {
  try {
    const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-serial-field]"))
    const startIdx = currentEl ? all.indexOf(currentEl) : -1
    // Ищем первое пустое поле ПОСЛЕ текущего, затем — с начала (по кругу)
    const ordered = [...all.slice(startIdx + 1), ...all.slice(0, startIdx + 1)]
    const next = ordered.find(el => el !== currentEl && !el.value.trim())
    if (next) {
      next.focus()
      next.scrollIntoView({ block: "center", behavior: "smooth" })
      const name = next.getAttribute("data-serial-name")
      if (name) speak(name)
    }
  } catch (_) { /* DOM недоступен */ }
}

function SerialInput({ value, saving, onSave, label, itemName }: {
  value: string
  saving: boolean
  onSave: (v: string) => void
  label?: string
  itemName?: string
}) {
  const [v, setV] = useState(value)
  const [flash, setFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => setV(value), [value])

  const handleSave = (val: string) => {
    playConfirmSound()
    setFlash(true)
    setTimeout(() => setFlash(false), 400)
    onSave(val)
    // После пика серийника — переход к следующей железке с озвучкой
    if (val.trim()) setTimeout(() => focusNextSerial(inputRef.current), 120)
  }

  return (
    <div className="flex gap-2 items-center">
      {label && <span className="text-xs text-foreground/30 w-5 shrink-0 text-right">{label}</span>}
      <input
        ref={inputRef}
        data-serial-field="1"
        data-serial-name={itemName || ""}
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSave(v)}
        placeholder="Введите S/N..."
        className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono focus:border-primary focus:outline-none"
      />
      <button onClick={() => handleSave(v)} disabled={saving || v === value}
        style={{ cursor: "pointer" }}
        className={`rounded-lg border px-2.5 py-1.5 text-xs transition-all duration-200 shrink-0 ${
          flash
            ? "border-green-400 bg-green-400/15 text-green-400 scale-110"
            : "border-border text-foreground/50 hover:text-foreground hover:border-primary"
        } disabled:opacity-30`}>
        {saving ? <Icon name="Loader" size={13} className="animate-spin" /> : <Icon name="Check" size={13} />}
      </button>
    </div>
  )
}

// ── Компонент ввода срока гарантии ────────────────────────────────────────────
function WarrantyInput({ value, saving, onSave }: {
  value: number
  saving: boolean
  onSave: (v: number) => void
}) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  return (
    <div>
      <label className="text-xs text-foreground/40 mb-1 block">Гарантия (мес.)</label>
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          value={v}
          onChange={e => setV(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={e => e.key === "Enter" && onSave(Number(v))}
          placeholder="12"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
        />
        <button onClick={() => onSave(Number(v))} disabled={saving || Number(v) === value}
          style={{ cursor: "pointer" }}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/50 hover:text-foreground hover:border-primary transition-colors disabled:opacity-30">
          {saving ? <Icon name="Loader" size={13} className="animate-spin" /> : <Icon name="Check" size={13} />}
        </button>
      </div>
    </div>
  )
}

// ── Компонент ввода финальной цены ────────────────────────────────────────────
function PriceInput({ value, saving, onSave }: {
  value: number
  saving: boolean
  onSave: (v: number) => void
}) {
  const [v, setV] = useState(String(value))
  const [flash, setFlash] = useState(false)
  useEffect(() => setV(String(value)), [value])

  const dirty = Number(v) !== value && v.trim() !== ""

  const handleSave = () => {
    if (!dirty) return
    playConfirmSound()
    setFlash(true)
    setTimeout(() => setFlash(false), 150)
    onSave(Number(v))
  }

  return (
    <div>
      <label className="text-xs text-foreground/40 mb-1 block">Финальная цена (за 1 шт.)</label>
      <div className="flex gap-2">
        <input
          value={v}
          onChange={e => setV(e.target.value.replace(/[^0-9.]/g, ""))}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          placeholder="0"
          className={`flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm focus:outline-none transition-colors ${
            dirty ? "border-amber-400 focus:border-amber-400" : "border-border focus:border-primary"
          }`}
        />
        <button onClick={handleSave} disabled={saving || !dirty}
          style={{ cursor: "pointer" }}
          className={`rounded-lg border px-3 py-1.5 text-xs transition-transform duration-100 ${
            flash ? "scale-90" : ""
          } ${
            dirty
              ? "border-amber-400 bg-amber-400/15 text-amber-400 hover:bg-amber-400/25"
              : "border-border text-foreground/50 hover:text-foreground hover:border-primary"
          } disabled:opacity-30`}>
          {saving ? <Icon name="Loader" size={13} className="animate-spin" /> : <Icon name="Check" size={13} />}
        </button>
      </div>
      {dirty && <p className="text-[10px] text-amber-400/80 mt-1">Нажмите Enter или ✓ для сохранения</p>}
    </div>
  )
}