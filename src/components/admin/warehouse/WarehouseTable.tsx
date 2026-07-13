import { useState, useEffect, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Badge } from "@/components/ui/badge"
import type { Group, Store, Supply, PricePoint } from "./types"
import { fmt, fmtNum } from "./utils"
import { SupplyModal } from "./SupplyModal"
import { SupplySerialsModal } from "./StoresModal"
import { ReservesModal } from "./modals"

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

// ─── Строка группы с разворотом ──────────────────────────────────────────────

export function GroupRow({ group, stores, onEdit, onArchive, onUnarchive, onRefresh, isArchived, isSelected, onToggleSelect }: {
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
              {group.is_used && (
                <span className="ml-1.5 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500 align-middle">
                  Б/У
                </span>
              )}
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