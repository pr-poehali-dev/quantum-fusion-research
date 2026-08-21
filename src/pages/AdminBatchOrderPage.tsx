import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import PrepaymentEditor from "@/components/admin/PrepaymentEditor"
import PrepaymentConfirmModal from "@/components/admin/PrepaymentConfirmModal"
import { buildBatchWarrantyHtml, BatchWarranty } from "@/pages/batch/warrantyPrint"
import { exportBatchToExcel, parseBatchExcel } from "@/pages/batch/batchExcel"

const PRODUCTS_URL = "https://functions.poehali.dev/ab453741-d994-4115-9a77-276036d19dbd"

// Слоты конфигурации ПК (совпадают с одиночной сборкой)
const SLOTS: { key: string; label: string }[] = [
  { key: "cpu", label: "Процессор" },
  { key: "motherboard", label: "Материнская плата" },
  { key: "ram", label: "Оперативная память" },
  { key: "gpu", label: "Видеокарта" },
  { key: "storage", label: "Накопитель" },
  { key: "psu", label: "Блок питания" },
  { key: "case", label: "Корпус" },
  { key: "cooling", label: "Охлаждение" },
  { key: "extra", label: "Доп." },
]

interface Comp { slot: string; name: string; qty: number; price: number; source?: string; source_id?: number | null }
interface Unit { id: number; unit_no: number; serial_number: string | null; status: string; warranty_until: string | null; issued_at: string | null; comment: string | null; comp_serials?: Record<string, string> }
interface Group {
  id: number; label: string; qty: number; components: Comp[]
  parts_total: number; total_price: number; wip_id: number | null; stage: string | null
  wants_assembly: boolean; assembly_fee: number; assembly_type: "percent" | "manual"
  slot_statuses: Record<string, string>; units: Unit[]; issued_count: number; assembled_count: number
}
interface Prod { id: number; name: string; price: number; category?: { slug?: string } | string }

const money = (n: number) => n.toLocaleString("ru-RU") + " ₽"
const UNIT_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает", color: "text-foreground/40 bg-foreground/5" },
  assembled: { label: "Собран", color: "text-blue-400 bg-blue-400/10" },
  issued: { label: "Выдан", color: "text-green-400 bg-green-400/10" },
}

