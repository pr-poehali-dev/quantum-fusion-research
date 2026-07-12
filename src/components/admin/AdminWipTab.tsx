import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import PrepaymentEditor from "@/components/admin/PrepaymentEditor"
import PrepaymentConfirmModal from "@/components/admin/PrepaymentConfirmModal"
import { WipMarginModal } from "@/components/admin/WipEditModal"
import { SCHEDULE_URL, authH, withAk, Employee } from "@/components/admin/schedule.types"
import {
  WipBuild, PCBuild, Product, Category, ConfigComponent, AdminTab,
  EMPTY_WIP, WIP_STAGES, WIP_STAGE_COLORS, WIP_COMPONENTS,
  DELIVERY_OPTIONS, COMP_STATUS_LABELS, COMP_STATUS_BG,
} from "@/pages/admin/types"

interface WipStore { id: number; name: string; code: string }

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
  editBuild: (buildId?: number) => void
  setTab: (t: AdminTab) => void
}

export function AdminWipTab({
  tab, wipBuilds, wipStages, loading, setWipBuilds,
  builds, setBuilds, products, setProducts, setCategories, setConfigSlots,
  editBuild, setTab,
}: Props) {
  const { sessionId } = useAuth()
  const navigate = useNavigate()
  const [viewArchive, setViewArchive] = useState(false)
  const isArchive = viewArchive

  // Модалка маржи (кнопка-смайлик)
  const [marginWip, setMarginWip] = useState<WipBuild | null>(null)

  // Сотрудники для выбора сборщика прямо в таблице
  const [employees, setEmployees] = useState<Employee[]>([])
  useEffect(() => {
    fetch(`${SCHEDULE_URL}?${withAk("action=employees")}`, { headers: authH(sessionId || "") })
      .then(r => r.json())
      .then(d => setEmployees(d.employees || []))
      .catch(() => {})
  }, [sessionId])

  const setAssembler = (w: WipBuild, empId: number | null) => {
    const emp = employees.find(e => e.id === empId)
    setWipBuilds(bs => bs.map(b => b.id === w.id
      ? { ...b, assembled_by: empId, assembler_name: emp ? emp.name : null }
      : b))
    api.wipBuilds.update({ ...w, assembled_by: empId })
  }

  const [wipForm, setWipForm] = useState<WipBuild | null>(null)
  const [wipFormOpen, setWipFormOpen] = useState(false)
  const [wipEditMode, setWipEditMode] = useState(false)
  const [wipPasteId, setWipPasteId] = useState<number | null>(null)
  const [wipColWidths, setWipColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("wip_col_widths") || "{}") } catch { return {} }
  })

  const [syncingWipId, setSyncingWipId] = useState<number | null>(null)
  const [syncDoneWipId, setSyncDoneWipId] = useState<number | null>(null)

  // Договор поставки прямо из сборки (в т.ч. на этапе «Согласование»).
  // Если заказа ещё нет — создаём его (на согласовании без резервов), затем PDF.
  const CONTRACT_URL = "https://functions.poehali.dev/7db163ee-2c8f-43e0-af32-d7c98db8f5e4"
  const [contractWipId, setContractWipId] = useState<number | null>(null)
  const openWipContract = async (w: WipBuild) => {
    setContractWipId(w.id!)
    try {
      let orderId = w.order_id
      if (!orderId) {
        const ens = await api.wipBuilds.ensureOrder(w.id!)
        if (ens?.error) { alert(ens.error); return }
        orderId = ens?.order_id
        if (orderId) {
          setWipBuilds(bs => bs.map(b => b.id === w.id
            ? { ...b, order_id: ens.order_id, total: ens.total ?? b.total } : b))
        }
      }
      if (!orderId) { alert("Не удалось подготовить заказ для договора"); return }
      const res = await fetch(`${CONTRACT_URL}?order_id=${orderId}`).then(r => r.json()).catch(() => null)
      if (!res?.pdf_b64) { alert("Не удалось создать договор"); return }
      const link = document.createElement("a")
      link.href = `data:application/pdf;base64,${res.pdf_b64}`
      link.download = res.filename || `contract_${orderId}.pdf`
      document.body.appendChild(link); link.click(); link.remove()
    } finally {
      setContractWipId(null)
    }
  }

  // Модалка подтверждения предоплаты при переходе «Согласование → Заказ»
  const [prepayModal, setPrepayModal] = useState<WipBuild | null>(null)
  // Модалка оплаты остатка перед выдачей («Забрали»)
  const [remainingModal, setRemainingModal] = useState<WipBuild | null>(null)

  // Сменить этап с проверкой: переход в «Заказ» требует подтверждения предоплаты,
  // переход в «Забрали» требует выбранного сборщика и переводит заказ в done
  // (тогда сборщику начислится % от суммы ПК).
  const changeStage = async (w: WipBuild, newStage: string) => {
    if (newStage === "Заказ" && w.stage === "Согласование" && !w.for_sale) {
      // Для сборок «в свободную продажу» предоплата не требуется — пропускаем модалку.
      // Для вручную созданной сборки заказа ещё нет — создаём его,
      // чтобы появилась сумма для предоплаты и работали резервы.
      let target = w
      if (!w.order_id || !w.total) {
        const res = await api.wipBuilds.ensureOrder(w.id!)
        if (res?.error) { alert(res.error); return }
        if (res?.order_id) {
          target = { ...w, order_id: res.order_id, total: res.total ?? w.total }
          setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, order_id: res.order_id, total: res.total ?? b.total } : b))
        }
      }
      setPrepayModal(target)
      return
    }
    if (newStage === "Забрали" && w.stage !== "Забрали") {
      if (!w.assembled_by) {
        alert("Нельзя выдать ПК без сборщика. Откройте «Ред.» и выберите сборщика.")
        return
      }
      // Для свободной продажи заказ мог не создаваться (предоплату пропускали) —
      // создаём его сейчас, чтобы при выдаче открылось окно оплаты полной суммы.
      let target = w
      if (!target.order_id) {
        const ens = await api.wipBuilds.ensureOrder(w.id!)
        if (ens?.error) { alert(ens.error); return }
        if (ens?.order_id) {
          target = { ...w, order_id: ens.order_id, total: ens.total ?? w.total }
          setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, order_id: ens.order_id, total: ens.total ?? b.total } : b))
        }
      }
      // Переводим заказ в done — backend начислит % сборщику
      if (target.order_id) {
        const res = await api.orders.updateStatus({ id: target.order_id, status: "done" })
        if (res?.error === "remaining_unpaid") { setRemainingModal(target); return }
        if (res?.error) { alert(res.error); return }
      }
    }
    setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, stage: newStage } : b))
    api.wipBuilds.update({ ...w, stage: newStage })
  }

  const onPrepayConfirmed = (w: WipBuild, amount: number, remaining: number) => {
    setWipBuilds(bs => bs.map(b => b.id === w.id
      ? { ...b, stage: "Заказ", prepayment_amount: amount, remaining_amount: remaining }
      : b))
    api.wipBuilds.update({ ...w, stage: "Заказ" })
    setPrepayModal(null)
  }

  // После оплаты остатка — повторяем выдачу («Забрали»)
  const onRemainingConfirmed = async (w: WipBuild) => {
    setRemainingModal(null)
    if (w.order_id) {
      const res = await api.orders.updateStatus({ id: w.order_id, status: "done" })
      if (res?.error) { alert(res.error); return }
    }
    setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, stage: "Забрали" } : b))
    api.wipBuilds.update({ ...w, stage: "Забрали" })
  }

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
    items: { group_id: number; name: string; sku: string; required_qty: number; status: string; url_supplier: string | null; slot: string; slot_status: string; eta_date: string | null; is_delayed: boolean; store_id: number | null }[]
  }[]>([])
  const [basketExpanded, setBasketExpanded] = useState<Record<string, boolean>>({})

  // Магазины (откуда поедет железка) — для удобства и календаря заборов
  const [stores, setStores] = useState<WipStore[]>([])
  // Выбор магазина по позиции (ключ "wipId:slot"). Источник — БД (приходит в корзине).
  const [itemStore, setItemStore] = useState<Record<string, string>>({})
  // Статус сохранения магазина по ключу: "saving" | "ok" | "err"
  const [storeSaveState, setStoreSaveState] = useState<Record<string, "saving" | "ok" | "err">>({})

  // Короткий звук подтверждения/ошибки через Web Audio (без внешних файлов)
  const beep = (ok: boolean) => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = "sine"
      osc.frequency.value = ok ? 880 : 220
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
      osc.start()
      if (ok) osc.frequency.setValueAtTime(1175, ctx.currentTime + 0.09)
      osc.stop(ctx.currentTime + 0.19)
      osc.onended = () => ctx.close()
    } catch { /* звук не критичен */ }
  }

  const setComponentStore = async (wipId: number, slot: string, storeId: string) => {
    const key = `${wipId}:${slot}`
    const prevVal = itemStore[key] || ""
    setItemStore(prev => ({ ...prev, [key]: storeId }))
    setStoreSaveState(prev => ({ ...prev, [key]: "saving" }))
    try {
      const r = await fetch(`${BASKET_URL}?action=set_component_store`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wip_id: wipId, slot, store_id: storeId || null }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d?.error) throw new Error(d?.error || "save_failed")
      setStoreSaveState(prev => ({ ...prev, [key]: "ok" }))
      beep(true)
      setTimeout(() => setStoreSaveState(prev => { const n = { ...prev }; delete n[key]; return n }), 1500)
    } catch {
      // откатываем значение, чтобы пользователь видел, что НЕ сохранилось
      setItemStore(prev => ({ ...prev, [key]: prevVal }))
      setStoreSaveState(prev => ({ ...prev, [key]: "err" }))
      beep(false)
      alert("Не удалось сохранить магазин. Проверьте интернет и попробуйте ещё раз.")
    }
  }
  useEffect(() => {
    api.warehouse.getStores().then((d: unknown) => {
      if (Array.isArray(d)) setStores(d as WipStore[])
    }).catch(() => {})
    // Предзагрузка корзины закупки, чтобы индикатор задолженности светился
    // ещё до открытия корзины (иначе basketBuilds пуст и подсветки нет).
    loadBasket()
     
  }, [])

  const loadBasket = async () => {
    setBasketLoading(true)
    const res = await fetch(`${BASKET_URL}?action=basket_by_wip`)
    const data = await res.json()
    const builds = data.builds || []
    setBasketBuilds(builds)
    // Раскрываем только сборки, где есть незаказанные позиции (NEW).
    // «Всё заказано» — оставляем свёрнутыми.
    const exp: Record<string, boolean> = {}
    const storeMap: Record<string, string> = {}
    for (const b of builds) {
      const hasNew = b.items.some((i: { status: string }) => i.status === "NEW")
      exp[String(b.wip_id)] = hasNew
      // Подтягиваем выбранный магазин из БД
      for (const it of b.items) {
        if (it.store_id) storeMap[`${b.wip_id}:${it.slot}`] = String(it.store_id)
      }
    }
    setBasketExpanded(exp)
    setItemStore(storeMap)
    setBasketLoading(false)
  }

  // Дата прихода железки = «Заказано». Сервер ставит статус «Едет»/«Задержка»,
  // обновляет дату прихода сборки и авто-этап.
  const setComponentEta = async (slot: string, wipId: number, etaDate: string) => {
    const today = new Date().toISOString().substring(0, 10)
    const newStatus = etaDate ? "ORDERED" : "NEW"
    setBasketBuilds(prev => prev.map(b => b.wip_id === wipId
      ? { ...b, items: b.items.map(i => i.slot === slot
          ? { ...i, eta_date: etaDate || null, status: newStatus, is_delayed: !!etaDate && etaDate < today }
          : i) }
      : b
    ))
    const statusKey = slot === "case" ? "case_status" : slot + "_status"
    const wipStatus = etaDate ? (etaDate < today ? "ordered_delay" : "ordered_transit") : "need_order"
    setWipBuilds(bs => bs.map(b => b.id === wipId ? { ...b, [statusKey]: wipStatus } : b))
    const curStore = itemStore[`${wipId}:${slot}`]
    const res = await fetch(`${BASKET_URL}?action=set_component_eta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wip_id: wipId, slot, eta_date: etaDate || null, store_id: curStore || null }),
    })
    const data = await res.json()
    // Авто-этап и дата прихода сборки могли измениться на сервере
    if (data.auto_stage) {
      setWipBuilds(bs => bs.map(b => b.id === wipId ? { ...b, stage: data.auto_stage, received_at: data.received_at ?? b.received_at } : b))
    } else if (data.received_at !== undefined) {
      setWipBuilds(bs => bs.map(b => b.id === wipId ? { ...b, received_at: data.received_at } : b))
    }
  }

  const totalNewCount = basketBuilds.reduce((s, b) => s + b.items.filter(i => i.status === "NEW").length, 0)
  // Задолженность = все незавершённые позиции корзины (NEW + ORDERED),
  // т.е. всё, что ещё не получено (RECEIVED). Используется для подсветки.
  const totalDebtCount = basketBuilds.reduce((s, b) => s + b.items.filter(i => i.status !== "RECEIVED").length, 0)

  // Этап «Готов, можно забрать» у сборки в свободной продаже показываем как «В продаже»
  const stageLabel = (w: WipBuild) =>
    w.for_sale && w.stage === "Готов, можно забрать" ? "В продаже" : w.stage



  const saveWip = async () => {
    if (!wipForm) return
    if (wipForm.id) {
      await api.wipBuilds.update(wipForm)
      setWipBuilds(bs => bs.map(b => b.id === wipForm.id ? { ...b, ...wipForm } : b))
    } else {
      const res = await api.wipBuilds.create(wipForm)
      if (res.id) setWipBuilds(bs => [...bs, { ...wipForm, id: res.id, order_number: res.order_number || wipForm.order_number }])
    }
    setWipFormOpen(false)
  }

  // Скопировать сборку: открываем форму новой сборки с теми же комплектующими
  const copyWip = (w: WipBuild) => {
    setWipForm({
      ...EMPTY_WIP,
      cpu: w.cpu, motherboard: w.motherboard, ram: w.ram, gpu: w.gpu,
      storage: w.storage, psu: w.psu, case_name: w.case_name, cooling: w.cooling, extra: w.extra,
      delivery_type: w.delivery_type, comment: w.comment,
      customer_name: w.customer_name, customer_phone: w.customer_phone, contact: w.contact,
      total: w.total,
    })
    setWipFormOpen(true)
  }

  // Создать карточку сборки в каталоге «Наши ПК» из WIP и открыть её на редактирование.
  // Бэкенд (action=from_wip) сам ищет товары по названию и привязывает source_id,
  // чтобы работали склад/резервы. Ненайденные остаются custom для ручного выбора.
  const createCatalogBuild = async () => {
    if (!wipForm?.id) return
    const res = await api.builds.fromWip(wipForm.id)
    if (!res?.id) { alert(res?.error || "Не удалось создать сборку"); return }

    setWipBuilds(bs => bs.map(b => b.id === wipForm.id ? { ...b, build_id: res.id } : b))

    // подгружаем данные сборки и товары, открываем редактор каталога
    const [buildData, prodData] = await Promise.all([
      api.builds.getById(res.id),
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
    if (buildData?.id) setBuilds(bs => bs.some(x => x.id === buildData.id) ? bs : [...bs, buildData])
    setWipFormOpen(false)
    if (res.unmatched > 0) {
      alert(`Сборка создана. Найдено на складе: ${res.matched}, не найдено: ${res.unmatched}. Подберите недостающие комплектующие вручную.`)
    }
    editBuild(res.id)
  }

  const deleteWip = async (w: WipBuild) => {
    if (!confirm(`Удалить сборку #${w.order_number}?\nВсе резервы по заказу будут сняты.`)) return
    await api.warehouse.deleteWip(w.id!)
    setWipBuilds(bs => bs.filter(b => b.id !== w.id))
  }

  // Отмена заказа
  const [cancelModal, setCancelModal] = useState<WipBuild | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)

  const openCancelModal = (w: WipBuild) => setCancelModal(w)

  const confirmCancel = async () => {
    if (!cancelModal) return
    setCancelLoading(true)
    const WIP_URL = "https://functions.poehali.dev/6a3fdc40-04ab-4ef6-932b-4b24e530ee98"
    const res = await fetch(WIP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel_order", wip_id: cancelModal.id }),
    })
    const data = await res.json()
    setCancelLoading(false)
    if (!res.ok || data.error) {
      alert(data.error || "Ошибка при отмене")
      return
    }
    setWipBuilds(bs => bs.filter(b => b.id !== cancelModal.id))
    setCancelModal(null)
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

  // Список сборок для отображения: активные или архивные (тем же табличным видом)
  const activeBuilds = isArchive
    ? wipBuilds.filter(w => ["Архив", "Отменён", "Забрали"].includes(w.stage))
    : wipBuilds.filter(w => !["Архив", "Отменён"].includes(w.stage))
  const usedComps = WIP_COMPONENTS.filter(c => activeBuilds.some(w => !!(w as Record<string, string>)[c.key]))
  // ── Быстрые кнопки шапки: показ/скрытие + порядок (локально на устройстве) ──
  // Управляем только видимостью и порядком встроенных кнопок. Скрытые уходят
  // в «карман», который раскрывается кнопкой «^» справа.
  const QUICK_BTN_KEY = "wip_quick_buttons_v1"
  const QUICK_BTN_DEFAULT = ["archive", "basket", "editHw", "newBuild"]
  const [quickCfg, setQuickCfg] = useState<{ order: string[]; hidden: string[] }>(() => {
    try {
      const raw = localStorage.getItem(QUICK_BTN_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        const order: string[] = Array.isArray(p.order) ? p.order.filter((k: string) => QUICK_BTN_DEFAULT.includes(k)) : []
        const hidden: string[] = Array.isArray(p.hidden) ? p.hidden.filter((k: string) => QUICK_BTN_DEFAULT.includes(k)) : []
        // Досоздаём кнопки, которых нет в сохранёнке (после обновлений)
        for (const k of QUICK_BTN_DEFAULT) if (!order.includes(k) && !hidden.includes(k)) order.push(k)
        return { order, hidden }
      }
    } catch { /* noop */ }
    return { order: [...QUICK_BTN_DEFAULT], hidden: [] }
  })
  const [quickEdit, setQuickEdit] = useState(false)
  const [quickPocketOpen, setQuickPocketOpen] = useState(false)
  const [quickDrag, setQuickDrag] = useState<string | null>(null)
  const persistQuick = (next: { order: string[]; hidden: string[] }) => {
    setQuickCfg(next)
    try { localStorage.setItem(QUICK_BTN_KEY, JSON.stringify(next)) } catch { /* noop */ }
  }
  const quickHide = (key: string) => persistQuick({ order: quickCfg.order.filter(k => k !== key), hidden: [...quickCfg.hidden, key] })
  const quickShow = (key: string) => persistQuick({ order: [...quickCfg.order, key], hidden: quickCfg.hidden.filter(k => k !== key) })
  const quickReorder = (from: string, to: string) => {
    if (from === to) return
    const arr = [...quickCfg.order]
    const fi = arr.indexOf(from), ti = arr.indexOf(to)
    if (fi < 0 || ti < 0) return
    arr.splice(fi, 1)
    arr.splice(arr.indexOf(to), 0, from)
    persistQuick({ ...quickCfg, order: arr })
  }
  const quickReset = () => persistQuick({ order: [...QUICK_BTN_DEFAULT], hidden: [] })

  const rows: { key: string; label: string }[] = [
    { key: "_order", label: "Заказ" },
    { key: "_stage", label: "Этап" },
    { key: "_client", label: "Клиент" },
    { key: "_received_at", label: "Железо придёт" },
    { key: "_issued_at", label: "Дата выдачи" },
    { key: "_delivery", label: "Получение" },
    { key: "_assembler", label: "Сборщик" },
    ...usedComps.map(c => ({ key: c.key, label: c.label })),
    { key: "_actions", label: "" },
  ]

  return (
    <div>
      {/* Шапка */}
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-light text-foreground">
          {isArchive ? "Архив сборок" : "Сборки в процессе"} <span className="ml-1 text-sm text-foreground/40">({activeBuilds.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          {isArchive ? (
            <button onClick={() => setViewArchive(false)}
              className="flex items-center gap-1.5 rounded-lg bg-amber-400/15 text-amber-400 border border-amber-400/40 px-3 py-2 text-sm font-medium transition-colors"
              style={{ cursor: "pointer" }}>
              <Icon name="ArrowLeft" size={15} />
              К активным
            </button>
          ) : (() => {
            // Описание встроенных быстрых кнопок. Порядок и видимость — из quickCfg.
            const defs: Record<string, { label: string; render: () => JSX.Element }> = {
              archive: { label: "Архив", render: () => (
                <button onClick={() => setViewArchive(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                  style={{ cursor: "pointer" }}>
                  <Icon name="Archive" size={15} />
                  Архив
                </button>
              ) },
              basket: { label: "Корзина закупки", render: () => (
                <button onClick={() => { setBasketOpen(v => !v); if (!basketOpen) loadBasket() }}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    totalNewCount > 0
                      ? "border-orange-400/40 bg-orange-400/5 text-orange-400 hover:bg-orange-400/10"
                      : totalDebtCount > 0
                        ? "border-amber-400/40 bg-amber-400/5 text-amber-500 hover:bg-amber-400/10"
                        : basketOpen ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-orange-400 hover:text-orange-400"
                  }`}
                  style={{ cursor: "pointer" }}>
                  <Icon name="ShoppingCart" size={15} />
                  Корзина закупки
                  {totalNewCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-400 px-1 text-[10px] font-bold text-white">{totalNewCount}</span>
                  )}
                </button>
              ) },
              editHw: { label: "Ред. железо", render: () => (
                <button onClick={() => setWipEditMode(v => !v)}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${wipEditMode ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
                  style={{ cursor: "pointer" }}>
                  <Icon name={wipEditMode ? "Eye" : "Pencil"} size={15} />
                  {wipEditMode ? "Просмотр" : "Ред. железо"}
                </button>
              ) },
              newBuild: { label: "Новая сборка", render: () => (
                <button onClick={() => { setWipForm({ ...EMPTY_WIP }); setWipFormOpen(true) }}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  style={{ cursor: "pointer" }}>
                  <Icon name="Plus" size={15} />Новая сборка
                </button>
              ) },
            }
            return (
              <>
                {quickCfg.order.filter(k => defs[k]).map(key => (
                  <div key={key} className="relative"
                    draggable={quickEdit}
                    onDragStart={() => quickEdit && setQuickDrag(key)}
                    onDragOver={e => { if (quickEdit && quickDrag) e.preventDefault() }}
                    onDrop={() => { if (quickEdit && quickDrag) { quickReorder(quickDrag, key); setQuickDrag(null) } }}
                    onDragEnd={() => setQuickDrag(null)}
                    style={{ cursor: quickEdit ? "grab" : undefined }}>
                    <div className={quickEdit ? "pointer-events-none opacity-90" : ""}>
                      {defs[key].render()}
                    </div>
                    {quickEdit && (
                      <button onClick={() => quickHide(key)} title="Скрыть кнопку"
                        className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-foreground/50 hover:text-red-400 shadow"
                        style={{ cursor: "pointer" }}>
                        <Icon name="X" size={10} />
                      </button>
                    )}
                  </div>
                ))}

                {/* Кнопка «Настроить» */}
                <button onClick={() => { setQuickEdit(v => !v); setQuickPocketOpen(false) }} title="Настроить кнопки"
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${quickEdit ? "bg-primary text-primary-foreground" : "text-foreground/40 hover:bg-muted hover:text-foreground"}`}
                  style={{ cursor: "pointer" }}>
                  <Icon name={quickEdit ? "Check" : "Settings2"} size={15} />
                </button>

                {/* Карман скрытых кнопок: раскрывается «^» */}
                {quickCfg.hidden.length > 0 && (
                  <div className="relative">
                    <button onClick={() => setQuickPocketOpen(v => !v)} title="Скрытые кнопки"
                      className="flex items-center justify-center rounded-lg border border-border px-2 py-2 text-foreground/50 hover:border-primary hover:text-foreground transition-colors"
                      style={{ cursor: "pointer" }}>
                      <Icon name={quickPocketOpen ? "ChevronUp" : "ChevronDown"} size={15} />
                    </button>
                    {quickPocketOpen && (
                      <div className="absolute right-0 top-full z-30 mt-2 w-52 rounded-xl border border-border bg-card p-2 shadow-2xl">
                        <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wider text-foreground/40">Скрытые кнопки</p>
                        {quickCfg.hidden.filter(k => defs[k]).map(key => (
                          <button key={key} onClick={() => { quickShow(key); if (quickCfg.hidden.length <= 1) setQuickPocketOpen(false) }}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
                            style={{ cursor: "pointer" }}>
                            <Icon name="Plus" size={13} className="text-foreground/40" />
                            {defs[key].label}
                          </button>
                        ))}
                        <button onClick={() => { quickReset(); setQuickPocketOpen(false) }}
                          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/40 hover:bg-muted hover:text-foreground transition-colors"
                          style={{ cursor: "pointer" }}>
                          <Icon name="RotateCcw" size={12} />
                          Сбросить по умолчанию
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          })()}
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
                // Крайняя (самая поздняя) дата прихода среди позиций сборки
                const etaDates = build.items.map(i => i.eta_date).filter(Boolean) as string[]
                const latestEta = etaDates.length ? etaDates.reduce((a, b) => (a > b ? a : b)) : null
                const anyDelayed = build.items.some(i => i.is_delayed)
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
                        {newCnt > 0 && (
                          <span className="rounded-full bg-red-400/10 px-2.5 py-0.5 text-xs font-medium text-red-400">заказать {newCnt}</span>
                        )}
                        {newCnt === 0 && (
                          <span className="rounded-full bg-green-400/10 px-2.5 py-0.5 text-xs font-medium text-green-400">всё заказано</span>
                        )}
                      </div>
                      {latestEta && (
                        <span
                          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium ${
                            anyDelayed ? "border-orange-400/50 text-orange-400 bg-orange-400/5"
                                       : "border-yellow-400/40 text-yellow-400 bg-yellow-400/5"
                          }`}
                          title="Крайняя дата прихода железа по сборке">
                          <Icon name="CalendarClock" size={13} />
                          до {new Date(latestEta).toLocaleDateString("ru-RU")}
                        </span>
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
                                {item.required_qty > 0 && (
                                  <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-medium text-red-400">нужно {item.required_qty} шт.</span>
                                )}
                              </div>
                            </div>
                            {item.url_supplier && (
                              <a href={item.url_supplier} target="_blank" rel="noreferrer"
                                className="shrink-0 text-foreground/30 hover:text-primary transition-colors" title="Купить у поставщика">
                                <Icon name="ExternalLink" size={13} />
                              </a>
                            )}
                            {item.status === "RECEIVED" ? (
                              <span className="shrink-0 rounded-lg border border-green-400/40 bg-green-400/5 px-2 py-1 text-xs font-medium text-green-400">
                                Получено
                              </span>
                            ) : (
                              <>
                                {item.is_delayed && (
                                  <span className="shrink-0 rounded-lg border border-orange-400/50 bg-orange-400/10 px-2 py-1 text-xs font-medium text-orange-400" title="Срок прихода прошёл, товар не поступил">
                                    Задержка
                                  </span>
                                )}
                                {/* Магазин (откуда поедет железка) — для удобства */}
                                {stores.length > 0 && (() => {
                                  const skey = `${build.wip_id}:${item.slot}`
                                  const sstate = storeSaveState[skey]
                                  return (
                                    <div className="shrink-0 flex items-center gap-1">
                                      <select
                                        value={itemStore[skey] || ""}
                                        onChange={e => setComponentStore(build.wip_id, item.slot, e.target.value)}
                                        disabled={sstate === "saving"}
                                        className={`rounded-lg border bg-background px-2 py-1 text-xs font-medium text-foreground/70 focus:outline-none transition-colors max-w-[130px] ${
                                          sstate === "ok" ? "border-green-400/60" : sstate === "err" ? "border-red-400/60" : "border-border focus:border-primary"
                                        }`}
                                        style={{ cursor: "pointer" }}
                                        title="Магазин (откуда поедет)">
                                        <option value="">Магазин</option>
                                        {stores.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                                      </select>
                                      {sstate === "saving" && <Icon name="Loader" size={13} className="animate-spin text-foreground/40" />}
                                      {sstate === "ok" && <Icon name="Check" size={14} className="text-green-400" />}
                                      {sstate === "err" && <Icon name="TriangleAlert" size={14} className="text-red-400" />}
                                    </div>
                                  )
                                })()}
                                {/* Дата прихода железа = «Заказано» — кликабельный календарик */}
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                                        item.is_delayed ? "border-orange-400/50 text-orange-400 bg-orange-400/5" :
                                        item.eta_date ? "border-yellow-400/40 text-yellow-400 bg-yellow-400/5" :
                                        "border-red-400/40 text-red-400 bg-red-400/5"
                                      }`}
                                      style={{ cursor: "pointer" }}
                                      title="Дата прихода железа (= Заказано)">
                                      <Icon name="CalendarClock" size={13} />
                                      {item.eta_date ? new Date(item.eta_date).toLocaleDateString("ru-RU") : "Дата прихода"}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0" align="end">
                                    <Calendar
                                      mode="single"
                                      selected={item.eta_date ? new Date(item.eta_date) : undefined}
                                      onSelect={(d?: Date) => setComponentEta(
                                        item.slot, build.wip_id,
                                        d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : ""
                                      )}
                                    />
                                    {item.eta_date && (
                                      <button
                                        onClick={() => setComponentEta(item.slot, build.wip_id, "")}
                                        className="w-full border-t border-border px-3 py-2 text-xs text-foreground/50 hover:text-red-400 transition-colors"
                                        style={{ cursor: "pointer" }}>
                                        Сбросить дату
                                      </button>
                                    )}
                                  </PopoverContent>
                                </Popover>
                              </>
                            )}
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
                  <label className="mb-1 block text-xs text-foreground/50">Номер заказа</label>
                  <input value={wipForm.order_number} onChange={e => setWipForm(f => f && ({ ...f, order_number: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    placeholder={wipForm.id ? "" : "присвоится автоматически"} style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/50">Этап</label>
                  <select value={wipForm.stage} onChange={e => setWipForm(f => f && ({ ...f, stage: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    {(wipStages.length ? wipStages : WIP_STAGES).map(s => (
                      <option key={s} value={s}>{wipForm.for_sale && s === "Готов, можно забрать" ? "В продаже" : s}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground hover:border-primary/50 transition-colors" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={!!wipForm.for_sale}
                      onChange={e => setWipForm(f => f && ({ ...f, for_sale: e.target.checked }))}
                      className="h-4 w-4 accent-primary" style={{ cursor: "pointer" }} />
                    <Icon name="Tag" size={14} className="text-primary" />
                    В свободную продажу
                    <span className="ml-auto text-xs text-foreground/40">публикует в «Наши ПК» с тегом «в наличии»</span>
                  </label>
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
                    editBuild(buildId)
                  }}
                    className="flex items-center gap-2 rounded-lg border border-border px-5 py-2 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Wrench" size={14} />Редактировать сборку
                  </button>
                )}
                {wipForm.id && !wipForm.build_id && (
                  <button onClick={createCatalogBuild}
                    className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-5 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="PackagePlus" size={14} />Создать сборку в каталоге
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

      {/* Модалка отмены заказа */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-red-400/30 bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-400/10">
                <Icon name="XCircle" size={20} className="text-red-400" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Отмена заказа #{cancelModal.order_number}</p>
                <p className="text-xs text-foreground/40">{cancelModal.customer_name}</p>
              </div>
            </div>
            <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-xs text-red-400/80 space-y-1">
              <p>• Товары на складе вернутся в наличие</p>
              <p>• Незакупленное железо уберётся из отрицательного резерва</p>
              <p>• Заказ уйдёт в архив</p>
              <p>• Сборка будет удалена</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCancelModal(null)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:text-foreground transition-colors"
                style={{ cursor: "pointer" }}>
                Назад
              </button>
              <button
                onClick={confirmCancel}
                disabled={cancelLoading}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                style={{ cursor: "pointer" }}>
                {cancelLoading ? "Отменяю..." : "Подтвердить отмену"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Таблица */}
      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-card animate-pulse" />)}</div>
      ) : activeBuilds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <Icon name={isArchive ? "ArchiveRestore" : "Hammer"} size={36} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">{isArchive ? "Архив пуст" : "Сборок в процессе нет"}</p>
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
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${WIP_STAGE_COLORS[w.stage] || "bg-muted text-foreground/50"}`}>{stageLabel(w)}</span>
                        {w.for_sale && (
                          <span className="flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-400" title="Сборка в свободной продаже на сайте">
                            <Icon name="Tag" size={9} />В продаже
                          </span>
                        )}
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
                              title="Редактировать сборку"
                              className="flex items-center justify-center rounded-lg border border-border p-1.5 text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                              style={{ cursor: "pointer" }}>
                              <Icon name="Pencil" size={13} />
                            </button>
                            <button onClick={() => setWipPasteId(w.id!)}
                              title="Вставить состав"
                              className="flex items-center justify-center rounded-lg border border-border p-1.5 text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                              style={{ cursor: "pointer" }}>
                              <Icon name="Copy" size={13} />
                            </button>
                            <button onClick={() => copyWip(w)}
                              title="Скопировать сборку в новую"
                              className="flex items-center justify-center rounded-lg border border-primary/30 bg-primary/5 p-1.5 text-primary hover:bg-primary/10 transition-colors"
                              style={{ cursor: "pointer" }}>
                              <Icon name="CopyPlus" size={13} />
                            </button>
                            {w.id && (
                              <button onClick={() => setMarginWip(w)}
                                title="Маржа сборки"
                                className="flex items-center justify-center rounded-lg border border-green-400/30 bg-green-400/5 p-1.5 text-[13px] hover:bg-green-400/10 transition-colors"
                                style={{ cursor: "pointer" }}>
                                🤑
                              </button>
                            )}
                            {w.order_id && (
                              <button onClick={() => navigate(`/admin/order/${w.order_id}`)}
                                title="Обработать заказ"
                                className="flex items-center justify-center rounded-lg border border-blue-400/30 bg-blue-400/5 p-1.5 text-blue-400 hover:bg-blue-400/10 transition-colors"
                                style={{ cursor: "pointer" }}>
                                <Icon name="ClipboardList" size={13} />
                              </button>
                            )}
                            {(w.build_id || w.order_id) && w.id && (
                              <button onClick={() => openWipContract(w)}
                                disabled={contractWipId === w.id}
                                title="Договор поставки (можно на этапе согласования, без резервов)"
                                className="flex items-center justify-center rounded-lg border border-purple-400/30 bg-purple-400/5 p-1.5 text-purple-400 hover:bg-purple-400/10 transition-colors disabled:opacity-50"
                                style={{ cursor: "pointer" }}>
                                <Icon name={contractWipId === w.id ? "Loader" : "FileSignature"} size={13} className={contractWipId === w.id ? "animate-spin" : ""} />
                              </button>
                            )}
                            {w.build_id && (
                              <button onClick={() => navigate(`/order-sheet/${w.build_id}`)}
                                title="Лист сборки — забрать железо со склада"
                                className="flex items-center justify-center rounded-lg border border-border p-1.5 text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                                style={{ cursor: "pointer" }}>
                                <Icon name="Warehouse" size={13} />
                              </button>
                            )}
                            {w.stage === "Заказ" && w.order_id && w.id && (
                              <button onClick={() => syncWipOrder(w)}
                                disabled={syncingWipId === w.id}
                                title="Выбить компоненты со склада и создать резервы"
                                className={`flex items-center justify-center rounded-lg border p-1.5 font-medium transition-colors disabled:opacity-50 ${syncDoneWipId === w.id ? "border-green-400/30 bg-green-400/5 text-green-400" : "border-yellow-400/30 bg-yellow-400/5 text-yellow-400 hover:bg-yellow-400/10"}`}
                                style={{ cursor: "pointer" }}>
                                <Icon name={syncingWipId === w.id ? "Loader" : syncDoneWipId === w.id ? "Check" : "RefreshCw"} size={13} className={syncingWipId === w.id ? "animate-spin" : ""} />
                              </button>
                            )}
                            {w.id && (
                              <button onClick={() => openCancelModal(w)}
                                title="Отменить заказ"
                                className="flex items-center justify-center rounded-lg border border-red-400/20 p-1.5 text-red-400/50 hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-400 transition-colors"
                                style={{ cursor: "pointer" }}>
                                <Icon name="XCircle" size={13} />
                              </button>
                            )}
                          </div>
                        )}
                        {row.key === "_stage" && (
                          <div className="flex flex-col items-start gap-1">
                            <select value={w.stage}
                              onChange={e => changeStage(w, e.target.value)}
                              className={`rounded-full border-0 px-2 py-0.5 text-[10px] font-semibold focus:outline-none cursor-pointer ${WIP_STAGE_COLORS[w.stage] || "bg-muted text-foreground/50"}`}
                              style={{ cursor: "pointer" }}>
                              {(wipStages.length ? wipStages : WIP_STAGES).map(s => (
                                <option key={s} value={s}>{w.for_sale && s === "Готов, можно забрать" ? "В продаже" : s}</option>
                              ))}
                            </select>
                            {w.stage === "Забрали" && (
                              <button onClick={() => changeStage(w, "Архив")}
                                title="Переместить в архив"
                                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] text-foreground/60 hover:border-primary hover:bg-primary/5 hover:text-primary transition-colors"
                                style={{ cursor: "pointer" }}>
                                <Icon name="Archive" size={10} />В архив
                              </button>
                            )}
                          </div>
                        )}
                        {row.key === "_client" && (
                          <div className="space-y-0.5">
                            {w.customer_name && <p className="text-xs font-medium text-foreground">{w.customer_name}</p>}
                            {(w.customer_phone || w.contact) && <p className="text-[10px] text-primary/80 font-mono">{w.customer_phone || w.contact}</p>}
                            {!!w.total && (
                              <>
                                <p className="text-[10px] text-foreground/50 font-semibold">{w.total.toLocaleString("ru-RU")} ₽</p>
                                <PrepaymentEditor
                                  total={w.total}
                                  percent={w.prepayment_percent}
                                  amount={w.prepayment_amount}
                                  highlight={w.stage === "Забрали"}
                                  compact
                                  onSave={async (payload) => {
                                    const res = await api.wipBuilds.patch({ id: w.id, ...payload })
                                    setWipBuilds(bs => bs.map(b => b.id === w.id
                                      ? { ...b, prepayment_percent: res.prepayment_percent, prepayment_amount: res.prepayment_amount, remaining_amount: res.remaining_amount }
                                      : b))
                                    return res
                                  }}
                                />
                              </>
                            )}
                          </div>
                        )}
                        {row.key === "_received_at" && <span className="text-foreground/60">{w.received_at ? new Date(w.received_at).toLocaleDateString("ru-RU") : "—"}</span>}
                        {row.key === "_issued_at" && <span className="text-foreground/60">{w.issued_at ? new Date(w.issued_at).toLocaleDateString("ru-RU") : "—"}</span>}
                        {row.key === "_delivery" && <span className="text-foreground/60 text-[10px]">{w.delivery_type || "—"}</span>}
                        {row.key === "_assembler" && (
                          <select
                            value={w.assembled_by ?? ""}
                            onChange={e => setAssembler(w, e.target.value ? Number(e.target.value) : null)}
                            className={`rounded-lg border bg-background px-2 py-1 text-[10px] focus:outline-none focus:border-primary ${w.assembled_by ? "border-border text-foreground/80" : "border-yellow-400/40 text-yellow-400/80"}`}
                            style={{ cursor: "pointer" }}>
                            <option value="">не выбран</option>
                            {employees.filter(e => e.is_active || e.id === w.assembled_by).map(e => (
                              <option key={e.id} value={e.id}>{e.name}{e.assembler_percent ? ` (${e.assembler_percent}%)` : ""}</option>
                            ))}
                          </select>
                        )}
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
                          // Слот "Доп" (extra) может содержать НЕСКОЛЬКО позиций
                          // (например вентиляторы: fan + extra). Собираем все строки
                          // слота, а не только первую — иначе теряются кол-во и вторая
                          // позиция вентиляторов.
                          const slotKey = row.key === "case_name" ? "case" : row.key
                          const comps = (w.build_components || []).filter(
                            c => c.slot === slotKey || (slotKey === "extra" && c.slot === "fan")
                          )
                          const totalQty = comps.reduce((s, c) => s + (c.qty || 1), 0)
                          // Для "Доп" показываем каждую позицию отдельно (название+кол-во),
                          // т.к. это могут быть разные товары. Для остальных слотов —
                          // одно название с суммарным кол-вом.
                          const isMulti = comps.length > 1
                          return val ? (
                            <div className="space-y-1">
                              {isMulti ? (
                                <div className="space-y-0.5">
                                  {comps.map((c, i) => (
                                    <p key={i} className="text-xs text-foreground/80 leading-snug">
                                      {c.name || val}
                                      {(c.qty || 1) > 1 && <span className="ml-1 font-semibold text-primary">×{c.qty}</span>}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-foreground/80 leading-snug">
                                  {/* Актуальное название берём из состава сборки
                                      (синхронизируется со складом), val — фолбэк
                                      для старых заказов без build_components. */}
                                  {comps[0]?.name || val}
                                  {totalQty > 1 && <span className="ml-1 font-semibold text-primary">×{totalQty}</span>}
                                </p>
                              )}
                              <div>
                                {status !== "pending" && (
                                  <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-semibold w-fit ${sCls}`}>
                                    {sLabel}
                                    {status === "need_order" && (w.need_by_slot?.[slotKey] ?? 0) > 0 && (
                                      <span className="font-bold">{w.need_by_slot![slotKey]} шт</span>
                                    )}
                                  </span>
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

      {prepayModal && (
        <PrepaymentConfirmModal
          orderId={prepayModal.order_id as number}
          total={prepayModal.total || 0}
          defaultAmount={prepayModal.prepayment_amount}
          onClose={() => setPrepayModal(null)}
          onConfirmed={(amount, remaining) => onPrepayConfirmed(prepayModal, amount, remaining)}
        />
      )}

      {remainingModal && (
        <PrepaymentConfirmModal
          orderId={remainingModal.order_id as number}
          total={remainingModal.total || 0}
          mode="remaining"
          defaultAmount={remainingModal.for_sale
            ? (remainingModal.total || 0)
            : Math.max(0, (remainingModal.total || 0) - (remainingModal.prepayment_amount || 0))}
          onClose={() => setRemainingModal(null)}
          onConfirmed={() => onRemainingConfirmed(remainingModal)}
        />
      )}

      {marginWip && marginWip.id && (
        <WipMarginModal
          wipId={marginWip.id}
          orderNumber={marginWip.order_number}
          onClose={() => setMarginWip(null)}
        />
      )}

    </div>
  )
}