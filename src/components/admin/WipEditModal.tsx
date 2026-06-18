import { useState, useEffect } from "react"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽"

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
