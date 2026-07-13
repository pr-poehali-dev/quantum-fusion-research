import { useState, useEffect, useRef } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Store, Supply } from "./types"
import { checkSerialSound, useArchivedSerialCheck } from "./serialCheck"

export function SupplyModal({ groupId, category, stores, supply, onClose, onSaved }: {
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
  const snInputs = useRef<(HTMLInputElement | null)[]>([])

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