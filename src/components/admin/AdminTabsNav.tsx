import { useState, useEffect, useMemo, useCallback, memo } from "react"
import Icon from "@/components/ui/icon"
import { getAdminKey } from "@/pages/admin/types"

// ── Типы ────────────────────────────────────────────────────────────────────
export type TabMeta = { key: string; label: string; icon: string }
type Row = { id: string; label: string; icon: string; tabs: string[] }
type Layout = { rows: Row[]; archived: string[] }

// ~50 тематических иконок для подписи строк (имена lucide)
export const ROW_ICON_OPTIONS = [
  "LayoutGrid", "Monitor", "Cable", "Hammer", "Tag", "Inbox", "ClipboardList",
  "Warehouse", "ScanBarcode", "ShieldAlert", "CalendarDays", "CalendarCheck",
  "TrendingUp", "Activity", "Wallet", "ChartColumnBig", "MessagesSquare",
  "Building2", "Package", "Puzzle", "Users", "BookOpen", "Settings", "Cog",
  "Wrench", "Rocket", "Star", "Heart", "Flag", "Bookmark", "Folder", "Archive",
  "Box", "Boxes", "Truck", "ShoppingCart", "CreditCard", "DollarSign", "Coins",
  "PieChart", "BarChart3", "LineChart", "Bell", "Mail", "Phone", "MapPin",
  "Globe", "Zap", "Flame", "Cpu", "HardDrive", "Server", "Database", "Key",
  "Lock", "Shield", "Eye", "Search", "Filter", "Bolt", "Gem", "Crown",
]

const LAYOUT_VERSION = "v1"
const storageKey = () => `admin_tabs_layout_${LAYOUT_VERSION}__${getAdminKey() || "default"}`

// Дефолтная раскладка (совпадает с историческими группами админки)
function defaultLayout(allTabs: TabMeta[]): Layout {
  const groups: [string, string, string[]][] = [
    ["Сборки", "Monitor", ["builds", "cables", "wip_builds", "tags"]],
    ["Заявки и склад", "Warehouse", ["quiz_requests", "orders", "warehouse", "sn_archive", "rma"]],
    ["Операции", "CalendarDays", ["schedule", "calendar", "price_monitor", "stress"]],
    ["Финансы и настройки", "Wallet", ["finance", "analytics", "faq", "company_settings"]],
    ["Сайт", "Globe", ["products", "compatibility", "users", "articles"]],
  ]
  const known = new Set(allTabs.map(t => t.key))
  const rows: Row[] = groups.map((g, i) => ({
    id: `row-${i}`, label: g[0], icon: g[1], tabs: g[2].filter(k => known.has(k)),
  }))
  return { rows, archived: [] }
}

// Приводим сохранённую раскладку к актуальному набору табов:
// новые табы (появившиеся в коде) добавляем в первую строку, исчезнувшие убираем.
function reconcile(layout: Layout, allTabs: TabMeta[]): Layout {
  const known = new Set(allTabs.map(t => t.key))
  const placed = new Set<string>()
  const rows = layout.rows.map(r => {
    const tabs = r.tabs.filter(k => known.has(k) && !placed.has(k))
    tabs.forEach(k => placed.add(k))
    return { ...r, tabs }
  })
  const archived = layout.archived.filter(k => known.has(k) && !placed.has(k))
  archived.forEach(k => placed.add(k))
  const missing = allTabs.map(t => t.key).filter(k => !placed.has(k))
  if (missing.length) {
    if (!rows.length) rows.push({ id: "row-0", label: "Меню", icon: "LayoutGrid", tabs: [] })
    rows[0].tabs = [...rows[0].tabs, ...missing]
  }
  return { rows: rows.length ? rows : defaultLayout(allTabs).rows, archived }
}

function loadLayout(allTabs: TabMeta[]): Layout {
  try {
    const raw = localStorage.getItem(storageKey())
    if (raw) return reconcile(JSON.parse(raw), allTabs)
  } catch { /* noop */ }
  return defaultLayout(allTabs)
}

