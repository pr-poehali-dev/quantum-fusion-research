import { useState, useEffect } from "react"
import Icon from "@/components/ui/icon"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { WipBuild } from "@/pages/admin/types"
import { SCHEDULE_URL, authH, withAk, Employee } from "./schedule.types"

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽"

// ─── Модалка редактирования сборки (информация о заказе + сборщик) ───────────
export function WipEditModal({ wip, sessionId, onClose, onSaved }: {
  wip: WipBuild
  sessionId: string
  onClose: () => void
  onSaved: (w: WipBuild) => void
}) {
  const [form, setForm] = useState<WipBuild>({ ...wip })
  const [employees, setEmployees] = useState<Employee[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`${SCHEDULE_URL}?${withAk("action=employees")}`, { headers: authH(sessionId) })
      .then(r => r.json())
      .then(d => setEmployees(d.employees || []))
      .catch(() => {})
  }, [sessionId])

  const save = async () => {
    setSaving(true)
    await api.wipBuilds.update(form)
    setSaving(false)
    onSaved(form)
    onClose()
  }

  const set = (k: keyof WipBuild, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Icon name="Pencil" size={18} /> Информация о заказе</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Номер заказа</label>
              <input value={form.order_number || ""} onChange={e => set("order_number", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Контакт</label>
              <input value={form.contact || ""} onChange={e => set("contact", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Сборщик ПК */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <label className="mb-1 block text-xs font-medium text-foreground flex items-center gap-1">
              <Icon name="Wrench" size={13} /> Сборщик ПК *
            </label>
            <select value={form.assembled_by ?? ""} onChange={e => set("assembled_by", e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="">Не выбран</option>
              {employees.filter(e => e.is_active).map(e => (
                <option key={e.id} value={e.id}>{e.name}{e.assembler_percent ? ` (${e.assembler_percent}%)` : ""}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-foreground/40">Сборщику начислится % от суммы ПК при выдаче заказа.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Тип доставки</label>
              <input value={form.delivery_type || ""} onChange={e => set("delivery_type", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Адрес доставки</label>
              <input value={form.delivery_address || ""} onChange={e => set("delivery_address", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Принят</label>
              <input type="date" value={(form.received_at || "").slice(0, 10)} onChange={e => set("received_at", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Выдан</label>
              <input type="date" value={(form.issued_at || "").slice(0, 10)} onChange={e => set("issued_at", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-foreground/50">Комментарий</label>
            <textarea value={form.comment || ""} onChange={e => set("comment", e.target.value)} rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none" />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Сохраняю..." : "Сохранить"}</Button>
        </div>
      </div>
    </div>
  )
}

interface MarginComp { slot: string; name: string; qty: number; sale: number; cost: number; margin: number }
interface MarginData { components: MarginComp[]; total: number; sum_sale: number; sum_cost: number; assembly_fee: number; total_margin: number }

// ─── Модалка калькуляции маржи по компонентам ────────────────────────────────
export function WipMarginModal({ wipId, orderNumber, onClose }: {
  wipId: number
  orderNumber: string
  onClose: () => void
}) {
  const [data, setData] = useState<MarginData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.wipBuilds.getMargin(wipId)
      .then(d => setData(d.error ? null : d))
      .finally(() => setLoading(false))
  }, [wipId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">🤑 Маржа сборки #{orderNumber}</h2>
          <button onClick={onClose}><Icon name="X" size={18} className="text-foreground/40" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8 text-foreground/40"><Icon name="Loader" size={22} className="animate-spin" /></div>
        ) : !data ? (
          <p className="py-6 text-center text-sm text-foreground/40">Нет данных по компонентам</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-foreground/50">
                    <th className="px-3 py-2 text-left">Компонент</th>
                    <th className="px-2 py-2 text-right">Продажа</th>
                    <th className="px-2 py-2 text-right">Себест.</th>
                    <th className="px-3 py-2 text-right">Маржа</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.components.map((c, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="font-medium truncate max-w-[200px]">{c.name || c.slot}</div>
                        {c.qty > 1 && <div className="text-[10px] text-foreground/40">× {c.qty}</div>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmt(c.sale)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground/60">{c.cost ? fmt(c.cost) : "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${c.margin >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(c.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-foreground/50">Сумма продажи компонентов</span><span className="tabular-nums">{fmt(data.sum_sale)}</span></div>
              <div className="flex justify-between"><span className="text-foreground/50">Себестоимость компонентов</span><span className="tabular-nums">{fmt(data.sum_cost)}</span></div>
              {data.assembly_fee > 0 && (
                <div className="flex justify-between"><span className="text-foreground/50">Работа / сборка</span><span className="tabular-nums">{fmt(data.assembly_fee)}</span></div>
              )}
              <div className="flex justify-between border-t border-border pt-1.5"><span className="text-foreground/50">Итог заказа</span><span className="tabular-nums font-semibold">{fmt(data.total)}</span></div>
              <div className="flex justify-between rounded-lg bg-green-400/10 px-3 py-2 mt-2">
                <span className="font-semibold text-green-400">Общая маржа с ПК</span>
                <span className={`tabular-nums text-lg font-bold ${data.total_margin >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(data.total_margin)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
