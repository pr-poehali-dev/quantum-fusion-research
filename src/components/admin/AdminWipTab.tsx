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

  const [syncingWipId, setSyncingWipId] = useState<number | null>(null)
  const [syncDoneWipId, setSyncDoneWipId] = useState<number | null>(null)

  const syncWipOrder = async (w: WipBuild) => {
    if (!w.order_id || !w.id) return
    setSyncingWipId(w.id)
    setSyncDoneWipId(null)
    const res = await api.orders.updateItem({ id: w.order_id, action: "sync_order", item_idx: 0 })
    setSyncingWipId(null)
    if (res.error) { alert(res.error); return }
    setSyncDoneWipId(w.id)
    setTimeout(() => setSyncDoneWipId(null), 3000)
    // Обновляем статусы слотов в локальном стейте
    if (res.reserved) {
      const updates: Record<string, string> = {}
      for (const r of res.reserved) updates[r.slot + "_status"] = "ready"
      for (const r of (res.need_order || [])) updates[r.slot + "_status"] = "need_order"
      setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, ...updates } : b))
    }
  }

  // Корзина закупки по сборкам
  const BASKET_URL = "https://functions.poehali.dev/8b2b8538-7489-4d72-9832-d8894784f957"

  const [basketOpen, setBasketOpen] = useState(false)
  const [basketLoading, setBasketLoading] = useState(false)
  const [basketBuilds, setBasketBuilds] = useState<{
    wip_id: number; order_number: string; order_id: number; stage: string
    items: { group_id: number; name: string; sku: string; required_qty: number; status: string; url_supplier: string | null; slot: string; slot_status: string }[]
  }[]>([])
  const [basketExpanded, setBasketExpanded] = useState<Record<string, boolean>>({})

  const loadBasket = async () => {
    setBasketLoading(true)
    const res = await fetch(`${BASKET_URL}?action=basket_by_wip`)
    const data = await res.json()
    const builds = data.builds || []
    setBasketBuilds(builds)
    // По умолчанию раскрываем все сборки
    const exp: Record<string, boolean> = {}
    for (const b of builds) exp[String(b.wip_id)] = true
    setBasketExpanded(exp)
    setBasketLoading(false)
  }

  const updateBasketStatus = async (groupId: number, status: string, slot: string, wipId: number) => {
    // Обновляем локальный стейт
    setBasketBuilds(prev => prev.map(b => b.wip_id === wipId
      ? { ...b, items: b.items.map(i => i.group_id === groupId ? { ...i, status } : i) }
      : b
    ))
    // Сохраняем в БД
    await fetch(`${BASKET_URL}?action=basket_status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId, status }),
    })
    // Синхронизируем wip_builds.{slot}_status
    const BASKET_TO_WIP: Record<string, string> = { NEW: "need_order", ORDERED: "ordered_transit", RECEIVED: "ready" }
    const wipStatus = BASKET_TO_WIP[status] || "need_order"
    const statusKey = slot === "case" ? "case_status" : slot + "_status"
    setWipBuilds(bs => bs.map(b => b.id === wipId ? { ...b, [statusKey]: wipStatus } : b))
    api.wipBuilds.patch({ id: wipId, component: slot, status: wipStatus })
  }

  const totalNewCount = basketBuilds.reduce((s, b) => s + b.items.filter(i => i.status === "NEW").length, 0)

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

  // Маппинг статусов: purchase_basket (NEW/ORDERED/RECEIVED) ↔ wip_builds slot_status
  const BASKET_TO_WIP: Record<string, string> = {
    NEW: "need_order",
    ORDERED: "ordered_transit",
    RECEIVED: "ready",
  }
  const WIP_TO_BASKET: Record<string, string> = {
    need_order: "NEW",
    ordered_delay: "ORDERED",
    ordered_transit: "ORDERED",
    ready: "RECEIVED",
    pending: "NEW",
  }

  const openOrderList = async () => {
    setOrderListOpen(true)
    setOrderListLoading(true)
    const [orderListData, basketData] = await Promise.all([
      api.warehouse.getOrderList(),
      fetch("https://functions.poehali.dev/8b2b8538-7489-4d72-9832-d8894784f957?action=basket").then(r => r.json()),
    ])
    // Строим маппинг group_id → статус из purchase_basket (источник истины)
    const basketMap: Record<string | number, string> = {}
    for (const b of (basketData.items || [])) {
      basketMap[b.group_id] = BASKET_TO_WIP[b.status] || "need_order"
    }
    const items = (orderListData.items || []).map((g: { group_id: number; product_id: number; name: string; shortage: number; url_supplier: string | null; url_site: string | null; orders: { order_id: number; customer_name: string; shortage: number }[] }) => ({
      ...g,
      order_status: basketMap[g.group_id] || "need_order",
    }))
    // Сортировка: need_order вверх, потом по имени
    items.sort((a: { order_status: string; name: string }, b: { order_status: string; name: string }) => {
      if (a.order_status === "need_order" && b.order_status !== "need_order") return -1
      if (a.order_status !== "need_order" && b.order_status === "need_order") return 1
      return a.name.localeCompare(b.name, "ru")
    })
    setOrderListGroups(items)
    setOrderListLoading(false)
  }

  const updateOrderListStatus = async (groupId: string | number, newStatus: string) => {
    // 1. Обновляем локальный стейт
    setOrderListGroups(prev => {
      const updated = prev.map(item => item.group_id === groupId ? { ...item, order_status: newStatus } : item)
      // Пересортируем
      return [...updated].sort((a, b) => {
        if (a.order_status === "need_order" && b.order_status !== "need_order") return -1
        if (a.order_status !== "need_order" && b.order_status === "need_order") return 1
        return a.name.localeCompare(b.name, "ru")
      })
    })

    // 2. Сохраняем в purchase_basket (источник истины в БД)
    const basketStatus = WIP_TO_BASKET[newStatus] || "NEW"
    await fetch("https://functions.poehali.dev/8b2b8538-7489-4d72-9832-d8894784f957?action=basket_status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId, status: basketStatus }),
    })

    // 3. Синхронизируем wip_builds.{slot}_status для всех активных сборок
    // Находим product_id для данной группы и обновляем слоты в wipBuilds
    for (const w of wipBuilds.filter(wb => !["Архив", "Забрали", "Отменён"].includes(wb.stage))) {
      const slots = ["cpu", "motherboard", "ram", "gpu", "storage", "psu", "case_name", "cooling", "extra"]
      const slotApiNames = ["cpu", "motherboard", "ram", "gpu", "storage", "psu", "case", "cooling", "extra"]
      for (let i = 0; i < slots.length; i++) {
        const slotKey = slots[i]
        const slotApiName = slotApiNames[i]
        const statusKey = slotKey === "case_name" ? "case_status" : slotKey + "_status"
        const curStatus = (w as Record<string, string>)[statusKey]
        // Проверяем соответствие по названию товара (упрощённо)
        // Для точного маппинга нужно знать product_id слота — используем wipBuilds order_id
        if (curStatus === "need_order" && newStatus !== "need_order" ||
            curStatus !== "ready" && newStatus === "ready") {
          // Проверяем через order данной сборки совпадение с group_id
          const g = orderListGroups.find(x => x.group_id === groupId)
          if (g && w.order_id && g.orders.some(o => o.order_id === w.order_id)) {
            setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, [statusKey]: newStatus } : b))
            api.wipBuilds.patch({ id: w.id, component: slotApiName, status: newStatus })
          }
        }
      }
    }
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
          <button onClick={() => { setBasketOpen(v => !v); if (!basketOpen) loadBasket() }}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              totalNewCount > 0
                ? "border-orange-400/40 bg-orange-400/5 text-orange-400 hover:bg-orange-400/10"
                : basketOpen ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-orange-400 hover:text-orange-400"
            }`}
            style={{ cursor: "pointer" }}>
            <Icon name="ShoppingCart" size={15} />
            Корзина закупки
            {totalNewCount > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-400 text-[10px] font-bold text-white">{totalNewCount}</span>
            )}
          </button>
          <button onClick={openOrderList}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/60 hover:border-orange-400 hover:text-orange-400 transition-colors"
            style={{ cursor: "pointer" }}>
            <Icon name="ListOrdered" size={15} />
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

      {/* Корзина закупки по сборкам */}
      {basketOpen && (
        <div className="mb-5 rounded-xl border border-orange-400/20 bg-orange-400/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="ShoppingCart" size={16} className="text-orange-400" />
              <span className="font-medium text-foreground">Корзина закупки</span>
              {!basketLoading && <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-xs text-orange-400">{basketBuilds.reduce((s, b) => s + b.items.length, 0)} позиций</span>}
            </div>
            <button onClick={loadBasket} className="text-foreground/40 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              <Icon name={basketLoading ? "Loader" : "RefreshCw"} size={14} className={basketLoading ? "animate-spin" : ""} />
            </button>
          </div>
          {basketLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-card animate-pulse" />)}</div>
          ) : basketBuilds.length === 0 ? (
            <div className="py-6 text-center">
              <Icon name="CheckCircle" size={28} className="mx-auto mb-2 text-green-400/40" />
              <p className="text-sm text-foreground/40">Всё в наличии — закупать нечего</p>
            </div>
          ) : (
            <div className="space-y-3">
              {basketBuilds.map(build => {
                const key = String(build.wip_id)
                const isOpen = basketExpanded[key]
                const newCnt = build.items.filter(i => i.status === "NEW").length
                return (
                  <div key={key} className="rounded-xl border border-border bg-card overflow-hidden">
                    <button
                      onClick={() => setBasketExpanded(p => ({ ...p, [key]: !p[key] }))}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                      style={{ cursor: "pointer" }}>
                      <div className="flex items-center gap-2.5">
                        <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} size={14} className="text-foreground/30 shrink-0" />
                        <span className="font-mono font-semibold text-sm text-foreground">Сборка #{build.order_number}</span>
                        <span className="text-xs text-foreground/40">{build.stage}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">{build.items.length} позиций</span>
                      </div>
                      {newCnt > 0 && (
                        <span className="rounded-full bg-red-400/10 px-2.5 py-0.5 text-xs font-medium text-red-400">заказать {newCnt}</span>
                      )}
                      {newCnt === 0 && (
                        <span className="rounded-full bg-green-400/10 px-2.5 py-0.5 text-xs font-medium text-green-400">всё заказано</span>
                      )}
                    </button>
                    {isOpen && (
                      <div className="border-t border-border/50 px-4 pb-3 pt-2 space-y-1.5">
                        {build.items.map(item => (
                          <div key={item.group_id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
                                <span className="font-mono text-[10px] text-foreground/40">{item.sku}</span>
                                <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-medium text-red-400">нужно {item.required_qty} шт.</span>
                              </div>
                            </div>
                            {item.url_supplier && (
                              <a href={item.url_supplier} target="_blank" rel="noreferrer"
                                className="shrink-0 text-foreground/30 hover:text-primary transition-colors" title="Купить у поставщика">
                                <Icon name="ExternalLink" size={13} />
                              </a>
                            )}
                            <select
                              value={item.status}
                              onChange={e => updateBasketStatus(item.group_id, e.target.value, item.slot, build.wip_id)}
                              className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-medium focus:outline-none transition-colors ${
                                item.status === "NEW"      ? "border-red-400/40 bg-red-400/5 text-red-400" :
                                item.status === "ORDERED"  ? "border-yellow-400/40 bg-yellow-400/5 text-yellow-400" :
                                item.status === "RECEIVED" ? "border-green-400/40 bg-green-400/5 text-green-400" :
                                "border-border text-foreground/50"
                              }`}
                              style={{ cursor: "pointer" }}>
                              <option value="NEW">Заказать</option>
                              <option value="ORDERED">Заказано</option>
                              <option value="RECEIVED">Получено</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {!basketLoading && basketBuilds.length > 0 && (
            <p className="mt-3 text-xs text-foreground/30 text-center">Статусы сохраняются в БД и синхронизируются со статусами компонентов в сборках</p>
          )}
        </div>
      )}

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
                            {w.stage === "Заказ" && w.order_id && w.id && (
                              <button onClick={() => syncWipOrder(w)}
                                disabled={syncingWipId === w.id}
                                title="Выбить компоненты со склада и создать резервы"
                                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50 ${syncDoneWipId === w.id ? "border-green-400/30 bg-green-400/5 text-green-400" : "border-yellow-400/30 bg-yellow-400/5 text-yellow-400 hover:bg-yellow-400/10"}`}
                                style={{ cursor: "pointer" }}>
                                <Icon name={syncingWipId === w.id ? "Loader" : syncDoneWipId === w.id ? "Check" : "RefreshCw"} size={10} className={syncingWipId === w.id ? "animate-spin" : ""} />
                                {syncDoneWipId === w.id ? "Готово" : "Синх."}
                              </button>
                            )}
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
                          onChange={e => updateOrderListStatus(g.group_id, e.target.value)}
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
              <p className="mt-4 text-xs text-foreground/30 text-center">Статусы синхронизируются со сборками в процессе</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}