import React, { useEffect, useState, useCallback, useRef } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { getAdminKey } from "@/pages/admin/types"
import BrandsManager from "./BrandsManager"
import GroupWizardModal from "./GroupWizardModal"
import ReceiptScanModal from "./ReceiptScanModal"
import type {
  Store, Supply, PricePoint, Group, ReserveFilter,
} from "./warehouse/types"
import { fmt, fmtNum } from "./warehouse/utils"
import { checkSerialSound, useArchivedSerialCheck } from "./warehouse/serialCheck"
import { InventoryModal } from "./warehouse/InventoryModal"
import { QuickSupplyModal } from "./warehouse/QuickSupplyModal"

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

// ─── Модалка поставки ─────────────────────────────────────────────────────────

function SupplyModal({ groupId, category, stores, supply, onClose, onSaved }: {
  groupId: number
  category?: string | null
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

  // ── Шаг 2: ввод серийников (для категорий из учёта SN) ──
  const [snCats, setSnCats] = useState<{ category: string, require_serial: boolean }[]>([])
  const [snStep, setSnStep] = useState(false)
  const [snSupplyId, setSnSupplyId] = useState<number | null>(null)
  const [serials, setSerials] = useState<string[]>([])
  const snInputs = React.useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (isNew) api.snArchive.getCategories().then(d => setSnCats(d.categories || []))
  }, [isNew])

  const snRule = snCats.find(c => c.category === category)
  const needSerials = isNew && !!snRule

  const save = async () => {
    setLoading(true)
    const data = isNew
      ? await api.warehouse.createSupply({ group_id: groupId, ...form })
      : await api.warehouse.updateSupply({ id: supply!.id, ...form })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    // Уведомление об отрицательном резерве
    if (data.negative_alerts?.length) {
      const msgs = data.negative_alerts.map((a: {product: string, reserved: number, orders: number[]}) =>
        `✓ ${a.product} (${a.reserved} шт.) → улетел в заказ${a.orders.length ? ` #${a.orders.join(', #')}` : ''}`
      ).join('\n')
      alert(`Товар из отрицательного резерва поставлен в резерв:\n\n${msgs}`)
    }
    // Категория с учётом серийников → переходим к вводу SN
    if (needSerials && data.id && form.qty > 0) {
      setSnSupplyId(data.id)
      setSerials(Array.from({ length: form.qty }, () => ""))
      setSnStep(true)
      return
    }
    onSaved()
    onClose()
  }

  // Дубли внутри текущего ввода (без учёта регистра/пробелов)
  const dupIndexes = (() => {
    const seen = new Map<string, number>()
    const dup = new Set<number>()
    serials.forEach((s, i) => {
      const key = s.trim().toLowerCase()
      if (!key) return
      if (seen.has(key)) { dup.add(i); dup.add(seen.get(key)!) }
      else seen.set(key, i)
    })
    return dup
  })()

  const archivedHits = useArchivedSerialCheck(serials, snSupplyId)

  const saveSerials = async () => {
    const clean = serials.map(s => s.trim())
    if (snRule?.require_serial && clean.some(s => !s)) {
      setError("Заполни все серийные номера")
      return
    }
    if (dupIndexes.size) {
      setError("Есть повторяющиеся серийники — исправь подсвеченные строки")
      return
    }
    if (Object.keys(archivedHits).length) {
      setError("Некоторые серийники уже приняты ранее — исправь подсвеченные строки")
      return
    }
    setLoading(true)
    setError("")
    const data = await api.snArchive.addSerials({ supply_id: snSupplyId!, serials: clean.filter(Boolean) })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    onSaved()
    onClose()
  }

  if (snStep) {
    const store = stores.find(s => s.id === form.store_id)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Серийные номера</h2>
            <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
          </div>
          <p className="mb-4 text-xs text-foreground/50">
            {category} · {serials.length} шт.
            {store && <> · магазин <span className="font-medium text-foreground/70">[{store.code}] {store.name}</span></>}
            {form.purchase_date && <> · принято {form.purchase_date.split("-").reverse().join(".")}</>}
          </p>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {serials.map((sn, i) => {
              const isDup = dupIndexes.has(i)
              const hit = archivedHits[i]
              const bad = isDup || !!hit
              return (
                <div key={i}>
                  <div className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-xs text-foreground/40">{i + 1}.</span>
                  <Input
                    ref={(el) => { snInputs.current[i] = el }}
                    autoFocus={i === 0}
                    value={sn}
                    placeholder="S/N"
                    className={bad ? "border-red-500 ring-1 ring-red-500" : ""}
                    onChange={e => setSerials(p => p.map((v, j) => j === i ? e.target.value : v))}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        checkSerialSound(sn, i, serials, snSupplyId)
                        if (i < serials.length - 1) snInputs.current[i + 1]?.focus()
                        else saveSerials()
                      }
                    }}
                  />
                  {bad && <Icon name="TriangleAlert" size={15} className="shrink-0 text-red-500" />}
                  </div>
                  {hit && (
                    <p className="ml-8 mt-0.5 text-[11px] text-red-500">
                      Уже принят{hit.store_name ? ` в [${hit.store_code}] ${hit.store_name}` : ""}
                      {hit.purchase_date ? ` (${hit.purchase_date.substring(0, 10).split("-").reverse().join(".")})` : ""}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          {dupIndexes.size > 0 && <p className="mt-3 text-xs text-red-500">Повторяющиеся серийники подсвечены</p>}
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={saveSerials} disabled={loading || dupIndexes.size > 0 || Object.keys(archivedHits).length > 0}>{loading ? "Сохранение..." : "Сохранить серийники"}</Button>
          </div>
        </div>
      </div>
    )
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

        {needSerials && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-primary">
            <Icon name="ScanBarcode" size={13} />
            После приёмки откроется ввод серийников ({form.qty} шт.)
          </p>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={loading}>{loading ? "Сохранение..." : isNew ? (needSerials ? "Далее" : "Добавить") : "Сохранить"}</Button>
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
          {[...stores].sort((a, b) => (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0)).map(s => (
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

// ─── Внесение серийников к уже принятой поставке ──────────────────────────────

function SupplySerialsModal({ supplyId, onClose, onSaved }: {
  supplyId: number
  onClose: () => void
  onSaved: () => void
}) {
  const [info, setInfo] = useState<{
    qty: number; remaining: number; product_name: string; category: string;
    store_code: string | null; store_name: string | null; purchase_date: string | null;
    existing: { id: number; serial: string }[];
  } | null>(null)
  const [serials, setSerials] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    api.snArchive.supplySerials(supplyId).then(d => {
      if (d.error) { setError(d.error); return }
      setInfo(d)
      setSerials(Array.from({ length: Math.max(0, d.remaining) }, () => ""))
    })
  }, [supplyId])

  // Дубли в текущем вводе
  const dupIndexes = (() => {
    const seen = new Map<string, number>()
    const dup = new Set<number>()
    serials.forEach((s, i) => {
      const key = s.trim().toLowerCase()
      if (!key) return
      if (seen.has(key)) { dup.add(i); dup.add(seen.get(key)!) }
      else seen.set(key, i)
    })
    return dup
  })()

  // Серийники, уже принятые ранее (по всему архиву). Свою поставку игнорируем.
  const archivedHits = useArchivedSerialCheck(serials, supplyId)

  const save = async () => {
    const clean = serials.map(s => s.trim()).filter(Boolean)
    if (!clean.length) { setError("Введите хотя бы один серийник"); return }
    if (dupIndexes.size) { setError("Есть повторяющиеся серийники"); return }
    if (Object.keys(archivedHits).length) { setError("Некоторые серийники уже приняты ранее"); return }
    setLoading(true)
    setError("")
    const data = await api.snArchive.addSerials({ supply_id: supplyId, serials: clean })
    setLoading(false)
    if (data.error) { setError(data.error); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Серийные номера</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>
        {!info && !error && <p className="py-6 text-center text-sm text-foreground/40">Загрузка...</p>}
        {info && (
          <>
            <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
              <p className="font-medium">{info.product_name}</p>
              <p className="mt-0.5 text-xs text-foreground/50">
                всего {info.qty} шт. · внесено {info.existing.length} · осталось {serials.length}
                {info.store_name && <> · магазин <span className="font-medium text-foreground/70">[{info.store_code}] {info.store_name}</span></>}
                {info.purchase_date && <> · принято {info.purchase_date.substring(0, 10).split("-").reverse().join(".")}</>}
              </p>
            </div>

            {info.existing.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-xs text-foreground/40">Уже внесены:</p>
                <div className="flex flex-wrap gap-1.5">
                  {info.existing.map(e => (
                    <span key={e.id} className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground/60">{e.serial}</span>
                  ))}
                </div>
              </div>
            )}

            {serials.length === 0 ? (
              <p className="py-4 text-center text-sm text-green-500">Все серийники внесены ✓</p>
            ) : (
              <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                {serials.map((sn, i) => {
                  const isDup = dupIndexes.has(i)
                  const hit = archivedHits[i]
                  const bad = isDup || !!hit
                  return (
                    <div key={i}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 shrink-0 text-right text-xs text-foreground/40">{info.existing.length + i + 1}.</span>
                        <Input
                          ref={(el) => { inputs.current[i] = el }}
                          autoFocus={i === 0}
                          value={sn}
                          placeholder="S/N"
                          className={bad ? "border-red-500 ring-1 ring-red-500" : ""}
                          onChange={e => setSerials(p => p.map((v, j) => j === i ? e.target.value : v))}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              checkSerialSound(sn, i, serials, supplyId)
                              if (i < serials.length - 1) inputs.current[i + 1]?.focus()
                              else save()
                            }
                          }}
                        />
                        {bad && <Icon name="TriangleAlert" size={15} className="shrink-0 text-red-500" />}
                      </div>
                      {hit && (
                        <p className="ml-8 mt-0.5 text-[11px] text-red-500">
                          Уже принят{hit.store_name ? ` в [${hit.store_code}] ${hit.store_name}` : ""}
                          {hit.purchase_date ? ` (${hit.purchase_date.substring(0, 10).split("-").reverse().join(".")})` : ""}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        {info && serials.length > 0 && (
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={save} disabled={loading || dupIndexes.size > 0 || Object.keys(archivedHits).length > 0}>
              {loading ? "Сохранение..." : "Сохранить серийники"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Строка группы с разворотом ──────────────────────────────────────────────

function GroupRow({ group, stores, onEdit, onArchive, onUnarchive, onRefresh, isArchived, isSelected, onToggleSelect }: {
  group: Group
  stores: Store[]
  onEdit: (g: Group) => void
  onArchive: (g: Group) => void
  onUnarchive: (g: Group) => void
  onRefresh: () => void
  isArchived?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [supplyModal, setSupplyModal] = useState<Supply | null | "new">(null)
  const [serialsSupplyId, setSerialsSupplyId] = useState<number | null>(null)
  const [detail, setDetail] = useState<Group | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [reservesModal, setReservesModal] = useState(false)
  const [snTracked, setSnTracked] = useState(false)
  const [vatInfoId, setVatInfoId] = useState<number | null>(null)  // какой НДС-заход раскрыт (цена в счёт)

  useEffect(() => {
    if (!expanded) return
    api.snArchive.getCategories().then(d => {
      const cats: { category: string }[] = d.categories || []
      setSnTracked(cats.some(c => c.category === group.category))
    })
  }, [expanded, group.category])

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
            <div className="min-w-0">
              <span className="font-medium text-sm">{group.name}</span>
              {group.qty_negative > 0 && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Icon name="AlertTriangle" size={10} className="text-red-400 shrink-0" />
                  <span className="text-[10px] text-red-400">не хватает {group.qty_negative} шт. — в корзине закупки</span>
                </div>
              )}
              {group.qty_negative === 0 && group.qty_reserved > 0 && group.qty_total - group.qty_reserved <= 0 && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Icon name="Lock" size={10} className="text-orange-400 shrink-0" />
                  <span className="text-[10px] text-orange-400">всё под резервом</span>
                </div>
              )}
            </div>
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
        <td className="px-3 py-2.5 text-center text-sm">
          {(group.qty_reserved > 0 || group.qty_negative > 0) ? (
            <button
              onClick={e => { e.stopPropagation(); setReservesModal(true) }}
              className="hover:opacity-70 transition-opacity cursor-pointer"
            >
              {group.qty_reserved > 0 && <span className="text-orange-400">{fmtNum(group.qty_reserved)}</span>}
              {group.qty_negative > 0 && <span className="text-red-400 ml-1">−{fmtNum(group.qty_negative)}</span>}
            </button>
          ) : (
            <span className="text-foreground/30">0</span>
          )}
          {reservesModal && (
            <ReservesModal group={group} onClose={() => setReservesModal(false)} />
          )}
        </td>
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
        <td className="px-3 py-2.5 sticky right-0 bg-card z-10 shadow-[-8px_0_8px_-4px_rgba(0,0,0,0.1)]" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <input type="checkbox" checked={!!isSelected} onChange={() => onToggleSelect?.(group.id)} className="h-4 w-4 cursor-pointer accent-primary mr-1" />
            {isArchived ? (
              <button className="flex items-center gap-1.5 rounded-lg border border-green-400/40 px-2.5 py-1 text-xs font-medium text-green-400 hover:bg-green-400/10 transition-colors" onClick={() => onUnarchive(group)}>
                <Icon name="RotateCcw" size={13} />Восстановить
              </button>
            ) : (
              <>
                <button className="rounded p-1 hover:bg-muted transition-colors" onClick={() => onEdit(group)}>
                  <Icon name="Pencil" size={13} className="text-foreground/40" />
                </button>
                <button className="rounded p-1 hover:bg-muted transition-colors" onClick={() => setSupplyModal("new")}>
                  <Icon name="PackagePlus" size={13} className="text-foreground/40" />
                </button>
                <button className="rounded p-1 hover:bg-red-400/10 transition-colors" title="Архивировать позицию" onClick={() => onArchive(group)}>
                  <Icon name="Archive" size={13} className="text-foreground/40 hover:text-red-400" />
                </button>
              </>
            )}
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
                          {s.has_vat ? (
                            <td className="py-1 text-right align-top">
                              <button
                                type="button"
                                onClick={() => setVatInfoId(id => id === s.id ? null : s.id)}
                                title="Товар с НДС — нажмите, чтобы увидеть цену в счёт"
                                className="font-medium text-yellow-500 hover:underline"
                                style={{ cursor: "pointer" }}
                              >
                                {fmt(s.cost_price)}
                              </button>
                              {vatInfoId === s.id && (
                                <div className="mt-0.5 text-[11px] font-normal text-foreground/50">
                                  цена в счёт: {s.price_with_vat != null ? fmt(s.price_with_vat) : "—"}
                                </div>
                              )}
                            </td>
                          ) : (
                            <td className="py-1 text-right text-foreground/60">{fmt(s.cost_price)}</td>
                          )}
                          <td className="py-1 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {snTracked && (
                                <button
                                  className="flex items-center gap-1 text-primary hover:underline"
                                  title="Внести / дозаполнить серийные номера"
                                  onClick={() => setSerialsSupplyId(s.id)}>
                                  <Icon name="ScanBarcode" size={11} />S/N
                                </button>
                              )}
                              <button className="text-foreground/30 hover:text-foreground/70 transition-colors"
                                onClick={() => setSupplyModal(s)}>
                                <Icon name="Pencil" size={11} />
                              </button>
                            </div>
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
          category={group.category}
          supply={supplyModal === "new" ? null : supplyModal}
          stores={stores}
          onClose={() => setSupplyModal(null)}
          onSaved={() => { load(); onRefresh() }}
        />
      )}

      {serialsSupplyId !== null && (
        <SupplySerialsModal
          supplyId={serialsSupplyId}
          onClose={() => setSerialsSupplyId(null)}
          onSaved={() => { setSerialsSupplyId(null); load() }}
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
  const [catModal, setCatModal] = useState(false)

  const [search, setSearch] = useState("")
  const [filterCat, setFilterCat] = useState("")
  const [page, setPage] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  const PAGE = 50

  // Фильтр просмотра резервов: null → 'all' → 'only' → 'negative' → null
  const [reserveFilter, setReserveFilter] = useState<ReserveFilter>(null)

  // Показывать ли позиции с нулевым количеством И без резервов.
  // По умолчанию скрыты; состояние кнопки запоминается в localStorage.
  const [showZeroQty, setShowZeroQty] = useState<boolean>(
    () => localStorage.getItem("wh_show_zero_qty") === "1"
  )
  const toggleZeroQty = () => {
    setShowZeroQty(prev => {
      const next = !prev
      localStorage.setItem("wh_show_zero_qty", next ? "1" : "0")
      return next
    })
    setPage(0)
  }

  const RESERVE_FILTER_CYCLE: ReserveFilter[] = [null, 'all', 'only', 'negative']
  const RESERVE_FILTER_LABELS: Record<string, string> = {
    all: 'Все резервы',
    only: 'Только резервы',
    negative: 'Только отрицательные',
  }

  const cycleReserveFilter = () => {
    setReserveFilter(prev => {
      const idx = RESERVE_FILTER_CYCLE.indexOf(prev)
      return RESERVE_FILTER_CYCLE[(idx + 1) % RESERVE_FILTER_CYCLE.length]
    })
    setPage(0)
  }

  const [groupModal, setGroupModal] = useState<Partial<Group> | null | false>(false)
  const [storesModal, setStoresModal] = useState(false)
  const [brandsModal, setBrandsModal] = useState(false)
  const [quickSupplyModal, setQuickSupplyModal] = useState(false)
  const [inventoryModal, setInventoryModal] = useState(false)
  // Приёмка по счёту (OCR). receiptModal: false | {draftId?} ; resumeDraftId — возврат после создания SKU
  const [receiptModal, setReceiptModal] = useState<false | { draftId?: number | null }>(false)
  const [openDrafts, setOpenDrafts] = useState<{ draft_id: number; rows_count: number; updated_at: string }[]>([])
  const [draftsTotal, setDraftsTotal] = useState(0)
  const [draftsPanel, setDraftsPanel] = useState(false)
  const [discountModal, setDiscountModal] = useState(false)

  // Ресайз колонок
  const COL_DEFAULTS: Record<string, number> = {
    name: 220, type: 140, sku: 100, partnum: 110, qty: 70, reserve: 70,
    warranty: 90, price: 100, cell: 80, opt1: 90, opt2: 90,
    avg_cost: 90, margin: 80, price_history: 100, links: 70, actions: 90,
  }
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { return { ...COL_DEFAULTS, ...JSON.parse(localStorage.getItem("wh_col_widths") || "{}") } }
    catch { return COL_DEFAULTS }
  })
  const startColResize = (col: string, startX: number) => {
    const startW = colWidths[col] ?? COL_DEFAULTS[col] ?? 100
    const onMove = (e: MouseEvent) => {
      const next = { ...colWidths, [col]: Math.max(40, startW + e.clientX - startX) }
      setColWidths(next)
      localStorage.setItem("wh_col_widths", JSON.stringify(next))
    }
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }
  const w = (col: string) => colWidths[col] ?? COL_DEFAULTS[col] ?? 100

  const load = useCallback(async () => {
    setLoading(true)
    // При активном фильтре резервов — грузим все товары (большой limit), пагинация не нужна
    const params: Record<string, string> = reserveFilter
      ? { limit: "9999", offset: "0" }
      : { limit: String(PAGE), offset: String(page * PAGE) }
    if (search) params.search = search
    if (filterCat) params.category = filterCat
    if (showArchived) params.archived = "true"
    // Скрываем пустые позиции (qty=0 и без резервов) на бэкенде — для корректной пагинации.
    // Позиции с любым резервом остаются видимыми. Не действует в архиве и режиме резервов.
    if (!showZeroQty && !showArchived && !reserveFilter) params.hide_zero = "true"
    const [gData, sData, cData] = await Promise.all([
      api.warehouse.getGroups(params),
      api.warehouse.getStores(),
      api.warehouse.getCategories(),
    ])
    setLoading(false)
    if (!gData.error) { setGroups(gData.groups || []); setTotal(gData.total || 0) }
    if (!sData.error && Array.isArray(sData)) setStores(sData)
    if (!cData.error && Array.isArray(cData)) setCategories(cData)
  }, [search, filterCat, page, reserveFilter, showArchived, showZeroQty])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [search, filterCat, showArchived])

  // Открытые черновики приёмки по счёту
  const loadDrafts = useCallback(async () => {
    const d = await api.receiptScan.draftsOpen(getAdminKey())
    if (d?.drafts) setOpenDrafts(d.drafts)
    if (typeof d?.total === "number") setDraftsTotal(d.total)
  }, [])
  useEffect(() => { loadDrafts() }, [loadDrafts])

  // Возврат к черновику после создания нового SKU
  const resumeDraftId = useRef<number | null>(null)
  // сырое название из чека — показываем копируемой подсказкой над мастером
  const [receiptHint, setReceiptHint] = useState<string | null>(null)
  const handleCreateProductFromReceipt = (rawName: string, draftId: number) => {
    resumeDraftId.current = draftId
    setReceiptHint(rawName)
    setReceiptModal(false)          // закрываем приёмку (черновик уже сохранён в БД)
    setGroupModal({})               // открываем мастер нового товара (имя соберётся по шаблону)
  }
  const handleGroupSaved = () => {
    load()
    // если создавали SKU из приёмки — возвращаемся к незаконченному листу
    if (resumeDraftId.current) {
      const did = resumeDraftId.current
      resumeDraftId.current = null
      setReceiptModal({ draftId: did })
    }
  }

  const [recalcing, setRecalcing] = useState(false)
  const handleRecalcReserves = async () => {
    if (!confirm("Пересчитать резервы? Остатки на складе будут приведены в соответствие с реальными резервами заказов. Изменения записываются в лог.")) return
    setRecalcing(true)
    const res = await api.warehouse.recalcReserves()
    setRecalcing(false)
    if (res.error) { alert(res.error); return }
    const n = res.fixed_count || 0
    alert(n > 0 ? `Готово. Исправлено позиций: ${n}.` : "Готово. Расхождений не найдено — резервы в порядке.")
    load()
  }

  const handleArchive = async (g: Group) => {
    if (!confirm(`Архивировать «${g.name}»?`)) return
    await api.warehouse.archiveGroup(g.id)
    load()
  }

  const handleUnarchive = async (g: Group) => {
    await api.warehouse.unarchiveGroup(g.id)
    load()
  }

  // ── Массовый выбор ──
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  useEffect(() => { setSelected(new Set()) }, [showArchived, page])
  const toggleSelect = (id: number) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const bulkArchiveGroups = async () => {
    if (!confirm(`Архивировать выбранные позиции (${selected.size})?`)) return
    setBulkLoading(true)
    await Promise.all([...selected].map(id => api.warehouse.archiveGroup(id)))
    setSelected(new Set())
    setBulkLoading(false)
    load()
  }
  const bulkUnarchiveGroups = async () => {
    setBulkLoading(true)
    await Promise.all([...selected].map(id => api.warehouse.unarchiveGroup(id)))
    setSelected(new Set())
    setBulkLoading(false)
    load()
  }

  const totalPages = Math.ceil(total / PAGE)

  // Пустые позиции (qty=0 и без резервов) скрываются на бэкенде через hide_zero,
  // пока не нажата кнопка "Показать нулевые" (см. load).

  // Применяем фильтр и сортировку резервов
  const displayGroups = (() => {
    if (!reserveFilter) return groups
    if (reserveFilter === 'only') {
      return [...groups].filter(g => g.qty_reserved > 0).sort((a, b) => b.qty_reserved - a.qty_reserved)
    }
    if (reserveFilter === 'negative') {
      return [...groups].filter(g => g.qty_negative > 0).sort((a, b) => b.qty_negative - a.qty_negative)
    }
    // 'all': сначала обычные резервы (без отрицательных), потом отрицательные
    const withReserve = groups.filter(g => g.qty_reserved > 0).sort((a, b) => b.qty_reserved - a.qty_reserved)
    const withNegative = groups.filter(g => g.qty_negative > 0).sort((a, b) => b.qty_negative - a.qty_negative)
    // убираем дубли: товары которые есть в обоих списках — только в negative
    const negativeIds = new Set(withNegative.map(g => g.id))
    const pureReserve = withReserve.filter(g => !negativeIds.has(g.id))
    return [...pureReserve, ...withNegative]
  })()

  return (
    <div className="space-y-4">
      {/* Шапка */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{showArchived ? "Склад · Архив" : "Склад"}</h2>
        <Badge variant="outline">{total} {showArchived ? "в архиве" : "позиций"}</Badge>
        <div className="flex-1" />

        {/* Меню «Справочники» */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Icon name="Settings2" size={14} className="mr-1.5" />Справочники
              <Icon name="ChevronDown" size={13} className="ml-1 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Справочники</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setStoresModal(true)}>
              <Icon name="Store" size={14} className="mr-2" />Магазины
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setBrandsModal(true)}>
              <Icon name="Award" size={14} className="mr-2" />Бренды
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCatModal(true)}>
              <Icon name="Tag" size={14} className="mr-2" />Категории
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDiscountModal(true)}>
              <Icon name="Percent" size={14} className="mr-2" />Настройки закупки
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Меню «Приёмка» (грузовик) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="relative">
              <Icon name="Truck" size={14} className="mr-1.5" />Приёмка
              <Icon name="ChevronDown" size={13} className="ml-1 opacity-80" />
              {draftsTotal > 0 && (
                <span
                  role="button"
                  title="Показать незаконченные листы приёмки"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); loadDrafts(); setDraftsPanel(true) }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute -right-2 -top-2 flex h-5 min-w-[20px] cursor-pointer items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold leading-none text-white shadow hover:bg-amber-600"
                >
                  {draftsTotal > 99 ? "99+" : draftsTotal}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Приёмка и товары</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setQuickSupplyModal(true)}>
              <Icon name="PackagePlus" size={14} className="mr-2" />Принять поставку
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setReceiptModal({})}>
              <Icon name="ScanLine" size={14} className="mr-2" />Принять по счёту
              {draftsTotal > 0 && (
                <span
                  role="button"
                  title="Показать незаконченные листы приёмки"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); loadDrafts(); setDraftsPanel(true) }}
                  className="ml-auto flex h-5 min-w-[20px] cursor-pointer items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold leading-none text-white hover:bg-amber-600"
                >
                  {draftsTotal > 99 ? "99+" : draftsTotal}
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setGroupModal({})} disabled={showArchived}>
              <Icon name="Plus" size={14} className="mr-2" />Добавить товар
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Меню «Склад» */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={
                reserveFilter || showArchived || showZeroQty
                  ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
                  : ""
              }
            >
              <Icon name="Warehouse" size={14} className="mr-1.5" />Склад
              <Icon name="ChevronDown" size={13} className="ml-1 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Управление складом</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setInventoryModal(true)}>
              <Icon name="ClipboardList" size={14} className="mr-2" />Инвентаризация
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={cycleReserveFilter}>
              <Icon name={reserveFilter === 'negative' ? "AlertTriangle" : "Layers"} size={14} className="mr-2" />
              {reserveFilter ? RESERVE_FILTER_LABELS[reserveFilter] : "Просмотр резервов"}
              {reserveFilter && <Icon name="Check" size={13} className="ml-auto text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRecalcReserves} disabled={recalcing}>
              <Icon name={recalcing ? "Loader" : "RefreshCw"} size={14} className={`mr-2 ${recalcing ? "animate-spin" : ""}`} />
              {recalcing ? "Пересчёт..." : "Пересчитать резервы"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleZeroQty}>
              <Icon name={showZeroQty ? "Eye" : "EyeOff"} size={14} className="mr-2" />
              {showZeroQty ? "Скрыть нулевые" : "Показать нулевые"}
              {showZeroQty && <Icon name="Check" size={13} className="ml-auto text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowArchived(v => !v)}>
              <Icon name="Archive" size={14} className="mr-2" />
              {showArchived ? "Скрыть архив" : "Архив"}
              {showArchived && <Icon name="Check" size={13} className="ml-auto text-primary" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Панель незаконченных листов приёмки по счёту */}
      {draftsPanel && openDrafts.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-amber-600 flex items-center gap-1.5">
              <Icon name="FileClock" size={15} />Незаконченные листы приёмки ({draftsTotal})
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={async () => {
                  if (!confirm(`Удалить ВСЕ незаконченные листы (${draftsTotal})? Это действие нельзя отменить.`)) return
                  setOpenDrafts([])           // сразу убираем с экрана (оптимистично)
                  setDraftsTotal(0)
                  await api.receiptScan.draftsCloseAll(getAdminKey())  // один запрос — закрывает все
                  loadDrafts()                // сверяемся с сервером
                }}
                style={{ cursor: "pointer" }}
                className="flex items-center gap-1 rounded-lg border border-red-400/40 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-400/10 transition-colors"
              >
                <Icon name="Trash2" size={13} />Удалить все
              </button>
              <button onClick={() => setDraftsPanel(false)} style={{ cursor: "pointer" }}>
                <Icon name="X" size={15} className="text-foreground/40" />
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            {openDrafts.map(d => (
              <div key={d.draft_id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                <span className="text-sm">Лист #{d.draft_id} · позиций: {d.rows_count}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setDraftsPanel(false); setReceiptModal({ draftId: d.draft_id }) }}
                    style={{ cursor: "pointer" }}
                    className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                    Продолжить
                  </button>
                  <button onClick={async () => {
                      setOpenDrafts(prev => prev.filter(x => x.draft_id !== d.draft_id))  // сразу убираем с экрана
                      setDraftsTotal(t => Math.max(0, t - 1))
                      await api.receiptScan.draftClose(d.draft_id, "CANCELED", getAdminKey())
                    }}
                    style={{ cursor: "pointer" }}
                    className="rounded-lg border border-border px-2 py-1 text-xs text-foreground/50 hover:text-red-400">
                    <Icon name="Trash2" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Панель массовых действий */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">Выбрано: {selected.size}</span>
          <div className="flex-1" />
          {showArchived ? (
            <button onClick={bulkUnarchiveGroups} disabled={bulkLoading} className="flex items-center gap-1.5 rounded-lg border border-green-400/40 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50" style={{ cursor: "pointer" }}>
              <Icon name={bulkLoading ? "Loader" : "RotateCcw"} size={14} />Восстановить выбранные
            </button>
          ) : (
            <button onClick={bulkArchiveGroups} disabled={bulkLoading} className="flex items-center gap-1.5 rounded-lg border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50" style={{ cursor: "pointer" }}>
              <Icon name={bulkLoading ? "Loader" : "Archive"} size={14} />Архивировать выбранные
            </button>
          )}
          <button onClick={() => setSelected(new Set())} className="text-foreground/40 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}><Icon name="X" size={16} /></button>
        </div>
      )}

      {/* Таблица */}
      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="border-collapse" style={{ minWidth: "100%", tableLayout: "fixed" }}>
          <colgroup>
            {(["name","type","sku","partnum","qty","reserve","warranty","price","cell","opt1","opt2","avg_cost","margin","price_history","links","actions"] as const).map(col => (
              <col key={col} style={{ width: w(col) }} />
            ))}
          </colgroup>
          <thead className="border-b-2 border-border bg-muted/40">
            <tr className="text-xs text-foreground/50">
              {([
                ["name","Наименование","left"],["type","Тип","left"],["sku","Артикул","left"],
                ["partnum","Партнамбер","left"],["qty","Кол-во","center"],["reserve","Резерв","center"],
                ["warranty","Гарантия","left"],["price","Продажа","left"],["cell","Ячейка","left"],
                ["opt1","Опт 1","left"],["opt2","Опт 2","left"],["avg_cost","Заход ср.","left"],
                ["margin","Маржа","left"],["price_history","История цены","left"],["links","Ссылки","left"],
              ] as [string,string,string][]).map(([col, label, align]) => (
                <th key={col} className="relative font-medium border-r border-border/50 select-none"
                  style={{ width: w(col), minWidth: w(col), textAlign: align as "left"|"center" }}>
                  <div className="px-3 py-2.5 truncate">{label}</div>
                  <div
                    onMouseDown={e => { e.preventDefault(); startColResize(col, e.clientX) }}
                    className="absolute right-0 top-0 h-full w-1.5 bg-border/40 hover:bg-primary/60 active:bg-primary transition-colors z-10"
                    style={{ cursor: "col-resize" }}
                  />
                </th>
              ))}
              <th className="relative font-medium sticky right-0 bg-muted/40 z-10 shadow-[-8px_0_8px_-4px_rgba(0,0,0,0.15)]"
                style={{ width: w("actions"), minWidth: w("actions") }}>
                <div className="px-3 py-2.5 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={displayGroups.length > 0 && displayGroups.every(g => selected.has(g.id))}
                    onChange={() => setSelected(prev =>
                      displayGroups.every(g => prev.has(g.id)) ? new Set() : new Set(displayGroups.map(g => g.id))
                    )}
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                  Действия
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={16} className="px-3 py-8 text-center text-sm text-foreground/40">Загрузка...</td></tr>
            )}
            {!loading && displayGroups.length === 0 && (
              <tr><td colSpan={16} className="px-3 py-12 text-center text-sm text-foreground/30">
                {showArchived
                  ? "Архив пуст"
                  : reserveFilter
                  ? reserveFilter === 'negative'
                    ? "Отрицательных резервов нет"
                    : "Товаров с резервами нет"
                  : "Товаров нет. Добавьте первый через кнопку выше."}
              </td></tr>
            )}
            {!loading && (() => {
              if (reserveFilter === 'all') {
                const negativeIds = new Set(
                  groups.filter(g => g.qty_negative > 0).map(g => g.id)
                )
                const pureReserveCount = displayGroups.filter(g => !negativeIds.has(g.id)).length
                const rows: React.ReactNode[] = []
                if (pureReserveCount > 0) {
                  rows.push(
                    <tr key="divider-reserve">
                      <td colSpan={16} className="px-3 py-1.5 bg-orange-500/5 border-y border-orange-500/20">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-orange-400">
                          <Icon name="Layers" size={12} />
                          Резервы
                        </span>
                      </td>
                    </tr>
                  )
                }
                displayGroups.forEach((g, idx) => {
                  if (idx === pureReserveCount && displayGroups.length > pureReserveCount) {
                    rows.push(
                      <tr key="divider-negative">
                        <td colSpan={16} className="px-3 py-1.5 bg-red-500/5 border-y border-red-500/20">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                            <Icon name="AlertTriangle" size={12} />
                            Отрицательные резервы
                          </span>
                        </td>
                      </tr>
                    )
                  }
                  rows.push(
                    <GroupRow
                      key={g.id}
                      group={g}
                      stores={stores}
                      onEdit={gr => setGroupModal(gr)}
                      onArchive={handleArchive}
                      onUnarchive={handleUnarchive}
                      isArchived={showArchived}
                      isSelected={selected.has(g.id)}
                      onToggleSelect={toggleSelect}
                      onRefresh={load}
                    />
                  )
                })
                return rows
              }
              return displayGroups.map(g => (
                <GroupRow
                  key={g.id}
                  group={g}
                  stores={stores}
                  onEdit={gr => setGroupModal(gr)}
                  onArchive={handleArchive}
                  onUnarchive={handleUnarchive}
                  isArchived={showArchived}
                  isSelected={selected.has(g.id)}
                  onToggleSelect={toggleSelect}
                  onRefresh={load}
                />
              ))
            })()}
          </tbody>
        </table>
      </div>

      {/* Пагинация */}
      {totalPages > 1 && !reserveFilter && (
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
        <GroupWizardModal
          group={groupModal}
          receiptHint={receiptHint}
          onClose={() => {
            setGroupModal(false)
            setReceiptHint(null)
            // закрытие крестиком (без сохранения) — всё равно возвращаем к черновику
            if (resumeDraftId.current) {
              const did = resumeDraftId.current
              resumeDraftId.current = null
              setReceiptModal({ draftId: did })
            }
          }}
          onSaved={() => { setGroupModal(false); setReceiptHint(null); handleGroupSaved() }}
        />
      )}
      {storesModal && (
        <StoresModal
          stores={stores}
          onClose={() => setStoresModal(false)}
          onSaved={load}
        />
      )}
      {brandsModal && (
        <BrandsManager onClose={() => setBrandsModal(false)} />
      )}
      {quickSupplyModal && (
        <QuickSupplyModal
          stores={stores}
          onClose={() => setQuickSupplyModal(false)}
          onSaved={load}
        />
      )}
      {receiptModal !== false && (
        <ReceiptScanModal
          stores={stores}
          draftId={receiptModal.draftId ?? null}
          onClose={() => { setReceiptModal(false); loadDrafts() }}
          onAccepted={() => { load(); loadDrafts() }}
          onCreateProduct={handleCreateProductFromReceipt}
        />
      )}
      {inventoryModal && (
        <InventoryModal
          categories={categories}
          groups={groups}
          stores={stores}
          onClose={() => setInventoryModal(false)}
          onApplied={load}
        />
      )}
      {catModal && (
        <CategoriesModal
          categories={categories}
          onClose={() => setCatModal(false)}
          onSaved={() => { load() }}
        />
      )}
      {discountModal && (
        <DiscountModal onClose={() => setDiscountModal(false)} />
      )}
    </div>
  )
}

// ─── Скидка на покупку ─────────────────────────────────────────────────────────

function DiscountModal({ onClose }: { onClose: () => void }) {
  const [discount, setDiscount] = useState("0")
  const [vat, setVat] = useState("20")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.warehouse.getSettings()
      .then(s => {
        setDiscount(s?.purchase_discount_percent ?? "0")
        setVat(s?.vat_percent ?? "20")
      })
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    const dval = Math.max(0, Math.min(100, parseFloat(discount.replace(",", ".")) || 0))
    const vval = Math.max(0, Math.min(100, parseFloat(vat.replace(",", ".")) || 0))
    setSaving(true)
    await api.warehouse.setSettings({ purchase_discount_percent: dval, vat_percent: vval })
    setDiscount(String(dval))
    setVat(String(vval))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Icon name="Percent" size={18} /> Настройки закупки</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>
        {loading ? (
          <div className="flex justify-center py-6 text-foreground/40"><Icon name="Loader" size={22} className="animate-spin" /></div>
        ) : (
          <>
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium">Скидка на покупку, %</label>
              <p className="mb-2 text-xs text-foreground/50">
                Для товара «с НДС» себестоимость = цена × (1 − скидка/100). Например 25000 × 0,82 = 20500. Для товара «без НДС» — цена как есть.
              </p>
              <div className="flex items-center gap-2">
                <Input value={discount} onChange={e => setDiscount(e.target.value)} inputMode="decimal" className="text-right" />
                <span className="text-foreground/50">%</span>
              </div>
            </div>
            <div className="mb-2 border-t border-border pt-4">
              <label className="mb-1 block text-sm font-medium">Ставка НДС, %</label>
              <p className="mb-2 text-xs text-foreground/50">Справочная ставка НДС (для продаж и отчётов).</p>
              <div className="flex items-center gap-2">
                <Input value={vat} onChange={e => setVat(e.target.value)} inputMode="decimal" className="text-right" />
                <span className="text-foreground/50">%</span>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Закрыть</Button>
              <Button onClick={save} disabled={saving}>
                {saved ? <><Icon name="Check" size={15} className="mr-1" /> Сохранено</> : saving ? "Сохраняю..." : "Сохранить"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Модалка управления категориями ──────────────────────────────────────────

function CategoriesModal({ categories, onClose, onSaved }: {
  categories: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [list, setList] = useState<string[]>(categories)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editVal, setEditVal] = useState("")
  const [newCat, setNewCat] = useState("")
  const [saving, setSaving] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  // Перетаскивание: меняем позицию в списке и сохраняем порядок на сервер
  const onDrop = async (to: number) => {
    const from = dragIdx
    setDragIdx(null)
    setOverIdx(null)
    if (from === null || from === to) return
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setList(next)
    setSaving(true)
    await api.warehouse.reorderCategories(next)
    setSaving(false)
    onSaved()
  }

  const rename = async (idx: number) => {
    const old = list[idx]
    const val = editVal.trim()
    if (!val || val === old) { setEditIdx(null); return }
    setSaving(true)
    await api.warehouse.renameCategory(old, val)
    setList(prev => prev.map((c, i) => i === idx ? val : c))
    setEditIdx(null)
    setSaving(false)
    onSaved()
  }

  const del = async (cat: string) => {
    if (!confirm(`Удалить категорию «${cat}»? Все товары потеряют категорию.`)) return
    setSaving(true)
    await api.warehouse.deleteCategory(cat)
    setList(prev => prev.filter(c => c !== cat))
    setSaving(false)
    onSaved()
  }

  const add = async () => {
    const val = newCat.trim()
    if (!val || list.includes(val)) return
    setSaving(true)
    // Сохраняем категорию на сервер (в таблицу warehouse_categories), чтобы она
    // не исчезала после перезагрузки, даже если в ней ещё нет товаров.
    await api.warehouse.createCategory(val)
    setList(prev => [...prev, val])
    setNewCat("")
    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Категории склада</h2>
          <button onClick={onClose} style={{ cursor: "pointer" }}><Icon name="X" size={16} className="text-foreground/40" /></button>
        </div>

        <div className="mb-4 space-y-1.5 max-h-72 overflow-y-auto">
          {list.map((cat, i) => (
            <div key={cat}
              draggable={editIdx === null}
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => { e.preventDefault(); setOverIdx(i) }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
              onDrop={() => onDrop(i)}
              className={`flex items-center gap-2 rounded-lg border bg-background px-3 py-2 transition-colors ${overIdx === i && dragIdx !== null && dragIdx !== i ? "border-primary" : "border-border"} ${dragIdx === i ? "opacity-40" : ""}`}>
              {editIdx === i ? null : (
                <span className="shrink-0 text-foreground/25 hover:text-foreground/50" style={{ cursor: "grab" }} title="Перетащите, чтобы изменить порядок">
                  <Icon name="GripVertical" size={14} />
                </span>
              )}
              {editIdx === i ? (
                <input
                  autoFocus
                  value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") rename(i); if (e.key === "Escape") setEditIdx(null) }}
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                  style={{ cursor: "text" }}
                />
              ) : (
                <span className="flex-1 text-sm text-foreground">{cat}</span>
              )}
              <div className="flex items-center gap-1 shrink-0">
                {editIdx === i ? (
                  <>
                    <button onClick={() => rename(i)} disabled={saving} className="text-green-400 hover:text-green-300 transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name="Check" size={14} />
                    </button>
                    <button onClick={() => setEditIdx(null)} className="text-foreground/30 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name="X" size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditIdx(i); setEditVal(cat) }} className="text-foreground/30 hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name="Pencil" size={13} />
                    </button>
                    <button onClick={() => del(cat)} disabled={saving} className="text-foreground/20 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name="Trash2" size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {list.length === 0 && <p className="text-sm text-foreground/40 text-center py-4">Нет категорий</p>}
        </div>

        <div className="flex gap-2">
          <input
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") add() }}
            placeholder="Новая категория..."
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
            style={{ cursor: "text" }}
          />
          <button onClick={add} disabled={!newCat.trim()}
            className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Модалка резервов по заказам ──────────────────────────────────────────────

function ReservesModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const [reserves, setReserves] = useState<{ order_id: number; qty: number; customer_name: string | null; wip_stage: string | null }[]>([])
  const [negReserves, setNegReserves] = useState<{ order_id: number | null; qty: number; customer_name: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.warehouse.getGroupReserves(group.id).then(d => {
      setReserves(d.reserves || [])
      setNegReserves(d.negative_reserves || [])
      setLoading(false)
    })
  }, [group.id])

  const isEmpty = reserves.length === 0 && negReserves.length === 0
  const onAgreement = reserves.filter(r => r.wip_stage === "Согласование")
  const confirmed = reserves.filter(r => r.wip_stage !== "Согласование")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Резервы</h2>
            <p className="text-xs text-foreground/40 mt-0.5">{group.name}</p>
          </div>
          <button onClick={onClose} style={{ cursor: "pointer" }}><Icon name="X" size={16} className="text-foreground/40" /></button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-foreground/40 text-sm">
            <Icon name="Loader" size={14} className="animate-spin" />Загружаю...
          </div>
        ) : isEmpty ? (
          <p className="py-6 text-center text-sm text-foreground/40">Нет активных резервов</p>
        ) : (
          <div className="space-y-4">

            {/* Предупреждение: заказы на согласовании */}
            {onAgreement.length > 0 && (
              <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/5 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon name="AlertCircle" size={13} className="text-yellow-400 shrink-0" />
                  <span className="text-xs font-semibold text-yellow-400">На согласовании — возможный резерв</span>
                </div>
                <div className="space-y-1">
                  {onAgreement.map(r => (
                    <div key={r.order_id} className="flex items-center justify-between text-xs">
                      <a href={`/admin/order/${r.order_id}`} onClick={e => e.stopPropagation()}
                        className="font-mono font-semibold text-primary hover:underline">
                        #{String(r.order_id).padStart(4, "0")}
                        {r.customer_name && <span className="font-sans font-normal text-foreground/60 ml-1">{r.customer_name}</span>}
                      </a>
                      <span className="text-yellow-400 font-semibold">{r.qty} шт.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Подтверждённые резервы (заказ принят в работу) */}
            {confirmed.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-400/80 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-orange-400 inline-block" />
                  В резерве — {confirmed.reduce((s, r) => s + r.qty, 0)} шт.
                </p>
                <div className="space-y-1.5">
                  {confirmed.map(r => (
                    <div key={r.order_id} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
                      <div>
                        <a href={`/admin/order/${r.order_id}`} onClick={e => e.stopPropagation()}
                          className="text-sm font-mono font-semibold text-primary hover:underline">
                          #{String(r.order_id).padStart(4, "0")}
                          {r.customer_name && <span className="font-sans font-normal text-foreground/60 ml-1.5">{r.customer_name}</span>}
                        </a>
                        {r.wip_stage && (
                          <p className="text-[10px] text-foreground/40 mt-0.5">{r.wip_stage}</p>
                        )}
                      </div>
                      <span className="text-sm font-semibold text-orange-400">{r.qty} шт.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Отрицательные резервы (нехватка) */}
            {negReserves.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-400/80 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-400 inline-block" />
                  Нехватка — {negReserves.reduce((s, r) => s + r.qty, 0)} шт.
                </p>
                <div className="space-y-1.5">
                  {negReserves.map((r, i) => (
                    <div key={r.order_id ?? i} className="flex items-center justify-between rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2.5">
                      {r.order_id ? (
                        <a href={`/admin/order/${r.order_id}`} onClick={e => e.stopPropagation()}
                          className="text-sm font-mono font-semibold text-primary hover:underline">
                          #{String(r.order_id).padStart(4, "0")}
                          {r.customer_name && <span className="font-sans font-normal text-foreground/60 ml-1.5">{r.customer_name}</span>}
                        </a>
                      ) : (
                        <span className="text-sm text-foreground/50">Нет привязки к заказу</span>
                      )}
                      <span className="text-sm font-semibold text-red-400">−{r.qty} шт.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Быстрая приёмка вынесена в ./warehouse/QuickSupplyModal.tsx ────────────
// ─── Инвентаризация вынесена в ./warehouse/InventoryModal.tsx ───────────────