// ── Пикер иконок ────────────────────────────────────────────────────────────
const IconPicker = memo(function IconPicker({ value, onPick, onClose }: {
  value: string; onPick: (n: string) => void; onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-full z-50 mt-1 grid w-72 grid-cols-8 gap-1 rounded-xl border border-border bg-card p-2 shadow-2xl">
        {ROW_ICON_OPTIONS.map(n => (
          <button key={n} onClick={() => { onPick(n); onClose() }} title={n}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${value === n ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:bg-muted"}`}
            style={{ cursor: "pointer" }}>
            <Icon name={n} size={16} />
          </button>
        ))}
      </div>
    </>
  )
})

// ── Плитка-таб ──────────────────────────────────────────────────────────────
const TabTile = memo(function TabTile({
  meta, active, editing, badge, dragOver, onClick,
  onDragStart, onDragEnd, onDragOver, onDrop, onArchive,
}: {
  meta: TabMeta; active: boolean; editing: boolean; badge?: number; dragOver: boolean
  onClick: () => void
  onDragStart: () => void; onDragEnd: () => void; onDragOver: () => void; onDrop: () => void
  onArchive: () => void
}) {
  return (
    <div className="flex items-stretch">
      <div className={`w-1 shrink-0 self-stretch rounded-full transition-all ${dragOver ? "bg-primary" : "bg-transparent"}`} />
      <div
        draggable={editing}
        onDragStart={e => { if (editing) { onDragStart(); e.dataTransfer.effectAllowed = "move" } }}
        onDragEnd={onDragEnd}
        onDragOver={e => { if (editing) { e.preventDefault(); onDragOver() } }}
        onDrop={e => { if (editing) { e.preventDefault(); e.stopPropagation(); onDrop() } }}
        onClick={() => { if (!editing) onClick() }}
        className={`relative flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
          editing ? "cursor-grab rounded-lg border-2 border-dashed border-border/60 active:cursor-grabbing"
                  : active ? "border-primary text-primary" : "border-transparent text-foreground/60 hover:text-foreground"
        }`}
        style={{ cursor: editing ? "grab" : "pointer" }}>
        <Icon name={meta.icon || "Package"} size={15} />
        {meta.label}
        {!!badge && badge > 0 && (
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold leading-none text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        {editing && (
          <button onClick={e => { e.stopPropagation(); onArchive() }} title="В архив"
            className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-foreground/10 text-foreground/60 hover:bg-red-500 hover:text-white"
            style={{ cursor: "pointer" }}>
            <Icon name="Archive" size={11} />
          </button>
        )}
      </div>
    </div>
  )
})

// ── Основной компонент ──────────────────────────────────────────────────────
export default function AdminTabsNav({ allTabs, activeTab, onSelect, badges }: {
  allTabs: TabMeta[]
  activeTab: string
  onSelect: (key: string) => void
  badges?: Record<string, number>
}) {
  const [layout, setLayout] = useState<Layout>(() => loadLayout(allTabs))
  const [editing, setEditing] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [dragArchive, setDragArchive] = useState(false)
  const [iconPickerRow, setIconPickerRow] = useState<string | null>(null)

  // Реконсиляция при изменении набора табов (появился новый таб в коде)
  useEffect(() => { setLayout(l => reconcile(l, allTabs)) }, [allTabs])

  const metaMap = useMemo(() => {
    const m: Record<string, TabMeta> = {}
    allTabs.forEach(t => { m[t.key] = t })
    return m
  }, [allTabs])

  const persist = useCallback((next: Layout) => {
    setLayout(next)
    try { localStorage.setItem(storageKey(), JSON.stringify(next)) } catch { /* noop */ }
  }, [])

  // Переместить таб перед target (target === null → в конец строки)
  const moveTab = useCallback((key: string, rowId: string, target: string | null) => {
    setLayout(prev => {
      const rows = prev.rows.map(r => ({ ...r, tabs: r.tabs.filter(k => k !== key) }))
      const archived = prev.archived.filter(k => k !== key)
      const row = rows.find(r => r.id === rowId)
      if (row) {
        if (target && row.tabs.includes(target)) {
          const idx = row.tabs.indexOf(target)
          row.tabs.splice(idx, 0, key)
        } else {
          row.tabs.push(key)
        }
      }
      const next = { rows, archived }
      try { localStorage.setItem(storageKey(), JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }, [])

  const toArchive = useCallback((key: string) => {
    setLayout(prev => {
      const rows = prev.rows.map(r => ({ ...r, tabs: r.tabs.filter(k => k !== key) }))
      const archived = prev.archived.includes(key) ? prev.archived : [...prev.archived, key]
      const next = { rows, archived }
      try { localStorage.setItem(storageKey(), JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }, [])

  const fromArchive = useCallback((key: string, rowId?: string) => {
    setLayout(prev => {
      const archived = prev.archived.filter(k => k !== key)
      const rows = prev.rows.map(r => ({ ...r }))
      const target = rows.find(r => r.id === rowId) || rows[0]
      if (target) target.tabs = [...target.tabs, key]
      const next = { rows, archived }
      try { localStorage.setItem(storageKey(), JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }, [])

  const addRow = useCallback(() => {
    persist({ ...layout, rows: [...layout.rows, { id: `row-${Date.now()}`, label: "Новая строка", icon: "LayoutGrid", tabs: [] }] })
  }, [layout, persist])

  const deleteRow = useCallback((rowId: string) => {
    const row = layout.rows.find(r => r.id === rowId)
    if (!row) return
    persist({
      rows: layout.rows.filter(r => r.id !== rowId),
      archived: [...layout.archived, ...row.tabs],
    })
  }, [layout, persist])

  const renameRow = useCallback((rowId: string, label: string) => {
    persist({ ...layout, rows: layout.rows.map(r => r.id === rowId ? { ...r, label } : r) })
  }, [layout, persist])

  const setRowIcon = useCallback((rowId: string, icon: string) => {
    persist({ ...layout, rows: layout.rows.map(r => r.id === rowId ? { ...r, icon } : r) })
  }, [layout, persist])

  const resetLayout = useCallback(() => {
    if (!confirm("Сбросить раскладку к стандартной?")) return
    persist(defaultLayout(allTabs))
  }, [allTabs, persist])

  const endDrag = () => { setDragKey(null); setDragOverKey(null); setDragArchive(false) }

  const renderTile = (key: string, rowId: string) => {
    const meta = metaMap[key]
    if (!meta) return null
    return (
      <TabTile
        key={key}
        meta={meta}
        active={activeTab === key}
        editing={editing}
        badge={badges?.[key]}
        dragOver={dragOverKey === key && dragKey != null && dragKey !== key}
        onClick={() => onSelect(key)}
        onDragStart={() => setDragKey(key)}
        onDragEnd={endDrag}
        onDragOver={() => { if (dragKey && dragKey !== key) setDragOverKey(key) }}
        onDrop={() => { if (dragKey) moveTab(dragKey, rowId, key); endDrag() }}
        onArchive={() => toArchive(key)}
      />
    )
  }

  return (
    <div className="mb-6 hidden border-b border-border md:block">
      {layout.rows.map(row => (
        <div key={row.id}
          onDragOver={e => { if (editing && dragKey) { e.preventDefault() } }}
          onDrop={e => { if (editing && dragKey) { e.preventDefault(); moveTab(dragKey, row.id, null); endDrag() } }}
          className={`flex items-center gap-1 ${editing ? "min-h-[46px] rounded-lg py-1 hover:bg-muted/30" : ""}`}>
          {editing && (
            <div className="relative flex shrink-0 items-center gap-1 pr-2">
              <button onClick={() => setIconPickerRow(row.id)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/60 hover:bg-muted"
                style={{ cursor: "pointer" }}>
                <Icon name={row.icon || "LayoutGrid"} size={14} />
              </button>
              {iconPickerRow === row.id && (
                <IconPicker value={row.icon} onPick={n => setRowIcon(row.id, n)} onClose={() => setIconPickerRow(null)} />
              )}
              <input value={row.label} onChange={e => renameRow(row.id, e.target.value)}
                placeholder="Название строки"
                className="w-32 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none" />
              <button onClick={() => deleteRow(row.id)} title="Удалить строку"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/40 hover:bg-red-500/10 hover:text-red-500"
                style={{ cursor: "pointer" }}>
                <Icon name="Trash2" size={14} />
              </button>
            </div>
          )}
          {!editing && row.label?.trim() && row.tabs.length > 0 && (
            <div className="flex shrink-0 items-center gap-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-primary">
              <Icon name={row.icon || "LayoutGrid"} size={13} />
              <span className="hidden lg:inline">{row.label}</span>
            </div>
          )}
          <div className={`flex flex-1 items-center gap-0 overflow-x-auto ${editing ? "" : "justify-center"}`}>
            {row.tabs.map(k => renderTile(k, row.id))}
            {editing && !row.tabs.length && (
              <span className="px-3 py-2 text-xs text-foreground/30">Перетащите плитки сюда</span>
            )}
          </div>
        </div>
      ))}

      {/* Панель управления: карандаш + архив */}
      <div className="flex items-center justify-center gap-2 py-2">
        <button onClick={() => { setEditing(v => !v); setShowArchive(false) }}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${editing ? "bg-primary text-primary-foreground" : "text-foreground/50 hover:bg-muted hover:text-foreground"}`}
          style={{ cursor: "pointer" }}>
          <Icon name={editing ? "Check" : "Pencil"} size={13} />
          {editing ? "Готово" : "Настроить"}
        </button>
        <button onClick={() => setShowArchive(v => !v)}
          className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${showArchive ? "bg-muted text-foreground" : "text-foreground/50 hover:bg-muted hover:text-foreground"}`}
          style={{ cursor: "pointer" }}>
          <Icon name="Archive" size={13} />
          Архив
          {layout.archived.length > 0 && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-foreground/20 px-1 text-[10px] font-semibold leading-none">
              {layout.archived.length}
            </span>
          )}
        </button>
        {editing && (
          <>
            <button onClick={addRow}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-foreground/50 hover:bg-muted hover:text-foreground"
              style={{ cursor: "pointer" }}>
              <Icon name="Plus" size={13} />Строка
            </button>
            <button onClick={resetLayout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-foreground/50 hover:bg-muted hover:text-foreground"
              style={{ cursor: "pointer" }}>
              <Icon name="RotateCcw" size={13} />Сброс
            </button>
          </>
        )}
      </div>

      {/* Панель архива */}
      {showArchive && (
        <div
          onDragOver={e => { if (editing && dragKey) { e.preventDefault(); setDragArchive(true) } }}
          onDrop={e => { if (editing && dragKey) { e.preventDefault(); toArchive(dragKey); endDrag() } }}
          className={`mb-3 rounded-xl border border-dashed p-3 transition-colors ${dragArchive ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground/50">
            <Icon name="Archive" size={13} />
            Скрытые пункты {editing ? "— перетащите сюда/обратно или кликните" : "— нажмите, чтобы вернуть"}
          </p>
          {layout.archived.length === 0 ? (
            <p className="py-2 text-center text-xs text-foreground/30">Архив пуст</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {layout.archived.map(k => {
                const meta = metaMap[k]
                if (!meta) return null
                return (
                  <button key={k}
                    draggable={editing}
                    onDragStart={e => { if (editing) { setDragKey(k); e.dataTransfer.effectAllowed = "move" } }}
                    onDragEnd={endDrag}
                    onClick={() => fromArchive(k)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground/70 transition-colors hover:border-primary hover:text-foreground"
                    style={{ cursor: editing ? "grab" : "pointer" }}>
                    <Icon name={meta.icon || "Package"} size={15} />
                    {meta.label}
                    <Icon name="CornerUpLeft" size={12} className="text-foreground/30" />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}