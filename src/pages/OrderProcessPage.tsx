import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

const ORDERS_URL = "https://functions.poehali.dev/92fb1cdd-4b87-4bcb-8154-75a499dd1745"
const PRODUCTS_URL = "https://functions.poehali.dev/ab453741-d994-4115-9a77-276036d19dbd"

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Новый", color: "text-primary bg-primary/10" },
  processing: { label: "В работе", color: "text-accent bg-accent/10" },
  done: { label: "Выполнен", color: "text-green-400 bg-green-400/10" },
  cancelled: { label: "Отменён", color: "text-foreground/50 bg-muted" },
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
  warranty_months: number
  group_id: number
}

interface OrderItem {
  id: number
  name: string
  price: number
  quantity: number
  item_type: string
  serial_number?: string
  serial_numbers?: string[]
  final_price?: number
  item_status?: string
  _supplies?: Supply[]
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
}

function fmt(n: number) {
  return n.toLocaleString("ru-RU") + " ₽"
}

export default function OrderProcessPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  // Модалка выдачи заказа
  const [showWriteoff, setShowWriteoff] = useState(false)
  const [writeoffLoading, setWriteoffLoading] = useState(false)

  // Поиск товаров для замены
  const [replaceIdx, setReplaceIdx] = useState<number | null>(null)
  const [searchQ, setSearchQ] = useState("")
  const [searchResults, setSearchResults] = useState<{ id: number; name: string; price: number; category: string }[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const data = await api.orders.getById(Number(id))
    setOrder(data.order || null)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const callPut = async (action: string, itemIdx: number, extra: Record<string, unknown> = {}) => {
    setSaving(`${action}-${itemIdx}`)
    const res = await api.orders.updateItem({ id: Number(id), action, item_idx: itemIdx, ...extra })
    setSaving(null)
    if (res.ok && res.items) {
      setOrder(prev => prev ? { ...prev, items: res.items, total: res.items.reduce((s: number, it: OrderItem) => s + (it.final_price ?? it.price) * it.quantity, 0) } : prev)
    }
    return res
  }

  const doWriteoff = async () => {
    setWriteoffLoading(true)
    const res = await api.orders.updateItem({ id: Number(id), action: "writeoff_order", item_idx: 0 })
    setWriteoffLoading(false)
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

  const total = order.items.reduce((s, it) => s + (it.final_price ?? it.price) * it.quantity, 0)

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
          <span className="font-mono text-xs text-foreground/40">#{order.id}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${(STATUS_LABELS[order.status] || STATUS_LABELS.new).color}`}>
            {(STATUS_LABELS[order.status] || STATUS_LABELS.new).label}
          </span>
          {order.status !== "done" && order.status !== "cancelled" && (
            <button
              onClick={() => setShowWriteoff(true)}
              style={{ cursor: "pointer" }}
              className="flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 transition-colors"
            >
              <Icon name="PackageCheck" size={15} />
              Выдать заказ
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* Инфо о заказе */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-foreground/40 mb-1">Покупатель</p>
              <p className="font-medium">{order.customer_name}</p>
              <p className="text-sm text-foreground/60">{order.customer_phone}</p>
              {order.customer_email && <p className="text-sm text-foreground/50">{order.customer_email}</p>}
            </div>
            <div>
              <p className="text-xs text-foreground/40 mb-1">Тип заказа</p>
              <p className="text-sm">{order.order_type === "pc_build" ? "Сборка ПК" : "Комплектующие"}</p>
            </div>
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
          </div>
        </div>

        {/* Позиции */}
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Позиции заказа</h2>

          {order.items.map((item, idx) => {
            const itemStatus = item.item_status || "reserved"
            const statusInfo = ITEM_STATUS[itemStatus] || ITEM_STATUS.reserved
            const finalPrice = item.final_price ?? item.price
            const supplies = item._supplies || []
            const totalReserved = supplies.reduce((s, s2) => s + s2.qty_reserved, 0)
            const totalFree = supplies.reduce((s, s2) => s + s2.free, 0)

            return (
              <div key={idx} className={`rounded-xl border bg-card p-5 transition-colors ${
                itemStatus === "returned" ? "border-red-400/20" :
                itemStatus === "issued" ? "border-green-400/20" : "border-border"
              }`}>
                {/* Заголовок позиции */}
                <div className="flex flex-wrap items-start gap-3 mb-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{item.name}</p>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
                        <Icon name={statusInfo.icon as "Clock"} size={11} />
                        {statusInfo.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-foreground/40">Кол-во: {item.quantity}</span>
                      {totalReserved > 0 && <span className="text-xs text-yellow-400">В резерве: {totalReserved}</span>}
                      {totalFree > 0 && <span className="text-xs text-foreground/40">Свободно: {totalFree}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {item.final_price !== undefined && item.final_price !== item.price && (
                      <p className="text-xs text-foreground/40 line-through">{fmt(item.price * item.quantity)}</p>
                    )}
                    <p className="text-lg font-bold">{fmt(finalPrice * item.quantity)}</p>
                    {item.quantity > 1 && <p className="text-xs text-foreground/40">{fmt(finalPrice)} × {item.quantity}</p>}
                  </div>
                </div>

                {/* Поля редактирования */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {/* Серийные номера — по одному полю на каждую штуку */}
                  <div className={item.quantity > 1 ? "sm:col-span-2" : ""}>
                    <label className="text-xs text-foreground/40 mb-1.5 block">
                      Серийный номер{item.quantity > 1 ? ` (${item.quantity} шт.)` : ""}
                    </label>
                    <div className="space-y-1.5">
                      {Array.from({ length: item.quantity }).map((_, qIdx) => {
                        const serials = item.serial_numbers || (item.serial_number ? [item.serial_number] : [])
                        return (
                          <SerialInput
                            key={qIdx}
                            label={item.quantity > 1 ? `#${qIdx + 1}` : undefined}
                            value={serials[qIdx] || ""}
                            saving={saving === `set_serial-${idx}-${qIdx}`}
                            onSave={val => {
                              const next = Array.from({ length: item.quantity }, (_, i) =>
                                (item.serial_numbers || [])[i] || ""
                              )
                              next[qIdx] = val
                              callPut("set_serial", idx, { serial_numbers: next })
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>

                  {/* Финальная цена */}
                  <PriceInput
                    value={finalPrice}
                    saving={saving === `set_price-${idx}`}
                    onSave={val => callPut("set_price", idx, { price: val })}
                  />
                </div>

                {/* Кнопки действий */}
                <div className="flex flex-wrap gap-2">
                  {/* Статус */}
                  {["reserved", "issued", "returned"].map(s => (
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

                  {/* Снять с резерва */}
                  {totalReserved > 0 && itemStatus !== "returned" && (
                    <button
                      onClick={() => callPut("unreserve", idx)}
                      disabled={saving === `unreserve-${idx}`}
                      style={{ cursor: "pointer" }}
                      className="flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50">
                      <Icon name={saving === `unreserve-${idx}` ? "Loader" : "Undo2"} size={12}
                        className={saving === `unreserve-${idx}` ? "animate-spin" : ""} />
                      Вернуть на склад
                    </button>
                  )}

                  {/* Заменить товар */}
                  {item.item_type === "product" && (
                    <button
                      onClick={() => { setReplaceIdx(idx); setSearchQ(""); setSearchResults([]) }}
                      style={{ cursor: "pointer" }}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/50 hover:text-foreground transition-colors">
                      <Icon name="RefreshCw" size={12} />
                      Заменить товар
                    </button>
                  )}
                </div>
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

      {/* Модалка замены товара */}
      {replaceIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={e => { if (e.target === e.currentTarget) setReplaceIdx(null) }}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Заменить товар</h3>
              <button onClick={() => setReplaceIdx(null)} style={{ cursor: "pointer" }}
                className="text-foreground/40 hover:text-foreground">
                <Icon name="X" size={18} />
              </button>
            </div>
            <p className="text-xs text-foreground/50 mb-3">
              Текущий: <span className="text-foreground">{order.items[replaceIdx]?.name}</span>
            </p>
            <input
              autoFocus
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Поиск нового товара..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none mb-3"
            />
            {searchLoading && <div className="text-center py-4 text-foreground/40 text-sm">Поиск...</div>}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {searchResults.map(p => (
                <button key={p.id}
                  onClick={async () => {
                    await callPut("replace_item", replaceIdx, { new_product_id: p.id })
                    await load()
                    setReplaceIdx(null)
                  }}
                  style={{ cursor: "pointer" }}
                  className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-foreground/40">{typeof p.category === "object" ? (p.category as {name: string})?.name : p.category}</p>
                  </div>
                  <span className="text-primary font-medium shrink-0 ml-3">{fmt(p.price)}</span>
                </button>
              ))}
              {searchQ.length >= 2 && !searchLoading && searchResults.length === 0 && (
                <p className="text-center py-4 text-foreground/40 text-sm">Ничего не найдено</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Компонент ввода серийного номера ──────────────────────────────────────────
function SerialInput({ value, saving, onSave, label }: {
  value: string
  saving: boolean
  onSave: (v: string) => void
  label?: string
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])

  return (
    <div className="flex gap-2 items-center">
      {label && <span className="text-xs text-foreground/30 w-5 shrink-0 text-right">{label}</span>}
      <input
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onSave(v)}
        placeholder="Введите S/N..."
        className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono focus:border-primary focus:outline-none"
      />
      <button onClick={() => onSave(v)} disabled={saving || v === value}
        style={{ cursor: "pointer" }}
        className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:text-foreground hover:border-primary transition-colors disabled:opacity-30 shrink-0">
        {saving ? <Icon name="Loader" size={13} className="animate-spin" /> : <Icon name="Check" size={13} />}
      </button>
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
  useEffect(() => setV(String(value)), [value])

  return (
    <div>
      <label className="text-xs text-foreground/40 mb-1 block">Финальная цена (за 1 шт.)</label>
      <div className="flex gap-2">
        <input
          value={v}
          onChange={e => setV(e.target.value.replace(/[^0-9.]/g, ""))}
          onKeyDown={e => e.key === "Enter" && onSave(Number(v))}
          placeholder="0"
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