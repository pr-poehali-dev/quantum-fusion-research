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
  Store, Group, ReserveFilter,
} from "./warehouse/types"
import { InventoryModal } from "./warehouse/InventoryModal"
import { QuickSupplyModal } from "./warehouse/QuickSupplyModal"
import { StoresModal } from "./warehouse/StoresModal"
import { DiscountModal, CategoriesModal } from "./warehouse/modals"
import { GroupRow } from "./warehouse/WarehouseTable"

// ─── PriceHistoryBadge и GroupRow вынесены в ./warehouse/WarehouseTable.tsx ──

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

// ─── DiscountModal, CategoriesModal, ReservesModal вынесены в ./warehouse/modals.tsx ─

// ─── Быстрая приёмка вынесена в ./warehouse/QuickSupplyModal.tsx ────────────
// ─── Инвентаризация вынесена в ./warehouse/InventoryModal.tsx ───────────────