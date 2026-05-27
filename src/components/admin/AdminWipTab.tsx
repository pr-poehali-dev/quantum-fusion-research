import { useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import {
  WipBuild, PCBuild, Product, Category, ConfigComponent, AdminTab,
  EMPTY_WIP, WIP_STAGES, WIP_STAGE_COLORS, WIP_COMPONENTS,
  DELIVERY_OPTIONS, COMP_STATUS_LABELS, COMP_STATUS_BG,
} from "@/pages/admin/types"

interface Props {
  tab: AdminTab
  wipBuilds: WipBuild[]
  wipStages: string[]
  loading: boolean
  setWipBuilds: React.Dispatch<React.SetStateAction<WipBuild[]>>
  // для кнопки "Редактировать сборку" из формы WIP
  builds: PCBuild[]
  setBuilds: React.Dispatch<React.SetStateAction<PCBuild[]>>
  products: Product[]
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>
  setConfigSlots: React.Dispatch<React.SetStateAction<Record<string, ConfigComponent[]>>>
  editBuild: () => void
  setTab: (t: AdminTab) => void
}

export function AdminWipTab({
  tab, wipBuilds, wipStages, loading, setWipBuilds,
  builds, setBuilds, products, setProducts, setCategories, setConfigSlots,
  editBuild, setTab,
}: Props) {
  const isArchive = tab === "wip_archive"

  const [wipForm, setWipForm] = useState<WipBuild | null>(null)
  const [wipFormOpen, setWipFormOpen] = useState(false)
  const [wipEditMode, setWipEditMode] = useState(false)
  const [wipPasteId, setWipPasteId] = useState<number | null>(null)
  const [wipColWidths, setWipColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("wip_col_widths") || "{}") } catch { return {} }
  })

  // Заказной список
  const [orderListOpen, setOrderListOpen] = useState(false)
  const [orderListLoading, setOrderListLoading] = useState(false)
  const [orderListGroups, setOrderListGroups] = useState<{
    group_id: string | number; name: string; shortage: number
    url_supplier?: string | null; url_site?: string | null; product_id?: number
    order_status: string
    orders: { order_id: number; customer_name: string; shortage: number }[]
  }[]>([])

  const saveWip = async () => {
    if (!wipForm) return
    if (wipForm.id) {
      await api.wipBuilds.update(wipForm)
      setWipBuilds(bs => bs.map(b => b.id === wipForm.id ? { ...b, ...wipForm } : b))
    } else {
      const res = await api.wipBuilds.create(wipForm)
      if (res.id) setWipBuilds(bs => [...bs, { ...wipForm, id: res.id }])
    }
    setWipFormOpen(false)
  }

  const deleteWip = async (id: number) => {
    if (!confirm("Удалить сборку из списка?")) return
    await api.wipBuilds.delete(id)
    setWipBuilds(bs => bs.filter(b => b.id !== id))
  }

  const openOrderList = async () => {
    setOrderListOpen(true)
    setOrderListLoading(true)
    const d = await api.warehouse.getOrderList()
    const saved = (() => { try { return JSON.parse(localStorage.getItem("order_list_statuses") || "{}") } catch { return {} } })()
    setOrderListGroups((d.items || []).map((g: { group_id: number; product_id: number; name: string; shortage: number; url_supplier: string | null; url_site: string | null; orders: { order_id: number; customer_name: string; shortage: number }[] }) => ({
      ...g,
      order_status: saved[g.group_id] || "need_order"
    })))
    setOrderListLoading(false)
  }

  const DEFAULT_COL_W = 220
  const setColWidth = (id: string, w: number) => {
    const next = { ...wipColWidths, [id]: Math.max(120, w) }
    setWipColWidths(next)
    localStorage.setItem("wip_col_widths", JSON.stringify(next))
  }
  const startResize = (id: string, startX: number, startW: number) => {
    const onMove = (e: MouseEvent) => setColWidth(id, startW + e.clientX - startX)
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  if (isArchive) {
    const archived = wipBuilds.filter(w => ["Архив", "Отменён", "Забрали"].includes(w.stage))
    return (
      <div>
        <div className="mb-5">
          <h2 className="text-xl font-light text-foreground">
            Архив сборок <span className="ml-1 text-sm text-foreground/40">({archived.length})</span>
          </h2>
        </div>
        {loading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-card animate-pulse" />)}</div>
        ) : archived.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <Icon name="ArchiveRestore" size={36} className="mx-auto mb-3 text-foreground/20" />
            <p className="text-sm text-foreground/40">Архив пуст</p>
          </div>
        ) : (
          <div className="space-y-2">
            {archived.map(w => (
              <div key={w.id} className="flex items-center gap-4 rounded-xl border border-border/50 bg-card px-5 py-4 opacity-70">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono font-bold text-foreground text-sm">Заказ {w.order_number}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${WIP_STAGE_COLORS[w.stage] || "bg-muted text-foreground/50"}`}>{w.stage}</span>
                    {w.issued_at && <span className="text-xs text-foreground/40">выдан: {new Date(w.issued_at).toLocaleDateString("ru-RU")}</span>}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-foreground/50">
                    {w.customer_name && <span className="font-medium text-foreground/70">{w.customer_name}</span>}
                    {(w.customer_phone || w.contact) && <span className="font-mono text-primary/60">{w.customer_phone || w.contact}</span>}
                    {w.total && <span className="font-semibold text-foreground/60">{w.total.toLocaleString("ru-RU")} ₽</span>}
                    {w.delivery_type && <span>{w.delivery_type}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {WIP_COMPONENTS.filter(c => (w as Record<string, string>)[c.key]).map(c => {
                      const val = (w as Record<string, string>)[c.key]
                      const statusKey = c.key === "case_name" ? "case_status" : c.key + "_status"
                      const status = (w as Record<string, string>)[statusKey] || "pending"
                      const { cls } = COMP_STATUS_LABELS[status] || COMP_STATUS_LABELS.pending
                      return (
                        <span key={c.key} className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${cls}`}>{val}</span>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // wip_builds (active)
  const activeBuilds = wipBuilds.filter(w => !["Архив", "Отменён"].includes(w.stage))
  const usedComps = WIP_COMPONENTS.filter(c => activeBuilds.some(w => !!(w as Record<string, string>)[c.key]))
  const rows: { key: string; label: string }[] = [
    { key: "_order", label: "Заказ" },
    { key: "_stage", label: "Этап" },
    { key: "_client", label: "Клиент" },
    { key: "_received_at", label: "Железо придёт" },
    { key: "_issued_at", label: "Дата выдачи" },
    { key: "_delivery", label: "Получение" },
    ...usedComps.map(c => ({ key: c.key, label: c.label })),
    { key: "_actions", label: "" },
  ]

  return (
    <div>
      {/* Шапка */}
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-light text-foreground">
          Сборки в процессе <span className="ml-1 text-sm text-foreground/40">({activeBuilds.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={openOrderList}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/60 hover:border-orange-400 hover:text-orange-400 transition-colors"
            style={{ cursor: "pointer" }}>
            <Icon name="ShoppingCart" size={15} />
            Заказной список
          </button>
          <button onClick={() => setWipEditMode(v => !v)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${wipEditMode ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>
            <Icon name={wipEditMode ? "Eye" : "Pencil"} size={15} />
            {wipEditMode ? "Просмотр" : "Ред. железо"}
          </button>
          <button onClick={() => { setWipForm({ ...EMPTY_WIP }); setWipFormOpen(true) }}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={15} />Новая сборка
          </button>
        </div>
      </div>

      {/* Форма создания/редактирования */}
      {wipFormOpen && wipForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-10" style={{ cursor: "auto" }}>
          <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <button onClick={() => setWipFormOpen(false)} className="absolute right-4 top-4 text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
              <Icon name="X" size={18} />
            </button>
            <h3 className="mb-5 text-lg font-medium text-foreground">{wipForm.id ? `Сборка #${wipForm.order_number}` : "Новая сборка"}</h3>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/50">Номер заказа *</label>
                  <input value={wipForm.order_number} onChange={e => setWipForm(f => f && ({ ...f, order_number: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="например 337" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/50">Этап</label>
                  <select value={wipForm.stage} onChange={e => setWipForm(f => f && ({ ...f, stage: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    {(wipStages.length ? wipStages : WIP_STAGES).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/50">Контакт клиента</label>
                  <input value={wipForm.contact} onChange={e => setWipForm(f => f && ({ ...f, contact: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="@username или телефон" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/50">Способ получения</label>
                  <select value={wipForm.delivery_type} onChange={e => setWipForm(f => f && ({ ...f, delivery_type: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    <option value="">Не выбрано</option>
                    {DELIVERY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/50">Дата получения железа</label>
                  <input type="date" value={wipForm.received_at} onChange={e => setWipForm(f => f && ({ ...f, received_at: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/50">Планируемая выдача</label>
                  <input type="date" value={wipForm.issued_at} onChange={e => setWipForm(f => f && ({ ...f, issued_at: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/50">Комментарий</label>
                <textarea value={wipForm.comment} onChange={e => setWipForm(f => f && ({ ...f, comment: e.target.value }))} rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none resize-none" style={{ cursor: "text" }} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-foreground/50">Комплектующие</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {WIP_COMPONENTS.map(c => (
                    <div key={c.key}>
                      <label className="mb-1 block text-xs text-foreground/40">{c.label}</label>
                      <input value={(wipForm as Record<string, string>)[c.key] || ""}
                        onChange={e => setWipForm(f => f && ({ ...f, [c.key]: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={saveWip}
                  className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                  Сохранить
                </button>
                {wipForm.build_id && (
                  <button onClick={async () => {
                    setWipFormOpen(false)
                    const buildId = wipForm.build_id!
                    if (!builds.find(x => x.id === buildId)) {
                      const [buildData, prodData] = await Promise.all([
                        api.builds.getById(buildId),
                        products.length ? Promise.resolve(null) : api.products.getAll(),
                      ])
                      if (prodData) {
                        const prods = prodData.products || []
                        setProducts(prods)
                        setCategories(prodData.categories || [])
                        const slots: Record<string, ConfigComponent[]> = {}
                        for (const p of prods) {
                          const slot = p.category?.slug || "other"
                          if (!slots[slot]) slots[slot] = []
                          slots[slot].push({ id: p.id, slot, name: p.name, brand: p.category?.name, price: p.price })
                        }
                        setConfigSlots(slots)
                      }
                      if (buildData?.id) {
                        setBuilds(bs => bs.some(x => x.id === buildData.id) ? bs : [...bs, buildData])
                      }
                    }
                    editBuild()
                    setTab("add_build")
                  }}
                    className="flex items-center gap-2 rounded-lg border border-border px-5 py-2 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Wrench" size={14} />Редактировать сборку
                  </button>
                )}
                <button onClick={() => setWipFormOpen(false)}
                  className="rounded-lg border border-border px-5 py-2 text-sm text-foreground/60 hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Паста для менеджера */}
      {wipPasteId !== null && (() => {
        const w = wipBuilds.find(x => x.id === wipPasteId)
        if (!w) return null
        const comps = WIP_COMPONENTS.filter(c => (w as Record<string, string>)[c.key]).map(c => `• ${c.label}: ${(w as Record<string, string>)[c.key]}`).join("\n")
        const clientName = w.customer_name || "клиент"
        const clientPhone = w.customer_phone || w.contact || "—"
        const paste = `Здравствуйте, ${clientName}! 👋\n\nВаш заказ #${w.order_number} принят. Уточняем детали.\n\nКонфигурация:\n${comps}\n\nЕсть ли пожелания по изменениям в составе?\n\nГде будете забирать?\nУ нас два офиса в Москве — на Новокосино и Беляево. Также доставляем курьером Яндекса по Москве и отправляем через СДЭК по всей России. Доставка за счёт получателя.`
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" style={{ cursor: "auto" }}>
            <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
              <button onClick={() => setWipPasteId(null)} className="absolute right-4 top-4 text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                <Icon name="X" size={18} />
              </button>
              <div className="mb-4 flex items-center gap-4 rounded-xl bg-muted/50 px-4 py-3">
                <div><p className="text-xs text-foreground/40">Клиент</p><p className="text-sm font-medium text-foreground">{w.customer_name || "—"}</p></div>
                <div><p className="text-xs text-foreground/40">Телефон</p><p className="text-sm font-medium text-primary">{clientPhone}</p></div>
                {w.contact && <div><p className="text-xs text-foreground/40">TG / контакт</p><p className="text-sm font-medium text-foreground">{w.contact}</p></div>}
              </div>
              <p className="mb-2 text-sm font-medium text-foreground">Паста · Заказ #{w.order_number}</p>
              <pre className="mb-4 whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-xs text-foreground/80 leading-relaxed">{paste}</pre>
              <button onClick={() => { navigator.clipboard.writeText(paste); setWipPasteId(null) }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="Copy" size={15} />Скопировать
              </button>
            </div>
          </div>
        )
      })()}

      {/* Таблица */}
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-card animate-pulse" />)}</div>
      ) : activeBuilds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Icon name="Hammer" size={36} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">Сборок в процессе нет</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="text-xs border-collapse" style={{ minWidth: "100%" }}>
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-2.5 text-left font-mono text-foreground/30 uppercase tracking-wider whitespace-nowrap border-r border-border/50 w-28">Поле</th>
                {activeBuilds.map(w => {
                  const colId = String(w.id)
                  const colW = wipColWidths[colId] ?? DEFAULT_COL_W
                  return (
                    <th key={w.id} className={`relative px-3 py-2.5 text-left whitespace-nowrap ${w.stage === "Забрали" ? "opacity-40" : ""}`}
                      style={{ width: colW, minWidth: colW }}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-semibold text-foreground text-xs">#{w.order_number}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${WIP_STAGE_COLORS[w.stage] || "bg-muted text-foreground/50"}`}>{w.stage}</span>
                      </div>
                      <div
                        onMouseDown={e => startResize(colId, e.clientX, colW)}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 transition-colors"
                        style={{ cursor: "col-resize" }} />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 font-mono text-[10px] text-foreground/40 uppercase tracking-wide border-r border-border/30 whitespace-nowrap bg-muted/10">{row.label}</td>
                  {activeBuilds.map(w => {
                    const bg = row.key.startsWith("_") ? "" : COMP_STATUS_BG[(w as Record<string, string>)[row.key + "_status"] || "pending"] || ""
                    return (
                      <td key={w.id} className={`px-3 py-2 align-top border-r border-border/20 last:border-0 ${bg} ${w.stage === "Забрали" ? "opacity-40" : ""}`}>
                        {row.key === "_order" && (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => { setWipForm(w); setWipFormOpen(true) }}
                              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                              style={{ cursor: "pointer" }}>
                              <Icon name="Pencil" size={10} />Ред.
                            </button>
                            <button onClick={() => setWipPasteId(w.id!)}
                              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                              style={{ cursor: "pointer" }}>
                              <Icon name="Copy" size={10} />Паста
                            </button>
                            {w.id && <button onClick={() => deleteWip(w.id!)}
                              className="flex h-5 w-5 items-center justify-center rounded text-foreground/20 hover:bg-red-400/10 hover:text-red-400 transition-colors"
                              style={{ cursor: "pointer" }}>
                              <Icon name="Trash2" size={10} />
                            </button>}
                          </div>
                        )}
                        {row.key === "_stage" && (
                          <select value={w.stage}
                            onChange={e => {
                              const newStage = e.target.value
                              setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, stage: newStage } : b))
                              api.wipBuilds.update({ ...w, stage: newStage })
                            }}
                            className={`rounded-full border-0 px-2 py-0.5 text-[10px] font-semibold focus:outline-none cursor-pointer ${WIP_STAGE_COLORS[w.stage] || "bg-muted text-foreground/50"}`}
                            style={{ cursor: "pointer" }}>
                            {(wipStages.length ? wipStages : WIP_STAGES).map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                        {row.key === "_client" && (
                          <div className="space-y-0.5">
                            {w.customer_name && <p className="text-xs font-medium text-foreground">{w.customer_name}</p>}
                            {(w.customer_phone || w.contact) && <p className="text-[10px] text-primary/80 font-mono">{w.customer_phone || w.contact}</p>}
                            {w.total && <p className="text-[10px] text-foreground/50 font-semibold">{w.total.toLocaleString("ru-RU")} ₽</p>}
                          </div>
                        )}
                        {row.key === "_received_at" && <span className="text-foreground/60">{w.received_at ? new Date(w.received_at).toLocaleDateString("ru-RU") : "—"}</span>}
                        {row.key === "_issued_at" && <span className="text-foreground/60">{w.issued_at ? new Date(w.issued_at).toLocaleDateString("ru-RU") : "—"}</span>}
                        {row.key === "_delivery" && <span className="text-foreground/60 text-[10px]">{w.delivery_type || "—"}</span>}
                        {row.key === "_actions" && (
                          <div className="flex gap-1">
                            {w.client_token && (
                              <a href={`/build?token=${w.client_token}`} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] text-foreground/50 hover:border-primary hover:text-primary transition-colors">
                                <Icon name="ExternalLink" size={10} />Ссылка
                              </a>
                            )}
                          </div>
                        )}
                        {!row.key.startsWith("_") && (() => {
                          const val = (w as Record<string, string>)[row.key] || ""
                          const statusKey = row.key === "case_name" ? "case_status" : row.key + "_status"
                          const status = (w as Record<string, string>)[statusKey] || "pending"
                          const { cls: sCls, label: sLabel } = COMP_STATUS_LABELS[status] || COMP_STATUS_LABELS.pending
                          return val ? (
                            <div className="space-y-1">
                              <p className="text-xs text-foreground/80 leading-snug">{val}</p>
                              <div>
                                {wipEditMode ? (
                                  <select value={status}
                                    onChange={e => {
                                      const v = e.target.value
                                      setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, [statusKey]: v } : b))
                                      api.wipBuilds.patch({ id: w.id, component: row.key === "case_name" ? "case" : row.key, status: v })
                                    }}
                                    className={`rounded-full border-0 px-1.5 py-0 text-[10px] font-semibold focus:outline-none w-fit ${sCls}`}
                                    style={{ cursor: "pointer" }}>
                                    {Object.entries(COMP_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                  </select>
                                ) : (
                                  status !== "pending" && (
                                    <span className={`rounded-full px-1.5 py-0 text-[10px] font-semibold w-fit ${sCls}`}>{sLabel}</span>
                                  )
                                )}
                              </div>
                            </div>
                          ) : <span className="text-foreground/20">—</span>
                        })()}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* OrderList Modal */}
      {orderListOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-10" style={{ cursor: "auto" }}>
          <div className="relative w-full max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <button onClick={() => setOrderListOpen(false)} className="absolute right-4 top-4 text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
              <Icon name="X" size={18} />
            </button>
            <div className="mb-5 flex items-center gap-3">
              <Icon name="ShoppingCart" size={20} className="text-orange-400" />
              <h3 className="text-lg font-medium text-foreground">Заказной список</h3>
              {!orderListLoading && <span className="rounded-full bg-orange-400/10 px-2.5 py-0.5 text-xs font-medium text-orange-400">{orderListGroups.length} позиций</span>}
            </div>
            {orderListLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted/40 animate-pulse" />)}</div>
            ) : orderListGroups.length === 0 ? (
              <div className="py-12 text-center">
                <Icon name="CheckCircle" size={40} className="mx-auto mb-3 text-green-400/40" />
                <p className="text-sm text-foreground/40">Список пуст</p>
              </div>
            ) : (
              <div className="space-y-3">
                {orderListGroups.map(g => (
                  <div key={String(g.group_id)} className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-sm text-foreground">{g.name}</span>
                          <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs text-red-400 font-medium">−{g.shortage} шт.</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {g.url_supplier && <a href={g.url_supplier} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:border-primary hover:text-primary transition-colors"><Icon name="ExternalLink" size={12} />Купить</a>}
                          {!g.url_supplier && (g.url_site || g.product_id) && <a href={g.url_site || `/product/${g.product_id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:border-primary hover:text-primary transition-colors"><Icon name="Globe" size={12} />Сайт</a>}
                          {!g.url_supplier && !g.url_site && !g.product_id && <span className="text-xs text-foreground/25">нет ссылки</span>}
                        </div>
                        {g.orders.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {g.orders.map(o => (
                              <a key={o.order_id} href={`/admin/order/${o.order_id}`} className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-xs text-foreground/50 hover:text-primary hover:bg-primary/10 transition-colors" title={o.customer_name}>
                                <span className="font-mono font-semibold text-foreground/70">#{String(o.order_id).padStart(4, "0")}</span>
                                <span className="text-foreground/40">{o.customer_name}</span>
                                <span className="text-red-400 font-medium">−{o.shortage}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        <select value={g.order_status}
                          onChange={e => {
                            const newStatus = e.target.value
                            setOrderListGroups(prev => prev.map(item => item.group_id === g.group_id ? { ...item, order_status: newStatus } : item))
                            const saved = (() => { try { return JSON.parse(localStorage.getItem("order_list_statuses") || "{}") } catch { return {} } })()
                            saved[String(g.group_id)] = newStatus
                            localStorage.setItem("order_list_statuses", JSON.stringify(saved))
                          }}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium focus:outline-none transition-colors ${g.order_status === "need_order" ? "border-red-400/40 bg-red-500/10 text-red-400" : g.order_status === "ordered_delay" ? "border-orange-400/40 bg-orange-500/10 text-orange-400" : g.order_status === "ordered_transit" ? "border-yellow-400/40 bg-yellow-500/10 text-yellow-400" : g.order_status === "ready" ? "border-green-400/40 bg-green-500/10 text-green-400" : "border-border bg-muted/50 text-foreground/40"}`}
                          style={{ cursor: "pointer" }}>
                          <option value="need_order">Заказать</option>
                          <option value="ordered_delay">Задержка</option>
                          <option value="ordered_transit">Едет</option>
                          <option value="ready">Есть</option>
                          <option value="pending">—</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!orderListLoading && orderListGroups.length > 0 && (
              <p className="mt-4 text-xs text-foreground/30 text-center">Статусы сохраняются локально в браузере</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}