export default function AdminBatchOrderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const orderId = Number(id)
  const [groups, setGroups] = useState<Group[]>([])
  const [order, setOrder] = useState<{
    display_number?: string; customer_name?: string; total?: number; status?: string
    order_type?: string
    prepayment_percent?: number; prepayment_amount?: number; prepayment_confirmed?: boolean
    remaining_amount?: number; remaining_paid?: boolean
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ reserved: number; need: number } | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [payModal, setPayModal] = useState<null | "prepayment" | "remaining" | "full">(null)
  // Партия ПК собирается под клиента — предоплата уместна. Заказ
  // комплектующих оплачивается целиком при выдаче.
  const isBuildBatch = order?.order_type !== "parts"

  const load = useCallback(async () => {
    setLoading(true)
    const [o, g] = await Promise.all([api.orders.getById(orderId), api.orders.batchList(orderId)])
    setOrder(o.order || null)
    setGroups(g.groups || [])
    setLoading(false)
  }, [orderId])
  useEffect(() => { load() }, [load])

  const refresh = (g: Group[]) => setGroups(g || [])

  const addGroup = async () => {
    setBusy(true)
    // wants_assembly: true по умолчанию — так же, как в Конфигураторе
    // («Актуальные сборки»), чтобы оплата за работу сразу считалась.
    const res = await api.orders.batchAddGroup(orderId, { label: `Вариант ${groups.length + 1}`, qty: 1, components: [], wants_assembly: true })
    setBusy(false)
    if (res.groups) { refresh(res.groups); setExpanded(res.group_id) }
  }
  const copyGroup = async (g: Group) => {
    setBusy(true)
    const res = await api.orders.batchAddGroup(orderId, { label: g.label + " (копия)", qty: g.qty, components: g.components, wants_assembly: g.wants_assembly, assembly_type: g.assembly_type, assembly_fee_manual: g.assembly_type === "manual" ? g.assembly_fee : undefined })
    setBusy(false)
    if (res.groups) refresh(res.groups)
  }
  const removeGroup = async (gid: number) => {
    if (!confirm("Удалить этот вариант из партии?")) return
    setBusy(true)
    const res = await api.orders.batchRemoveGroup(orderId, gid)
    setBusy(false)
    if (res.groups) refresh(res.groups)
    await load()
  }
  const patchGroup = async (gid: number, data: { label?: string; qty?: number; components?: Comp[]; wants_assembly?: boolean; assembly_type?: "percent" | "manual"; assembly_fee_manual?: number }) => {
    const res = await api.orders.batchUpdateGroup(orderId, gid, data)
    if (res.groups) refresh(res.groups)
    if (data.qty !== undefined || data.components || data.wants_assembly !== undefined || data.assembly_type !== undefined || data.assembly_fee_manual !== undefined) { const o = await api.orders.getById(orderId); setOrder(o.order || null) }
  }
  const syncAll = async () => {
    setBusy(true); setSyncMsg(null)
    const res = await api.orders.batchSync(orderId)
    setBusy(false)
    if (res.groups) refresh(res.groups)
    setSyncMsg({ reserved: (res.reserved || []).length, need: (res.need_order || []).length })
  }
  const patchUnit = async (uid: number, data: { serial_number?: string; status?: string; comp_slot?: string; comp_serial?: string }) => {
    const res = await api.orders.batchUpdateUnit(orderId, uid, data)
    if (res.groups) refresh(res.groups)
  }

  // Предоплата: установка сумм (без приёма денег)
  const savePrepayment = async (payload: { prepayment_percent?: number; prepayment_amount?: number }) => {
    const res = await api.orders.setPrepayment({ id: orderId, ...payload })
    await load()
    return res
  }

  // Выдача всей партии (с проверкой оплаты остатка)
  const doWriteoff = async () => {
    if (!confirm("Выдать всю партию? Товар спишется со склада, все ПК будут отмечены как выданные, заказ закроется.")) return
    setBusy(true)
    const res = await api.orders.batchWriteoff(orderId)
    setBusy(false)
    if (res.error === "remaining_unpaid") {
      setPayModal(isBuildBatch || order?.prepayment_confirmed ? "remaining" : "full")
      return
    }
    if (res.error) { alert(res.message || res.error); return }
    await load()
  }

  // Гарантийный талон на всю партию (печать)
  const printWarranty = async () => {
    const res = await api.orders.batchWarranty(orderId)
    const w: BatchWarranty | null = res.warranty || null
    if (!w) { alert("Нет данных для талона"); return }
    const html = buildBatchWarrantyHtml(w)
    const win = window.open("", "_blank")
    if (!win) { alert("Разрешите всплывающие окна для печати"); return }
    win.document.write(html)
    win.document.close()
  }

  const slotLabelOf = (slot: string) => SLOTS.find(s => s.key === slot)?.label || slot

  // Экспорт содержимого партии в Excel (для вбивания серийников)
  const exportExcel = () => {
    if (!groups.length) return
    const num = order?.display_number || `batch_${orderId}`
    exportBatchToExcel(groups, slotLabelOf, `serials_${num}.xlsx`)
  }

  // Импорт серийников из Excel: разбираем файл и применяем по каждому ПК
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // позволяем повторно выбрать тот же файл
    if (!file) return
    setBusy(true); setImportMsg(null)
    try {
      const parsed = await parseBatchExcel(file, groups, slotLabelOf)
      if (!parsed.length) { setImportMsg("В файле не найдено строк этой партии (проверьте колонку ID)."); setBusy(false); return }
      let updated = 0
      for (const p of parsed) {
        await api.orders.batchUpdateUnit(orderId, p.unit_id, {
          serial_number: p.serial_number,
          comp_serials: p.comp_serials,
        })
        updated++
      }
      await load()
      setImportMsg(`Импортировано: ${updated} ПК.`)
    } catch (err) {
      setImportMsg("Не удалось прочитать файл: " + (err instanceof Error ? err.message : "неизвестная ошибка"))
    }
    setBusy(false)
  }

  const totalPcs = groups.reduce((s, g) => s + g.qty, 0)
  const totalIssued = groups.reduce((s, g) => s + g.issued_count, 0)

  if (loading) return <div className="p-8"><div className="h-40 rounded-xl bg-card animate-pulse" /></div>

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <button onClick={() => navigate("/admin")} className="mb-4 flex items-center gap-1.5 text-sm text-foreground/50 hover:text-foreground" style={{ cursor: "pointer" }}>
        <Icon name="ArrowLeft" size={16} /> К заказам
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-purple-400/15 px-2.5 py-0.5 text-xs font-medium text-purple-400">Массовая сборка</span>
            <span className="font-mono text-sm text-foreground/50">{order?.display_number || `#${orderId}`}</span>
          </div>
          <h1 className="mt-1 text-2xl font-light text-foreground">Партия ПК</h1>
          <p className="text-sm text-foreground/50">{totalPcs} ПК · выдано {totalIssued} из {totalPcs} · {money(order?.total || 0)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportExcel} disabled={busy || groups.length === 0}
            className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-500 hover:bg-green-500/20 disabled:opacity-50" style={{ cursor: "pointer" }}
            title="Скачать Excel со списком всех ПК партии для вбивания серийников">
            <Icon name="FileDown" size={15} /> Экспорт в Excel
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy || groups.length === 0}
            className="flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-500 hover:bg-blue-500/20 disabled:opacity-50" style={{ cursor: "pointer" }}
            title="Загрузить заполненный Excel — серийники применятся к партии">
            <Icon name="FileUp" size={15} /> Импорт из Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onImportFile} className="hidden" />
          <button onClick={syncAll} disabled={busy || groups.length === 0}
            className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50" style={{ cursor: "pointer" }}>
            <Icon name={busy ? "Loader" : "RefreshCw"} size={15} className={busy ? "animate-spin" : ""} /> Пересчитать резервы
          </button>
          <button onClick={addGroup} disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={15} /> Вариант
          </button>
        </div>
      </div>

      {importMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <Icon name="Info" size={15} className="text-primary" />
          <span className="text-foreground/80">{importMsg}</span>
          <button onClick={() => setImportMsg(null)} className="ml-auto text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
            <Icon name="X" size={14} />
          </button>
        </div>
      )}

      {syncMsg && (
        <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span className="text-green-400">Зарезервировано позиций: {syncMsg.reserved}</span>
          {syncMsg.need > 0 && <span className="ml-3 text-orange-400">В закупку (дефицит): {syncMsg.need}</span>}
        </div>
      )}

      {/* Оплата и выдача партии */}
      {groups.length > 0 && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Партия ПК собирается под клиента — предоплата тут уместна.
                Заказы комплектующих оплачиваются целиком при выдаче. */}
            {isBuildBatch ? (
              <div className="min-w-[240px] flex-1">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foreground/40">Предоплата</p>
                <PrepaymentEditor total={order?.total || 0}
                  percent={order?.prepayment_percent} amount={order?.prepayment_amount}
                  onSave={savePrepayment} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {order?.prepayment_confirmed ? (
                    <span className="rounded-full bg-green-400/10 px-2.5 py-0.5 text-xs font-medium text-green-400">Предоплата принята</span>
                  ) : (
                    <button onClick={() => setPayModal("prepayment")}
                      className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20" style={{ cursor: "pointer" }}>
                      Принять предоплату
                    </button>
                  )}
                  {order?.remaining_paid && (
                    <span className="rounded-full bg-green-400/10 px-2.5 py-0.5 text-xs font-medium text-green-400">Остаток оплачен</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="min-w-[240px] flex-1">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foreground/40">Оплата</p>
                <p className="text-sm text-foreground/60">
                  Полная оплата при выдаче: <span className="font-semibold text-foreground">{(order?.total || 0).toLocaleString("ru-RU")} ₽</span>
                </p>
                {order?.remaining_paid && (
                  <span className="mt-2 inline-block rounded-full bg-green-400/10 px-2.5 py-0.5 text-xs font-medium text-green-400">Оплачен</span>
                )}
              </div>
            )}
            <div className="flex flex-col items-stretch gap-2">
              <button onClick={printWarranty}
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground" style={{ cursor: "pointer" }}>
                <Icon name="FileText" size={15} /> Гарантийный талон
              </button>
              {order?.status === "done" ? (
                <span className="flex items-center justify-center gap-2 rounded-lg bg-green-400/10 px-4 py-2 text-sm font-medium text-green-400">
                  <Icon name="CheckCircle2" size={15} /> Партия выдана
                </span>
              ) : (
                <button onClick={doWriteoff} disabled={busy}
                  className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" style={{ cursor: "pointer" }}>
                  <Icon name={busy ? "Loader" : "PackageCheck"} size={15} className={busy ? "animate-spin" : ""} /> Выдать партию
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {payModal && (
        <PrepaymentConfirmModal orderId={orderId} total={order?.total || 0}
          mode={payModal}
          defaultAmount={payModal === "full" ? (order?.total || 0)
            : payModal === "remaining" ? (order?.remaining_amount ?? undefined)
            : (order?.prepayment_amount ?? undefined)}
          onClose={() => setPayModal(null)}
          onConfirmed={async () => {
            const wasRemaining = payModal === "remaining" || payModal === "full"
            setPayModal(null)
            await load()
            if (wasRemaining) await doWriteoff()
          }} />
      )}

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Icon name="Boxes" size={36} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">Добавьте первый вариант конфигурации</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <GroupCard key={g.id} group={g} expanded={expanded === g.id}
              onToggle={() => setExpanded(expanded === g.id ? null : g.id)}
              onPatch={patchGroup} onCopy={() => copyGroup(g)} onRemove={() => removeGroup(g.id)}
              onPatchUnit={patchUnit} />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupCard({ group, expanded, onToggle, onPatch, onCopy, onRemove, onPatchUnit }: {
  group: Group; expanded: boolean; onToggle: () => void
  onPatch: (gid: number, data: { label?: string; qty?: number; components?: Comp[]; wants_assembly?: boolean; assembly_type?: "percent" | "manual"; assembly_fee_manual?: number }) => void
  onCopy: () => void; onRemove: () => void
  onPatchUnit: (uid: number, data: { serial_number?: string; status?: string }) => void
}) {
  const [label, setLabel] = useState(group.label)
  const [qty, setQty] = useState(group.qty)
  const [feeInput, setFeeInput] = useState(String(group.assembly_fee))
  useEffect(() => { setLabel(group.label); setQty(group.qty) }, [group.label, group.qty])
  useEffect(() => { setFeeInput(String(group.assembly_fee)) }, [group.assembly_fee])

  const comps = group.components || []
  const setComp = (slot: string, prod: Prod | null) => {
    const rest = comps.filter(c => c.slot !== slot)
    const next = prod
      ? [...rest, { slot, name: prod.name, qty: 1, price: prod.price, source: "catalog", source_id: prod.id }]
      : rest
    onPatch(group.id, { components: next })
  }
  const setCompQty = (slot: string, q: number) => {
    onPatch(group.id, { components: comps.map(c => c.slot === slot ? { ...c, qty: Math.max(1, q) } : c) })
  }
  const setCompPrice = (slot: string, price: number) => {
    onPatch(group.id, { components: comps.map(c => c.slot === slot ? { ...c, price: Math.max(0, price) } : c) })
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button onClick={onToggle} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={18} />
        </button>
        <input value={label} onChange={e => setLabel(e.target.value)} onBlur={() => label !== group.label && onPatch(group.id, { label })}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground" placeholder="Название варианта" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-foreground/50">Кол-во ПК:</span>
          <input type="number" min={1} value={qty} onChange={e => setQty(Number(e.target.value))} onBlur={() => qty !== group.qty && onPatch(group.id, { qty })}
            className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-center text-sm text-foreground" />
        </div>
        <button
          onClick={() => onPatch(group.id, { wants_assembly: !group.wants_assembly })}
          title="Профессиональная сборка BeGraphics — 7% от стоимости железа"
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${group.wants_assembly ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/50 hover:border-primary/50"}`}
          style={{ cursor: "pointer" }}>
          <Icon name="Wrench" size={13} /> Сборка
        </button>
        <span className="text-sm font-medium text-foreground">{money(group.total_price)} <span className="text-xs text-foreground/40">/ шт</span></span>
        <span className="text-sm font-semibold text-accent">= {money(group.total_price * group.qty)}</span>
        <button onClick={onCopy} title="Дублировать вариант" className="text-foreground/40 hover:text-accent" style={{ cursor: "pointer" }}><Icon name="Copy" size={16} /></button>
        <button onClick={onRemove} title="Удалить вариант" className="text-foreground/40 hover:text-red-500" style={{ cursor: "pointer" }}><Icon name="Trash2" size={16} /></button>
      </div>
      {group.wants_assembly && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 -mt-1">
          <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Оплата за работу</span>
          <div className="flex items-center gap-1">
            <input type="number" min={0} value={feeInput}
              onChange={e => setFeeInput(e.target.value)}
              onBlur={() => {
                const v = Math.max(0, Number(feeInput) || 0)
                setFeeInput(String(v))
                if (v !== group.assembly_fee || group.assembly_type !== "manual") {
                  onPatch(group.id, { assembly_type: "manual", assembly_fee_manual: v })
                }
              }}
              className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-right text-xs text-foreground" />
            <span className="text-xs text-foreground/40">₽ за 1 ПК</span>
          </div>
          {group.assembly_type === "manual" ? (
            <button onClick={() => onPatch(group.id, { assembly_type: "percent" })}
              title="Вернуть автоматический расчёт — 7% от стоимости железа"
              className="rounded-lg border border-border px-2 py-1 text-[11px] text-foreground/50 hover:border-primary hover:text-primary" style={{ cursor: "pointer" }}>
              <Icon name="RotateCcw" size={11} className="inline -mt-0.5 mr-1" />Сумма задана вручную
            </button>
          ) : (
            <span className="text-[11px] text-foreground/40">7% от стоимости железа — автоматически</span>
          )}
        </div>
      )}

      {expanded && (
        <div className="border-t border-border p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground/40">Конфигурация</p>
          <div className="space-y-2">
            {SLOTS.map(s => {
              const c = comps.find(x => x.slot === s.key)
              return <SlotRow key={s.key} slotLabel={s.label} comp={c || null}
                onPick={p => setComp(s.key, p)} onQty={q => setCompQty(s.key, q)}
                onPrice={p => setCompPrice(s.key, p)} />
            })}
          </div>

          <p className="mt-5 mb-2 text-xs font-medium uppercase tracking-wide text-foreground/40">
            Компьютеры в партии ({group.units.length}) · цена, серийники по комплектующим, выдача
          </p>
          <div className="space-y-2">
            {group.units.map(u => <UnitRow key={u.id} unit={u} comps={comps} onPatch={onPatchUnit} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function SlotRow({ slotLabel, comp, onPick, onQty, onPrice }: {
  slotLabel: string; comp: Comp | null; onPick: (p: Prod | null) => void; onQty: (q: number) => void; onPrice: (p: number) => void
}) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Prod[]>([])
  const [open, setOpen] = useState(false)
  const [price, setPrice] = useState(comp?.price ?? 0)
  useEffect(() => { setPrice(comp?.price ?? 0) }, [comp?.price])
  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return }
    let cancelled = false
    fetch(`${PRODUCTS_URL}?search=${encodeURIComponent(q)}`).then(r => r.json())
      .then(d => { if (!cancelled) setResults(Array.isArray(d.products) ? d.products.slice(0, 12) : []) }).catch(() => {})
    return () => { cancelled = true }
  }, [q])

  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-xs text-foreground/50">{slotLabel}</span>
      {comp ? (
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
          <span className="flex-1 truncate text-sm text-foreground">{comp.name}</span>
          {!comp.source_id && <span className="text-[10px] text-orange-400" title="Нет в каталоге — не резервируется">вне склада</span>}
          <input type="number" min={1} value={comp.qty} onChange={e => onQty(Number(e.target.value))}
            className="w-12 rounded border border-border bg-card px-1.5 py-0.5 text-center text-xs" title="Кол-во на 1 ПК" />
          <div className="flex items-center gap-1" title="Цена за штуку (можно задать вручную)">
            <input type="number" min={0} value={price} onChange={e => setPrice(Number(e.target.value))}
              onBlur={() => price !== comp.price && onPrice(price)}
              className="w-24 rounded border border-border bg-card px-1.5 py-0.5 text-right text-xs" />
            <span className="text-xs text-foreground/40">₽</span>
          </div>
          <button onClick={() => onPick(null)} className="text-foreground/30 hover:text-red-500" style={{ cursor: "pointer" }}><Icon name="X" size={14} /></button>
        </div>
      ) : (
        <div className="relative flex-1">
          <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
            placeholder="Поиск товара…" className="w-full rounded-lg border border-dashed border-border bg-background px-3 py-1.5 text-sm text-foreground" />
          {open && results.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg">
              {results.map(p => (
                <button key={p.id} onClick={() => { onPick(p); setQ(""); setResults([]); setOpen(false) }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent/10" style={{ cursor: "pointer" }}>
                  <span className="truncate text-foreground">{p.name}</span>
                  <span className="shrink-0 text-xs text-foreground/40">{money(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UnitRow({ unit, comps, onPatch }: {
  unit: Unit; comps: Comp[]
  onPatch: (uid: number, data: { serial_number?: string; status?: string; comp_slot?: string; comp_serial?: string }) => void
}) {
  const [sn, setSn] = useState(unit.serial_number || "")
  useEffect(() => { setSn(unit.serial_number || "") }, [unit.serial_number])
  const st = UNIT_STATUS[unit.status] || UNIT_STATUS.pending
  const filled = comps.filter(c => c.name).map(c => c.slot)
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-xs font-mono text-foreground/40">#{unit.unit_no}</span>
        <input value={sn} onChange={e => setSn(e.target.value)} onBlur={() => sn !== (unit.serial_number || "") && onPatch(unit.id, { serial_number: sn })}
          placeholder="Серийный номер ПК (общий)" className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground" />
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.color}`}>{st.label}</span>
        <select value={unit.status} onChange={e => onPatch(unit.id, { status: e.target.value })}
          className="shrink-0 rounded border border-border bg-card px-1 py-1 text-[11px] text-foreground" style={{ cursor: "pointer" }}>
          <option value="pending">Ожидает</option>
          <option value="assembled">Собран</option>
          <option value="issued">Выдан</option>
        </select>
      </div>
      {filled.length > 0 && (
        <div className="mt-2 grid gap-1.5 border-t border-border/50 pt-2 sm:grid-cols-2">
          {comps.filter(c => c.name).map(c => (
            <CompSerialInput key={c.slot} slot={c.slot}
              label={SLOTS.find(s => s.key === c.slot)?.label || c.slot}
              name={c.name}
              value={unit.comp_serials?.[c.slot] || ""}
              onSave={val => onPatch(unit.id, { comp_slot: c.slot, comp_serial: val })} />
          ))}
        </div>
      )}
    </div>
  )
}

function CompSerialInput({ slot, label, name, value, onSave }: {
  slot: string; label: string; name: string; value: string; onSave: (v: string) => void
}) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return (
    <div className="flex items-center gap-1.5" title={name}>
      <span className="w-24 shrink-0 truncate text-[10px] text-foreground/40" data-slot={slot}>{label}</span>
      <input value={v} onChange={e => setV(e.target.value)} onBlur={() => v !== value && onSave(v)}
        placeholder="серийник" className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground" />
    </div>
  )
}