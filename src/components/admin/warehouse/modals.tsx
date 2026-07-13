import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Group } from "./types"

// ─── Скидка на покупку ─────────────────────────────────────────────────────────

export function DiscountModal({ onClose }: { onClose: () => void }) {
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

export function CategoriesModal({ categories, onClose, onSaved }: {
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

export function ReservesModal({ group, onClose }: { group: Group; onClose: () => void }) {
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
