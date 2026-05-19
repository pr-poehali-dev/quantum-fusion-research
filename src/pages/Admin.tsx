import React, { useState, useEffect, useRef } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { useNavigate, useParams } from "react-router-dom"
import { ImageUploader } from "@/components/image-uploader"
import RichTextEditor from "@/components/ui/rich-text-editor"
import { CableBody } from "@/components/cable-configurator"
import WarehouseTab from "@/components/admin/WarehouseTab"

const ADMIN_PASSWORD = "begraphics2024"

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Заказ новый", color: "text-primary bg-primary/10" },
  processing: { label: "Заказ в работе", color: "text-accent bg-accent/10" },
  done: { label: "Заказ выполнен", color: "text-green-400 bg-green-400/10" },
  cancelled: { label: "Отменён", color: "text-foreground/50 bg-muted" },
}

const ACTIVE_STATUSES = ["new", "processing"]
const ARCHIVE_STATUSES = ["done", "cancelled"]

const BUILD_STATUS: Record<string, string> = {
  catalog: "На сайте",
  client: "Для клиента",
  archive: "Архив",
  draft: "Черновик",
}

const SLOT_LABELS: Record<string, string> = {
  cpu: "Процессор", gpu: "Видеокарта", ram: "ОЗУ",
  storage: "Накопитель", psu: "БП", case: "Корпус", motherboard: "Материнская плата",
}

interface Order {
  id: number
  customer_name: string
  customer_phone: string
  customer_email: string
  order_type: string
  items: Array<{ name: string; price: number; quantity: number }>
  total: number
  comment: string
  status: string
  created_at: string
}

interface Product {
  id: number
  name: string
  price: number
  old_price: number | null
  in_stock: boolean
  category: { name: string } | null
  description: string
  specs: Record<string, string>
  sort_order: number
  is_featured: boolean
  image_url: string | null
  image_urls: string[]
}

interface Category {
  id: number
  name: string
  slug: string
}

interface ConfigComponent {
  id: number
  slot: string
  name: string
  brand?: string
  price: number
}

interface Tag {
  id: number
  name: string
  color: string
  sort_order: number
}

interface PCBuild {
  id: number
  name: string
  description: string
  image_urls: string[]
  components: Array<{ slot: string; name: string; price: number; source: string; source_id?: number; current_price?: number; qty?: number }>
  parts_total: number
  assembly_type: string
  assembly_fee: number
  total_price: number
  status: string
  is_featured: boolean
  in_stock: boolean
  client_token: string | null
  client_user_id: number | null
  parent_id: number | null
  tags?: Tag[]
}

interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  category: string
  is_published: boolean
  views: number
  created_at: string
}

interface WipBuild {
  id: number | null
  order_number: string
  stage: string
  contact: string
  delivery_type: string
  delivery_address: string
  received_at: string
  issued_at: string
  comment: string
  cpu: string; motherboard: string; ram: string; gpu: string
  storage: string; psu: string; case_name: string; cooling: string; extra: string
  cpu_status: string; motherboard_status: string; ram_status: string; gpu_status: string
  storage_status: string; psu_status: string; case_status: string; cooling_status: string; extra_status: string
  order_id: number | null
  build_id?: number | null
  client_token?: string | null
  build_components?: Array<{ slot: string; name: string; qty?: number }>
  customer_name?: string
  customer_phone?: string
  total?: number
  order_status?: string
  created_at?: string
  updated_at?: string
}

const EMPTY_WIP: WipBuild = {
  id: null, order_number: "", stage: "Согласование", contact: "",
  delivery_type: "", delivery_address: "", received_at: "", issued_at: "", comment: "",
  cpu: "", motherboard: "", ram: "", gpu: "", storage: "", psu: "", case_name: "", cooling: "", extra: "",
  cpu_status: "pending", motherboard_status: "pending", ram_status: "pending", gpu_status: "pending",
  storage_status: "pending", psu_status: "pending", case_status: "pending", cooling_status: "pending", extra_status: "pending",
  order_id: null,
}

const WIP_STAGES = [
  "Согласование", "Заказ", "Ожидание железа", "Ожидание сборки",
  "Сборка", "Настройка", "Тесты", "Досборать",
  "Проверка перед выдачей", "Ожидание упаковки",
  "Готов, можно забрать", "Отнести в сдэк", "Забрали", "Отменён", "Архив",
]

const WIP_STAGE_COLORS: Record<string, string> = {
  "Согласование": "bg-muted text-foreground/60",
  "Заказ": "bg-blue-500/15 text-blue-400",
  "Ожидание железа": "bg-yellow-500/15 text-yellow-400",
  "Ожидание сборки": "bg-orange-500/20 text-orange-400",
  "Сборка": "bg-blue-600/20 text-blue-300",
  "Настройка": "bg-blue-700/20 text-blue-300",
  "Тесты": "bg-purple-500/15 text-purple-400",
  "Досборать": "bg-red-500/15 text-red-400",
  "Проверка перед выдачей": "bg-teal-500/15 text-teal-400",
  "Ожидание упаковки": "bg-cyan-500/15 text-cyan-400",
  "Готов, можно забрать": "bg-green-600/20 text-green-400",
  "Отнести в сдэк": "bg-green-700/20 text-green-300",
  "Забрали": "bg-muted/50 text-foreground/30",
  "Отменён": "bg-red-900/30 text-red-400/70",
  "Архив": "bg-muted/30 text-foreground/20",
}

// Цвет фона ячейки для каждого статуса железа
const COMP_STATUS_BG: Record<string, string> = {
  pending:          "",
  need_order:       "bg-red-500/8",
  ordered_delay:    "bg-orange-500/8",
  ordered_transit:  "bg-yellow-500/8",
  ready:            "bg-green-500/8",
}

const COMP_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:          { label: "—",          cls: "bg-muted/50 text-foreground/30" },
  need_order:       { label: "Заказать",   cls: "bg-red-500/15 text-red-400" },
  ordered_delay:    { label: "Задержка",   cls: "bg-orange-500/15 text-orange-400" },
  ordered_transit:  { label: "Едет",       cls: "bg-yellow-500/15 text-yellow-400" },
  ready:            { label: "Есть",       cls: "bg-green-500/20 text-green-400" },
}

const WIP_COMPONENTS: { key: string; label: string }[] = [
  { key: "cpu", label: "Процессор" },
  { key: "motherboard", label: "Плата" },
  { key: "ram", label: "Память" },
  { key: "gpu", label: "Видеокарта" },
  { key: "storage", label: "Накопитель" },
  { key: "psu", label: "БП" },
  { key: "case_name", label: "Корпус" },
  { key: "cooling", label: "Охлаждение" },
  { key: "extra", label: "Доп." },
]

const DELIVERY_OPTIONS = [
  "Самовывоз Беляево",
  "Самовывоз Новокосино",
  "СДЭК (за счёт клиента)",
  "Курьер Яндекс по МСК (за счёт клиента)",
]

const TAG_COLOR_CLASSES: Record<string, string> = {
  primary: "bg-primary/15 text-primary border-primary/30",
  green: "bg-green-400/15 text-green-400 border-green-400/30",
  blue: "bg-blue-400/15 text-blue-400 border-blue-400/30",
  orange: "bg-orange-400/15 text-orange-400 border-orange-400/30",
  purple: "bg-purple-400/15 text-purple-400 border-purple-400/30",
  red: "bg-red-400/15 text-red-400 border-red-400/30",
}

function TagBadge({ tag }: { tag: Tag }) {
  const cls = TAG_COLOR_CLASSES[tag.color] || TAG_COLOR_CLASSES.primary
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {tag.name}
    </span>
  )
}

// ── Вкладка Кабели ──
function CablesTab() {
  const navigate = useNavigate()
  const [cables, setCables] = useState<{id: number; name: string; cpu_type: string; gpu_type: string; pin_colors: Record<string,string>; client_token: string | null; created_at: string}[]>([])
  const [loading, setLoading] = useState(true)
  const [generatingId, setGeneratingId] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)

  useEffect(() => {
    api.cables.getAll().then(raw => {
      const d = typeof raw === "string" ? JSON.parse(raw) : raw
      setCables(d.cables || [])
      setLoading(false)
    })
  }, [])

  const generateLink = async (id: number) => {
    setGeneratingId(id)
    try {
      await api.cables.generateClientLink(id)
      // Перезагружаем список чтобы гарантированно получить свежий токен
      const raw = await api.cables.getAll()
      const d = typeof raw === "string" ? JSON.parse(raw) : raw
      setCables(d.cables || [])
    } catch (e) {
      console.error("generateLink error", e)
    }
    setGeneratingId(null)
  }

  const copyLink = (token: string, id: number) => {
    const url = `${window.location.origin}/cables?token=${token}`
    try {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
      }).catch(() => fallbackCopy(url, id))
    } catch {
      fallbackCopy(url, id)
    }
  }

  const fallbackCopy = (text: string, id: number) => {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try { document.execCommand("copy") } catch (e) { console.warn("copy failed", e) }
    document.body.removeChild(ta)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const deleteCable = async (id: number) => {
    if (!confirm("Удалить конфигурацию?")) return
    await api.cables.delete(id)
    setCables(prev => prev.filter(c => c.id !== id))
  }

  const saveName = async (c: typeof cables[0]) => {
    if (!editName.trim()) return
    await api.cables.update({ id: c.id, name: editName.trim(), cpu_type: c.cpu_type, gpu_type: c.gpu_type, pin_colors: {} })
    setCables(prev => prev.map(x => x.id === c.id ? { ...x, name: editName.trim() } : x))
    setEditingId(null)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-light text-foreground">Кастомные кабели</h2>
        <button onClick={() => navigate("/cables")}
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20 transition-colors"
          style={{ cursor: "pointer" }}>
          <Icon name="Cable" size={15} />
          Открыть конфигуратор
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-card animate-pulse" />)}
        </div>
      ) : cables.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <Icon name="Cable" size={32} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-foreground/50 text-sm">Нет сохранённых конфигураций</p>
          <p className="text-foreground/30 text-xs mt-1">Конфигурации создаются клиентами в конфигураторе кабелей</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cables.map(c => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  {editingId === c.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveName(c); if (e.key === "Escape") setEditingId(null) }}
                        className="flex-1 rounded-lg border border-primary bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none"
                        style={{ cursor: "text" }}
                      />
                      <button onClick={() => saveName(c)}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                        style={{ cursor: "pointer" }}>Сохранить</button>
                      <button onClick={() => setEditingId(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60"
                        style={{ cursor: "pointer" }}>Отмена</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <p className="text-sm font-medium text-foreground">{c.name}</p>
                      <button onClick={() => { setEditingId(c.id); setEditName(c.name) }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground/30 hover:text-foreground"
                        style={{ cursor: "pointer" }}>
                        <Icon name="Pencil" size={12} />
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-foreground/40 mt-0.5">
                    CPU: {c.cpu_type} · GPU: {c.gpu_type} · {new Date(c.created_at).toLocaleDateString("ru-RU")}
                  </p>
                  {c.client_token && (
                    <div className="flex items-center gap-1 mt-1">
                      <input
                        readOnly
                        value={`${window.location.origin}/cables?token=${c.client_token}`}
                        onClick={e => (e.target as HTMLInputElement).select()}
                        className="flex-1 rounded border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-mono text-foreground/50 focus:outline-none focus:border-primary"
                        style={{ cursor: "text" }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${expandedId === c.id ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary hover:text-primary"}`}
                    style={{ cursor: "pointer" }}>
                    <Icon name={expandedId === c.id ? "ChevronUp" : "Settings2"} size={13} />
                    {expandedId === c.id ? "Свернуть" : "Редактировать"}
                  </button>
                  {c.client_token ? (
                    <button onClick={() => copyLink(c.client_token!, c.id)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${copiedId === c.id ? "border-green-500/50 bg-green-500/10 text-green-400" : "border-border text-foreground/60 hover:border-primary hover:text-primary"}`}
                      style={{ cursor: "pointer" }}>
                      <Icon name={copiedId === c.id ? "Check" : "Copy"} size={13} />
                      {copiedId === c.id ? "Скопировано!" : "Ссылка"}
                    </button>
                  ) : (
                    <button onClick={() => generateLink(c.id)} disabled={generatingId === c.id}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                      style={{ cursor: "pointer" }}>
                      <Icon name="Link" size={13} />
                      {generatingId === c.id ? "Создаю..." : "Создать ссылку"}
                    </button>
                  )}
                  <button onClick={() => deleteCable(c.id)}
                    className="rounded-lg border border-border p-1.5 text-foreground/40 hover:border-red-500/50 hover:text-red-400 transition-colors"
                    style={{ cursor: "pointer" }}>
                    <Icon name="Trash2" size={14} />
                  </button>
                </div>
              </div>

              {/* Редактор конфигурации */}
              {expandedId === c.id && (
                <div className="mt-4 pt-4 border-t border-border">
                  <CableBody
                    addToCart={() => {}}
                    added={false}
                    initialCpuType={c.cpu_type as "8-pin" | "8+4-pin" | "8+8-pin"}
                    initialGpuType={c.gpu_type as "8-pin" | "8+8-pin" | "8+8+8-pin" | "12V-2x6"}
                    initialPinColors={c.pin_colors}
                    saveLabel={savedId === c.id ? "Сохранено!" : "Сохранить изменения"}
                    onSave={async (pinColors, cpuType, gpuType) => {
                      await api.cables.update({ id: c.id, name: c.name, cpu_type: cpuType, gpu_type: gpuType, pin_colors: pinColors })
                      setCables(prev => prev.map(x => x.id === c.id ? { ...x, cpu_type: cpuType, gpu_type: gpuType, pin_colors: pinColors } : x))
                      setSavedId(c.id)
                      setTimeout(() => setSavedId(null), 2000)
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Строка одной сборки ──
function BuildRow({ b, isVariant, isMain, hasVariants, isArchive, dupeLoading, copiedBuildId, fmt, onEdit, onDupe, onLink, onStatus, onDelete }: {
  b: PCBuild
  isVariant: boolean   // это вариант (показан под главной)
  isMain: boolean      // это главная сборка группы
  hasVariants: boolean // у главной есть варианты
  isArchive: boolean
  dupeLoading: number | null
  copiedBuildId: number | null
  fmt: (n: number) => string
  onEdit: (b: PCBuild) => void
  onDupe: (b: PCBuild) => void
  onLink: (b: PCBuild) => void
  onStatus: (b: PCBuild, status: string) => void
  onDelete: (id: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <p className="font-medium text-foreground text-sm truncate">{b.name}</p>
          {/* Рекомендуемый бейдж — только если у группы есть варианты */}
          {isMain && hasVariants && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0">
              Рекомендуемый
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-xs shrink-0 ${
            b.status === "catalog" ? "bg-green-400/10 text-green-400"
            : b.status === "archive" ? "bg-muted text-foreground/30"
            : "bg-muted text-foreground/50"
          }`}>{BUILD_STATUS[b.status] || b.status}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-foreground/50">
          <span>{b.components?.length || 0} комп.</span>
          <span className="font-semibold text-foreground/70">{fmt(b.total_price)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 shrink-0">
        <button onClick={() => onEdit(b)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="Pencil" size={12} />Ред.
        </button>
        {/* Кнопка «+ Вариант» — только у главной, не у вариантов */}
        {isMain && !isArchive && (
          <button onClick={() => onDupe(b)} disabled={dupeLoading === b.id}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors disabled:opacity-50"
            style={{ cursor: "pointer" }}>
            <Icon name={dupeLoading === b.id ? "Loader2" : "Plus"} size={12} />
            {dupeLoading === b.id ? "..." : "Вариант"}
          </button>
        )}
        {/* Ссылка клиенту — только у главной */}
        {isMain && !isArchive && (
          <button onClick={() => onLink(b)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${b.client_token ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
            style={{ cursor: "pointer" }}>
            <Icon name={copiedBuildId === b.id ? "Check" : "Link"} size={12} />
            {copiedBuildId === b.id ? "Скопировано!" : b.client_token ? "Ссылка" : "Ссылка клиенту"}
          </button>
        )}
        {/* Статус — только у главной сборки; варианты наследуют */}
        {isMain ? (
          <select value={b.status} onChange={e => onStatus(b, e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
            {Object.entries(BUILD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        ) : (
          <span className="rounded-lg border border-border/50 px-2 py-1.5 text-xs text-foreground/30 select-none" title="Статус берётся с основной сборки">
            {BUILD_STATUS[b.status] || b.status}
          </span>
        )}
        <button onClick={() => onDelete(b.id)}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/30 hover:border-red-400 hover:text-red-400 transition-colors"
          style={{ cursor: "pointer" }}>
          <Icon name="Trash2" size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Список сборок с группировкой по вариантам ──
function BuildsList({ builds, loading, expandedVariants, setExpandedVariants, dupeLoading, copiedBuildId, fmt, onNew, onEdit, onDupe, onLink, onStatus, onDelete, isArchive }: {
  builds: PCBuild[]; loading: boolean; expandedVariants: number | null
  setExpandedVariants: (id: number | null) => void
  dupeLoading: number | null; copiedBuildId: number | null
  fmt: (n: number) => string
  onNew: () => void
  onEdit: (b: PCBuild) => void
  onDupe: (b: PCBuild) => void
  onLink: (b: PCBuild) => void
  onStatus: (b: PCBuild, status: string) => void
  onDelete: (id: number) => void
  isArchive: boolean
}) {
  // Группировка по parent_id: корневые = parent_id null, варианты = parent_id = id родителя
  const variantMap = new Map<number, PCBuild[]>()
  const roots: PCBuild[] = []
  for (const b of builds) {
    if (b.parent_id) {
      if (!variantMap.has(b.parent_id)) variantMap.set(b.parent_id, [])
      variantMap.get(b.parent_id)!.push(b)
    } else {
      roots.push(b)
    }
  }
  const groups: { main: PCBuild; variants: PCBuild[] }[] = roots.map(b => ({
    main: b,
    variants: (variantMap.get(b.id) || []).sort((a, b) => a.id - b.id),
  }))
  groups.sort((a, b) => b.main.id - a.main.id)

  const rowProps = { isArchive, dupeLoading, copiedBuildId, fmt, onEdit, onDupe, onLink, onStatus, onDelete }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-light text-foreground">
          {isArchive ? "Архив ПК" : "Наши ПК"} <span className="text-sm text-foreground/40 ml-1">({builds.length})</span>
        </h2>
        {!isArchive && (
          <button onClick={onNew} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={16} />Новая сборка
          </button>
        )}
      </div>
      {loading
        ? <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)}</div>
        : groups.length === 0
          ? <div className="py-16 text-center text-foreground/40"><Icon name="Monitor" size={40} className="mx-auto mb-3 opacity-30" /><p>{isArchive ? "Архив пуст" : "Сборок нет."}</p></div>
          : <div className="space-y-2">
            {groups.map(({ main, variants }) => {
              const isOpen = expandedVariants === main.id
              return (
                <div key={main.id} className="rounded-xl border border-border bg-card overflow-hidden">
                  {/* Главная строка */}
                  <div className="flex items-stretch">
                    {/* Стрелка — всегда видна, неактивна если вариантов нет */}
                    <button
                      onClick={() => variants.length > 0 && setExpandedVariants(isOpen ? null : main.id)}
                      className={`flex flex-col items-center justify-center gap-0.5 border-r border-border transition-colors ${variants.length > 0 ? "hover:bg-muted/60 cursor-pointer" : "cursor-default opacity-30"}`}
                      style={{ width: 44, minWidth: 44 }}
                      title={variants.length > 0 ? `${variants.length} вар. — нажмите` : "Вариантов нет"}
                    >
                      <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={15} className="text-foreground/50" />
                      {variants.length > 0 && (
                        <span className="text-[10px] font-bold text-primary leading-none">{variants.length}</span>
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <BuildRow b={main} isMain={true} isVariant={false} hasVariants={variants.length > 0} {...rowProps} />
                    </div>
                  </div>

                  {/* Варианты — раскрываются по клику на стрелку */}
                  {isOpen && variants.length > 0 && (
                    <div className="border-t border-border/60">
                      <div className="px-4 py-2 flex items-center gap-2 bg-muted/30 border-b border-border/40">
                        <Icon name="GitBranch" size={11} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Варианты сборки — каждый редактируется отдельно</span>
                      </div>
                      {variants.map((v, i) => (
                        <div key={v.id} className={`${i < variants.length - 1 ? "border-b border-border/30" : ""} bg-muted/10`}>
                          <BuildRow b={v} isMain={false} isVariant={true} hasVariants={false} {...rowProps} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
      }
    </div>
  )
}

type AdminTab = "orders" | "orders_archive" | "wip_builds" | "wip_archive" | "products" | "add_product" | "builds" | "archive" | "add_build" | "tags" | "articles" | "add_article" | "warehouse"

const VALID_TABS: AdminTab[] = ["orders", "orders_archive", "wip_builds", "wip_archive", "products", "add_product", "builds", "archive", "add_build", "tags", "articles", "add_article", "warehouse"]

export default function Admin() {
  const navigate = useNavigate()
  const { tab: tabParam } = useParams<{ tab: string }>()
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("begraphics_admin") === "1")
  const [password, setPassword] = useState("")

  const currentTab = (VALID_TABS.includes(tabParam as AdminTab) ? tabParam : "orders") as AdminTab
  const [tab, setTabState] = useState<AdminTab>(currentTab)

  // Синхронизируем tab с URL при навигации браузера
  useEffect(() => {
    const t = (VALID_TABS.includes(tabParam as AdminTab) ? tabParam : "orders") as AdminTab
    setTabState(t)
  }, [tabParam])

  const setTab = (t: AdminTab) => {
    setTabState(t)
    navigate(`/admin/${t}`, { replace: true })
  }

  const [orders, setOrders] = useState<Order[]>([])
  const [orderTypeFilter, setOrderTypeFilter] = useState<"all" | "pc_build" | "parts">("all")
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [productCatFilter, setProductCatFilter] = useState("all")
  const [productFillFilter, setProductFillFilter] = useState<"all" | "new" | "filled">("all")
  const [productSearch, setProductSearch] = useState("")
  const [configSlots, setConfigSlots] = useState<Record<string, ConfigComponent[]>>({})
  const [builds, setBuilds] = useState<PCBuild[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(false)
  const [articleForm, setArticleForm] = useState({
    id: null as number | null,
    title: "", slug: "", excerpt: "", content: "",
    image_url: "", category: "article", is_published: false,
    html_attachment: "",
  })

  const [productForm, setProductForm] = useState({
    id: null as number | null,
    category_id: "", name: "", description: "", price: "", old_price: "",
    image_urls: [] as string[], specs: "", in_stock: true, is_featured: false, sort_order: "0",
  })

  // Теги
  const [tags, setTags] = useState<Tag[]>([])
  const [buildTagIds, setBuildTagIds] = useState<number[]>([])
  const [tagForm, setTagForm] = useState<{ id: number | null; name: string; color: string; sort_order: string }>({ id: null, name: "", color: "primary", sort_order: "0" })
  const [tagFormOpen, setTagFormOpen] = useState(false)

  // WIP builds
  const [wipBuilds, setWipBuilds] = useState<WipBuild[]>([])
  const [wipStages, setWipStages] = useState<string[]>([])
  const [wipForm, setWipForm] = useState<WipBuild | null>(null)
  const [wipFormOpen, setWipFormOpen] = useState(false)
  const [wipPasteId, setWipPasteId] = useState<number | null>(null)
  const [wipColWidths, setWipColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("wip_col_widths") || "{}") } catch { return {} }
  })
  const [wipEditMode, setWipEditMode] = useState(false)

  // Build constructor state
  const [buildForm, setBuildForm] = useState({
    id: null as number | null,
    name: "", description: "", status: "catalog", is_featured: false, in_stock: false,
    assembly_type: "percent" as "percent" | "manual",
    assembly_fee_manual: "",
    image_urls: [] as string[],
  })
  const [buildComponents, setBuildComponents] = useState<Array<{
    slot: string; source: "catalog" | "custom"; source_id?: number; name: string; price: number; qty: number; image_urls?: string[]
  }>>([])
  const [expandedComponent, setExpandedComponent] = useState<number | null>(null)
  const [addingSlot, setAddingSlot] = useState<string | null>(null)
  const [componentSearch, setComponentSearch] = useState("")
  const [componentSearchIdx, setComponentSearchIdx] = useState(0)
  const componentSearchRef = useRef<HTMLInputElement>(null)
  const [copiedBuildId, setCopiedBuildId] = useState<number | null>(null)
  const [dupeLoading, setDupeLoading] = useState<number | null>(null)
  const [expandedVariants, setExpandedVariants] = useState<number | null>(null)

  // Импорт/экспорт/синхронизация товаров
  const [showSyncPanel, setShowSyncPanel] = useState(false)
  const [syncApiUrl, setSyncApiUrl] = useState("http://80.78.243.138/api/webhook/storage")
  const [syncApiKey, setSyncApiKey] = useState("Deboshir123321")
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; skipped: number; total: number; details?: { id: number; name: string; action: string }[] } | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData] = useState<{ raw_sample: unknown[]; parsed_sample: { name: string; price: number; _cat_raw?: string; in_stock?: boolean }[]; total_items: number } | null>(null)


  const handleExportExcel = async () => {
    setExportLoading(true)
    const res = await api.syncProducts.exportExcel()
    setExportLoading(false)
    if (res.file_b64) {
      const bin = atob(res.file_b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a"); a.href = url; a.download = "products.xlsx"; a.click()
      URL.revokeObjectURL(url)
    }
  }

  const handleImportExcel = async (file: File) => {
    setImportLoading(true)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const b64 = btoa(String.fromCharCode(...new Uint8Array(e.target!.result as ArrayBuffer)))
      const res = await api.syncProducts.importExcel(b64)
      setImportLoading(false)
      if (res.error) { alert("Ошибка: " + res.error); return }
      alert(`Импорт завершён: добавлено ${res.created}, обновлено ${res.updated}, пропущено ${res.skipped}`)
      api.products.getAll().then(d => { setProducts(d.products || []); setCategories(d.categories || []) })
    }
    reader.readAsArrayBuffer(file)
  }

  const handleSyncApi = async () => {
    setSyncLoading(true); setSyncResult(null); setPreviewData(null)
    const res = await api.syncProducts.syncFromApi(syncApiUrl, syncApiKey)
    setSyncLoading(false)
    if (res.error) { alert("Ошибка: " + res.error); return }
    setSyncResult(res)
    api.products.getAll().then(d => { setProducts(d.products || []); setCategories(d.categories || []) })
  }

  const handlePreviewApi = async () => {
    setPreviewLoading(true); setPreviewData(null); setSyncResult(null)
    const res = await api.syncProducts.previewApi(syncApiUrl, syncApiKey)
    setPreviewLoading(false)
    if (res.error) { alert("Ошибка: " + res.error); return }
    setPreviewData(res)
  }

  const generateClientLink = async (b: PCBuild) => {
    const token = b.client_token || (await api.builds.generateClientLink(b.id)).client_token
    if (!token) return
    setBuilds(bs => bs.map(bb => bb.id === b.id ? { ...bb, client_token: token } : bb))
    const url = `${window.location.origin}/build?token=${token}`
    navigator.clipboard.writeText(url)
    setCopiedBuildId(b.id)
    setTimeout(() => setCopiedBuildId(null), 2500)
  }

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"
  const partsTotal = buildComponents.reduce((s, c) => s + c.price * (c.qty || 1), 0)
  const assemblyFee = buildForm.assembly_type === "percent"
    ? Math.round(partsTotal * 0.07)
    : (parseFloat(buildForm.assembly_fee_manual) || 0)
  const buildTotal = partsTotal + assemblyFee

  useEffect(() => {
    if (!authed) return
    setLoading(true)
    if (tab === "orders" || tab === "orders_archive") {
      api.orders.getAll().then(d => { setOrders(d.orders || []); setLoading(false) })
    } else if (tab === "products" || tab === "add_product") {
      api.products.getAll().then(d => {
        setProducts(d.products || [])
        setCategories(d.categories || [])
        setLoading(false)
      })
    } else if (tab === "builds" || tab === "archive" || tab === "add_build") {
      api.tags.getAll().then(d => setTags(d.tags || []))
      Promise.all([
        api.builds.getAll().then(d => Array.isArray(d) ? d : (d.builds || [])),
        // Берём ВСЕ товары из каталога и группируем по slug категории как слот
        api.products.getAll().then(d => {
          const prods = d.products || []
          setProducts(prods)
          setCategories(d.categories || [])
          // Формируем configSlots из products — slug категории = slot
          const slots: Record<string, ConfigComponent[]> = {}
          for (const p of prods) {
            const slot = p.category?.slug || "other"
            if (!slots[slot]) slots[slot] = []
            slots[slot].push({ id: p.id, slot, name: p.name, brand: p.category?.name, price: p.price })
          }
          setConfigSlots(slots)
          return d
        }),
      ]).then(([b]) => {
        setBuilds(b)
        setLoading(false)
      }).catch(() => setLoading(false))
    } else if (tab === "wip_builds" || tab === "wip_archive") {
      api.wipBuilds.getAll().then(d => {
        setWipBuilds(d.wip_builds || [])
        setWipStages(d.stages || WIP_STAGES)
        setLoading(false)
      })
    } else if (tab === "tags") {
      api.tags.getAll().then(d => { setTags(d.tags || []); setLoading(false) })
    } else if (tab === "articles" || tab === "add_article") {
      api.articles.getAll().then(d => { setArticles(d.articles || []); setLoading(false) })
    }
  }, [authed, tab])

  const login = () => {
    if (password === ADMIN_PASSWORD) { sessionStorage.setItem("begraphics_admin", "1"); setAuthed(true) }
    else alert("Неверный пароль")
  }
  const logout = () => { sessionStorage.removeItem("begraphics_admin"); setAuthed(false) }

  const updateStatus = async (id: number, status: string) => {
    await api.orders.updateStatus({ id, status })
    setOrders(o => o.map(ord => ord.id === id ? { ...ord, status } : ord))
  }

  const openOrderBuild = async (orderId: number) => {
    const data = await api.builds.getAll()
    const allBuilds: PCBuild[] = data.builds || []
    const padded = String(orderId).padStart(5, "0")
    const found = allBuilds.find(b =>
      b.name.includes(padded) || b.description?.includes(`#${padded}`)
    )
    if (!found) { alert("Сборка для этого заказа не найдена"); return }
    if (!products.length) {
      const pd = await api.products.getAll()
      setProducts(pd.products || [])
      setCategories(pd.categories || [])
      const slots = await api.configurator.getSlots()
      setConfigSlots(slots.slots || {})
    }
    editBuild(found)
  }

  const [copiedOrderId, setCopiedOrderId] = useState<number | null>(null)
  const copyOrderSheet = async (orderId: number) => {
    const data = await api.builds.getAll()
    const allBuilds: PCBuild[] = data.builds || []
    const padded = String(orderId).padStart(5, "0")
    const found = allBuilds.find(b =>
      b.name.includes(padded) || b.description?.includes(`#${padded}`)
    )
    if (!found) { alert("Сборка для этого заказа не найдена"); return }
    const url = `${window.location.origin}/order-sheet/${found.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedOrderId(orderId)
      setTimeout(() => setCopiedOrderId(null), 2000)
    })
  }

  const [warrantyLoadingId, setWarrantyLoadingId] = useState<number | null>(null)
  const downloadWarranty = async (orderId: number) => {
    setWarrantyLoadingId(orderId)
    const res = await fetch(`https://functions.poehali.dev/4f468c20-b028-4d53-8dad-affcf1b45618?order_id=${orderId}`)
    const data = await res.json()
    setWarrantyLoadingId(null)
    if (!data.pdf_b64) { alert("Ошибка генерации PDF"); return }
    const bin = atob(data.pdf_b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: "application/pdf" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = data.filename || `warranty_${orderId}.pdf`; a.click()
    URL.revokeObjectURL(url)
  }

  const toggleStock = async (p: Product) => {
    const newQty = p.in_stock ? 0 : 1
    await api.products.patch({ id: p.id, stock_qty: newQty })
    setProducts(ps => ps.map(pp => pp.id === p.id ? { ...pp, in_stock: newQty > 0, stock_qty: newQty } : pp))
  }

  const deleteProduct = async (id: number) => {
    if (!confirm("Удалить товар? Это действие нельзя отменить.")) return
    await api.products.delete(id)
    setProducts(ps => ps.filter(p => p.id !== id))
  }

  const submitProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    let specs = {}
    try { specs = JSON.parse(productForm.specs || "{}") } catch { specs = {} }
    const payload = {
      id: productForm.id,
      category_id: productForm.category_id ? Number(productForm.category_id) : null,
      name: productForm.name, description: productForm.description,
      price: Number(productForm.price), old_price: productForm.old_price ? Number(productForm.old_price) : null,
      image_url: productForm.image_urls[0] || null, image_urls: productForm.image_urls, specs,
      in_stock: productForm.in_stock, is_featured: productForm.is_featured,
      sort_order: Number(productForm.sort_order),
    }
    if (productForm.id) await api.products.update(payload)
    else await api.products.create(payload)
    setTab("products")
    setProductForm({ id: null, category_id: "", name: "", description: "", price: "", old_price: "", image_urls: [], specs: "", in_stock: true, is_featured: false, sort_order: "0" })
  }

  const editProduct = (p: Product) => {
    setProductForm({
      id: p.id,
      category_id: p.category ? String(categories.find(c => c.name === p.category?.name)?.id || "") : "",
      name: p.name, description: p.description || "",
      price: String(p.price), old_price: p.old_price ? String(p.old_price) : "",
      image_urls: p.image_urls?.length ? p.image_urls : (p.image_url ? [p.image_url] : []),
      specs: JSON.stringify(p.specs || {}),
      in_stock: p.in_stock, is_featured: p.is_featured, sort_order: String(p.sort_order || 0),
    })
    setTab("add_product")
  }

  const submitBuild = async (e: React.FormEvent) => {
    e.preventDefault()
    const asm_fee = buildForm.assembly_type === "manual" ? parseFloat(buildForm.assembly_fee_manual) || 0 : assemblyFee
    const payload = {
      id: buildForm.id,
      name: buildForm.name, description: buildForm.description,
      image_urls: buildForm.image_urls,
      components: buildComponents,
      assembly_type: buildForm.assembly_type,
      assembly_fee: asm_fee,
      parts_total: partsTotal,
      total_price: partsTotal + asm_fee,
      status: buildForm.status,
      is_featured: buildForm.is_featured,
      in_stock: buildForm.in_stock,
      sort_order: 0,
    }
    let savedId = buildForm.id
    if (buildForm.id) await api.builds.update(payload)
    else { const res = await api.builds.create(payload); savedId = res.id }
    if (savedId) await api.tags.setForBuild(savedId, buildTagIds)
    setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, in_stock: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: [] })
    setBuildComponents([])
    setBuildTagIds([])
    setTab("builds")
  }

  const editBuild = (b: PCBuild) => {
    setBuildForm({
      id: b.id, name: b.name, description: b.description || "",
      status: b.status, is_featured: b.is_featured, in_stock: b.in_stock ?? false,
      assembly_type: b.assembly_type as "percent" | "manual",
      assembly_fee_manual: b.assembly_type === "manual" ? String(b.assembly_fee) : "",
      image_urls: b.image_urls || [],
    })
    setBuildComponents(b.components.map((c: { slot: string; source: string; source_id?: number; name: string; price: number; current_price?: number; qty?: number; image_urls?: string[] }) => ({
      slot: c.slot, source: c.source as "catalog" | "custom",
      source_id: c.source_id, name: c.name, price: c.current_price ?? c.price, qty: c.qty || 1,
      image_urls: c.image_urls || [],
    })))
    setBuildTagIds((b.tags || []).map(t => t.id))
    setTab("add_build")
  }

  const addCatalogComponent = (slot: string, comp: ConfigComponent) => {
    setBuildComponents(cs => {
      if (cs.some(c => c.source_id === comp.id)) return cs
      return [...cs, { slot, source: "catalog", source_id: comp.id, name: comp.name, price: comp.price, qty: 1 }]
    })
  }

  const removeComponent = (sourceId: number) => {
    setBuildComponents(cs => cs.filter(c => c.source_id !== sourceId))
  }

  const setComponentQty = (sourceId: number, delta: number) => {
    setBuildComponents(cs => cs.map(c => {
      if (c.source_id !== sourceId) return c
      const next = Math.max(1, (c.qty || 1) + delta)
      return { ...c, qty: next }
    }))
  }

  const duplicateBuild = async (b: PCBuild) => {
    setDupeLoading(b.id)
    const payload = {
      name: b.name + " (вариант)",
      description: b.description,
      image_urls: b.image_urls || [],
      components: b.components,
      assembly_type: b.assembly_type,
      assembly_fee: b.assembly_fee,
      status: "draft",
      is_featured: false,
      sort_order: 0,
      parent_id: b.id,   // ← связь через parent_id
    }
    const created = await api.builds.create(payload)
    if (created?.id) {
      const newBuild: PCBuild = {
        ...b,
        id: created.id,
        name: payload.name,
        status: "draft",
        is_featured: false,
        parent_id: b.id,
      }
      setBuilds(bs => [...bs, newBuild])
      setExpandedVariants(b.id)
    }
    setDupeLoading(null)
  }

  const deleteBuild = async (id: number) => {
    if (!confirm("Удалить сборку? Это действие нельзя отменить.")) return
    await api.builds.delete(id)
    setBuilds(bs => bs.filter(b => b.id !== id))
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6" style={{ cursor: "auto" }}>
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">B</div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">BeGraphics Admin</h1>
              <p className="text-xs text-foreground/40">Панель управления</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Пароль</label>
              <input
                type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && login()}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder="Введите пароль" style={{ cursor: "text" }}
              />
            </div>
            <button onClick={login} className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
              Войти
            </button>
            <button onClick={() => navigate("/")} className="w-full text-center text-xs text-foreground/40 hover:text-foreground/60 transition-colors" style={{ cursor: "pointer" }}>
              ← На сайт
            </button>
          </div>
        </div>
      </div>
    )
  }

  const submitArticle = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      id: articleForm.id,
      title: articleForm.title,
      slug: articleForm.slug,
      excerpt: articleForm.excerpt || null,
      content: articleForm.content,
      image_url: articleForm.image_url || null,
      category: articleForm.category,
      is_published: articleForm.is_published,
      html_attachment: articleForm.html_attachment || null,
    }
    if (articleForm.id) await api.articles.update(payload)
    else await api.articles.create(payload)
    setArticleForm({ id: null, title: "", slug: "", excerpt: "", content: "", image_url: "", category: "article", is_published: false, html_attachment: "" })
    setTab("articles")
  }

  const editArticle = (a: Article) => {
    setArticleForm({
      id: a.id, title: a.title, slug: a.slug,
      excerpt: a.excerpt || "", content: "",
      image_url: a.image_url || "", category: a.category, is_published: a.is_published,
      html_attachment: "",
    })
    api.articles.getById(a.id).then(full => {
      setArticleForm(f => ({ ...f, content: full.content || "", html_attachment: full.html_attachment || "" }))
    })
    setTab("add_article")
  }

  const deleteArticle = async (id: number) => {
    if (!confirm("Удалить статью?")) return
    await api.articles.delete(id)
    setArticles(as => as.filter(a => a.id !== id))
  }

  const submitTag = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = { id: tagForm.id, name: tagForm.name, color: tagForm.color, sort_order: Number(tagForm.sort_order) }
    if (tagForm.id) await api.tags.update(payload)
    else await api.tags.create(payload)
    const d = await api.tags.getAll()
    setTags(d.tags || [])
    setTagForm({ id: null, name: "", color: "primary", sort_order: "0" })
    setTagFormOpen(false)
  }

  const deleteTag = async (id: number) => {
    if (!confirm("Удалить тег? Он будет снят со всех сборок.")) return
    await api.tags.delete(id)
    setTags(ts => ts.filter(t => t.id !== id))
  }

  const TAG_COLORS = [
    { value: "primary", label: "Акцент" },
    { value: "green", label: "Зелёный" },
    { value: "blue", label: "Синий" },
    { value: "orange", label: "Оранжевый" },
    { value: "purple", label: "Фиолетовый" },
    { value: "red", label: "Красный" },
  ]

  const topTabs = [
    { key: "builds", label: "Наши ПК", icon: "Monitor" },
    { key: "add_build", label: buildForm.id ? "Ред. сборку" : "Новая сборка", icon: "Wrench" },
    { key: "cables", label: "Кабели", icon: "Cable" },
    { key: "archive", label: "Архив ПК", icon: "Archive" },
    { key: "tags", label: "Теги", icon: "Tag" },
    { key: "DIVIDER_1" },
    { key: "products", label: "Товары", icon: "Package" },
    { key: "add_product", label: productForm.id ? "Ред. товар" : "Добавить товар", icon: "PlusCircle" },
    { key: "DIVIDER_2" },
    { key: "articles", label: "Статьи", icon: "BookOpen" },
    { key: "add_article", label: articleForm.id ? "Ред. статью" : "Новая статья", icon: "FilePlus" },
  ]

  const bottomTabs = [
    { key: "orders", label: "Заказы", icon: "ClipboardList" },
    { key: "orders_archive", label: "Архив заказов", icon: "ArchiveX" },
    { key: "warehouse", label: "Склад", icon: "Warehouse" },
    { key: "DIVIDER_4" },
    { key: "wip_builds", label: "Сборки в процессе", icon: "Hammer" },
    { key: "wip_archive", label: "Архив сборок", icon: "ArchiveRestore" },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">B</div>
            <span className="font-semibold text-foreground">BeGraphics Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/shop")} className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors" style={{ cursor: "pointer" }}>На сайт</button>
            <button onClick={logout} className="flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground/70 transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="LogOut" size={14} />Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 border-b border-border">
          {/* Верхняя строка: сборки, товары, статьи */}
          <div className="flex items-center gap-0 overflow-x-auto">
            {topTabs.map(t => t.key.startsWith("DIVIDER") ? (
              <div key={t.key} className="mx-2 h-5 w-px shrink-0 bg-border" />
            ) : (
              <button
                key={t.key}
                onClick={() => setTab(t.key as typeof tab)}
                className={`flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${tab === t.key ? "border-primary text-primary" : "border-transparent text-foreground/60 hover:text-foreground"}`}
                style={{ cursor: "pointer" }}
              >
                <Icon name={(t.icon || "Package") as "Package"} size={15} />
                {t.label}
              </button>
            ))}
          </div>
          {/* Нижняя строка: заказы */}
          <div className="flex items-center gap-0 overflow-x-auto">
            {bottomTabs.map(t => t.key.startsWith("DIVIDER") ? (
              <div key={t.key} className="mx-2 h-5 w-px shrink-0 bg-border" />
            ) : (
              <button
                key={t.key}
                onClick={() => setTab(t.key as typeof tab)}
                className={`flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${tab === t.key ? "border-primary text-primary" : "border-transparent text-foreground/60 hover:text-foreground"}`}
                style={{ cursor: "pointer" }}
              >
                <Icon name={(t.icon || "Package") as "Package"} size={15} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ORDERS */}
        {(tab === "orders" || tab === "orders_archive") && (() => {
          const isArchive = tab === "orders_archive"
          const filtered = orders
            .filter(o => isArchive ? ARCHIVE_STATUSES.includes(o.status) : ACTIVE_STATUSES.includes(o.status))
            .filter(o => orderTypeFilter === "all" || o.order_type === orderTypeFilter)
          return (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-light text-foreground">
                  {isArchive ? "Архив заказов" : "Активные заказы"} ({filtered.length})
                </h2>
                <div className="flex items-center gap-1.5">
                  {(["all", "pc_build", "parts"] as const).map(f => (
                    <button key={f} onClick={() => setOrderTypeFilter(f)}
                      style={{ cursor: "pointer" }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${orderTypeFilter === f ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/60 hover:text-foreground"}`}>
                      {f === "all" ? "Все" : f === "pc_build" ? "Сборки ПК" : "Комплектующие"}
                    </button>
                  ))}
                </div>
              </div>
              {loading ? <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />)}</div>
                : filtered.length === 0 ? (
                  <div className="py-16 text-center text-foreground/40">
                    <Icon name="ClipboardList" size={40} className="mx-auto mb-3 opacity-30" />
                    <p>{isArchive ? "Архив пуст" : "Активных заказов нет"}</p>
                  </div>
                ) : filtered.map(order => (
                  <div key={order.id} className="mb-3 rounded-xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-mono text-xs text-foreground/40">#{order.id}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${(STATUS_LABELS[order.status] || STATUS_LABELS.new).color}`}>{(STATUS_LABELS[order.status] || STATUS_LABELS.new).label}</span>
                          {order.order_type === "pc_build" && <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-accent/10 text-accent">Сборка ПК</span>}
                          {order.order_type === "parts" && <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">Комплектующие</span>}
                          <span className="text-xs text-foreground/40">{new Date(order.created_at).toLocaleDateString("ru-RU")}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground">{order.customer_name}</p>
                        <p className="text-xs text-foreground/60">{order.customer_phone}{order.customer_email && ` · ${order.customer_email}`}</p>
                        {order.comment && <p className="mt-1 text-xs text-foreground/40 italic">"{order.comment}"</p>}
                        <div className="mt-2 space-y-0.5">
                          {(order.items || []).map((item, i) => (
                            <p key={i} className="text-xs text-foreground/50">· {item.name} × {item.quantity} — {fmt(item.price * item.quantity)}</p>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className="text-lg font-bold text-foreground">{fmt(order.total)}</p>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => copyOrderSheet(order.id)}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${copiedOrderId === order.id ? "border-green-400/40 bg-green-400/5 text-green-400" : "border-border text-foreground/50 hover:border-primary hover:text-primary"}`}
                            style={{ cursor: "pointer" }}
                            title="Скопировать ссылку для приёмщика"
                          >
                            <Icon name={copiedOrderId === order.id ? "Check" : "Link"} size={12} />
                            {copiedOrderId === order.id ? "Скопировано" : "Ссылка"}
                          </button>
                          <button
                            onClick={() => openOrderBuild(order.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                            style={{ cursor: "pointer" }}
                          >
                            <Icon name="Pencil" size={12} />
                            {order.order_type === "parts" ? "Редакт. список" : "Редакт. сборку"}
                          </button>
                          <button
                            onClick={() => downloadWarranty(order.id)}
                            disabled={warrantyLoadingId === order.id}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/50 hover:border-green-400/50 hover:text-green-400 transition-colors disabled:opacity-50"
                            style={{ cursor: "pointer" }}
                            title="Скачать гарантийный лист PDF"
                          >
                            <Icon name={warrantyLoadingId === order.id ? "Loader" : "FileText"} size={12} className={warrantyLoadingId === order.id ? "animate-spin" : ""} />
                            Гарантийный лист
                          </button>
                          <button
                            onClick={() => navigate(`/admin/order/${order.id}`)}
                            className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
                            style={{ cursor: "pointer" }}
                          >
                            <Icon name="Settings2" size={12} />
                            Обработать
                          </button>
                        </div>
                        <select
                          value={order.status}
                          onChange={e => updateStatus(order.id, e.target.value)}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                          style={{ cursor: "pointer" }}
                        >
                          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )
        })()}

        {/* PRODUCTS LIST */}
        {tab === "products" && (() => {
          const isNew = (p: Product) => !p.description && (!p.image_urls?.length && !p.image_url)
          const filtered = products
            .filter(p => productCatFilter === "all" || p.category?.name === productCatFilter)
            .filter(p => productFillFilter === "all" ? true : productFillFilter === "new" ? isNew(p) : !isNew(p))
            .filter(p => !productSearch.trim() || p.name.toLowerCase().includes(productSearch.toLowerCase()))
          return (
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-3 justify-between">
                <h2 className="text-xl font-light text-foreground">Товары ({filtered.length})</h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Icon name="Search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40" />
                    <input
                      type="text"
                      placeholder="Поиск по названию..."
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      className="rounded-lg border border-border bg-card pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:border-primary focus:outline-none w-48"
                      style={{ cursor: "text" }}
                    />
                    {productSearch && (
                      <button onClick={() => setProductSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}>
                        <Icon name="X" size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Фильтр по категориям */}
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setProductCatFilter("all")}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${productCatFilter === "all" ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
                      style={{ cursor: "pointer" }}>Все</button>
                    {categories.map(c => (
                      <button key={c.id} onClick={() => setProductCatFilter(c.name)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${productCatFilter === c.name ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
                        style={{ cursor: "pointer" }}>{c.name}</button>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    {(["all", "new", "filled"] as const).map(f => (
                      <button key={f} onClick={() => setProductFillFilter(f)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${productFillFilter === f ? "bg-primary text-primary-foreground" : "border border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
                        style={{ cursor: "pointer" }}>
                        {f === "all" ? "Все" : f === "new" ? "Новые" : "Заполненные"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Экспорт Excel */}
                    <button onClick={handleExportExcel} disabled={exportLoading}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors disabled:opacity-50"
                      style={{ cursor: "pointer" }}>
                      <Icon name={exportLoading ? "Loader" : "Download"} size={14} />
                      Excel
                    </button>
                    {/* Импорт Excel */}
                    <label className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors cursor-pointer">
                      <Icon name={importLoading ? "Loader" : "Upload"} size={14} />
                      Импорт
                      <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImportExcel(f); e.target.value = "" }} />
                    </label>
                    {/* Синхронизация с API */}
                    <button onClick={() => setShowSyncPanel(v => !v)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${showSyncPanel ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary hover:text-foreground"}`}
                      style={{ cursor: "pointer" }}>
                      <Icon name="RefreshCw" size={14} />
                      Синхронизация
                    </button>
                    <button onClick={() => setTab("add_product")} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name="Plus" size={16} />Добавить
                    </button>
                  </div>
                </div>
              </div>

              {/* Панель синхронизации с API */}
              {showSyncPanel && (
                <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <p className="text-sm font-medium text-foreground">Синхронизация с внешним API</p>
                  <div className="flex gap-2">
                    <input value={syncApiUrl} onChange={e => setSyncApiUrl(e.target.value)}
                      placeholder="URL API"
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      style={{ cursor: "text" }} />
                    <input value={syncApiKey} onChange={e => setSyncApiKey(e.target.value)}
                      placeholder="API Key"
                      className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      style={{ cursor: "text" }} />
                    <button onClick={handlePreviewApi} disabled={previewLoading || syncLoading}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-foreground disabled:opacity-50 transition-colors"
                      style={{ cursor: "pointer" }}>
                      <Icon name={previewLoading ? "Loader" : "Eye"} size={13} />
                      {previewLoading ? "Загрузка..." : "Предпросмотр"}
                    </button>
                    <button onClick={handleSyncApi} disabled={syncLoading || previewLoading}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      style={{ cursor: "pointer" }}>
                      <Icon name={syncLoading ? "Loader" : "RefreshCw"} size={13} />
                      {syncLoading ? "Синхронизация..." : "Запустить"}
                    </button>
                  </div>
                  {previewData && (
                    <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
                      <p className="text-xs font-medium text-foreground/70">Всего в API: <span className="text-foreground">{previewData.total_items}</span> товаров. Первые {previewData.parsed_sample.length} после обработки:</p>
                      <div className="space-y-1.5">
                        {previewData.parsed_sample.map((item, i) => (
                          <div key={i} className="flex items-center justify-between rounded-md bg-card px-3 py-2">
                            <span className="text-xs text-foreground truncate max-w-[60%]">{item.name || <span className="text-red-400">— нет названия</span>}</span>
                            <div className="flex items-center gap-3 text-[11px] text-foreground/50 shrink-0">
                              {item._cat_raw && <span className="text-primary/70">{item._cat_raw}</span>}
                              <span>{item.price?.toLocaleString("ru-RU")} ₽</span>
                              <span className={item.in_stock ? "text-green-400" : "text-red-400"}>{item.in_stock ? "в наличии" : "нет"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {syncResult && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-green-400 font-medium">✓ Добавлено: {syncResult.created}</span>
                        <span className="text-primary font-medium">↻ Обновлено: {syncResult.updated}</span>
                        <span className="text-foreground/50">— Пропущено: {syncResult.skipped}</span>
                        <span className="text-foreground/30">Всего в API: {syncResult.total}</span>
                      </div>
                      {syncResult.details && syncResult.details.filter(d => d.action === "created").length > 0 && (
                        <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-2 max-h-32 overflow-y-auto">
                          <p className="text-[10px] text-green-400 font-medium mb-1">Новые товары:</p>
                          {syncResult.details.filter(d => d.action === "created").map(d => (
                            <p key={d.id} className="text-[11px] text-foreground/70 truncate">+ {d.name}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {loading ? <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-card animate-pulse" />)}</div>
                : (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          {["Товар", "Категория", "Цена", "В наличии", ""].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-medium text-foreground/60">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((p, i) => (
                          <tr key={p.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {p.image_url && <img src={p.image_url} alt={p.name} className="h-10 w-10 rounded-lg object-contain bg-muted shrink-0" />}
                                <div>
                                  <p className="font-medium text-foreground">{p.name}</p>
                                  {p.is_featured && <span className="text-xs text-accent">★ Рекомендуем</span>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-foreground/60 text-xs">{p.category?.name || "—"}</td>
                            <td className="px-4 py-3 text-right">
                              <p className="font-bold text-foreground">{fmt(p.price)}</p>
                              {p.old_price && <p className="text-xs text-foreground/40 line-through">{fmt(p.old_price)}</p>}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`rounded-full px-3 py-1 text-xs font-medium ${p.stock_qty > 0 ? "bg-green-400/10 text-green-400" : "bg-red-400/10 text-red-400"}`}>
                                {p.stock_qty > 0 ? `${p.stock_qty} шт.` : "0"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <button onClick={() => editProduct(p)} className="text-foreground/40 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                                  <Icon name="Pencil" size={15} />
                                </button>
                                <button onClick={() => deleteProduct(p.id)} className="text-foreground/30 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                                  <Icon name="Trash2" size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          )
        })()}

        {/* ADD/EDIT PRODUCT */}
        {tab === "add_product" && (
          <div className="max-w-2xl">
            <h2 className="mb-6 text-xl font-light text-foreground">{productForm.id ? "Редактировать товар" : "Добавить товар"}</h2>
            <form onSubmit={submitProduct} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Название *</label>
                  <input required value={productForm.name} onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="NVIDIA RTX 4090" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Категория</label>
                  <select value={productForm.category_id} onChange={e => setProductForm(f => ({ ...f, category_id: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    <option value="">Без категории</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Описание</label>
                <RichTextEditor
                  value={productForm.description}
                  onChange={v => setProductForm(f => ({ ...f, description: v }))}
                  placeholder="Описание..."
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Цена * (₽)</label>
                  <input required type="number" value={productForm.price} onChange={e => setProductForm(f => ({ ...f, price: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="89990" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Старая цена (₽)</label>
                  <input type="number" value={productForm.old_price} onChange={e => setProductForm(f => ({ ...f, old_price: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="99990" style={{ cursor: "text" }} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Фото товара</label>
                <ImageUploader
                  images={productForm.image_urls}
                  onChange={urls => setProductForm(f => ({ ...f, image_urls: urls }))}
                  folder="products"
                  maxImages={8}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Характеристики (JSON)</label>
                <textarea rows={2} value={productForm.specs} onChange={e => setProductForm(f => ({ ...f, specs: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none resize-none" placeholder='{"vram":"16GB"}' style={{ cursor: "text" }} />
              </div>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={productForm.in_stock} onChange={e => setProductForm(f => ({ ...f, in_stock: e.target.checked }))} className="rounded" />В наличии
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={productForm.is_featured} onChange={e => setProductForm(f => ({ ...f, is_featured: e.target.checked }))} className="rounded" />Рекомендуем
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                  {productForm.id ? "Сохранить" : "Добавить"}
                </button>
                <button type="button" onClick={() => { setTab("products"); setProductForm({ id: null, category_id: "", name: "", description: "", price: "", old_price: "", image_urls: [], specs: "", in_stock: true, is_featured: false, sort_order: "0" }) }}
                  className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        )}

        {/* BUILDS LIST */}
        {tab === "builds" && <BuildsList
          builds={builds.filter(b => b.status !== "archive")}
          loading={loading}
          expandedVariants={expandedVariants}
          setExpandedVariants={setExpandedVariants}
          dupeLoading={dupeLoading}
          copiedBuildId={copiedBuildId}
          fmt={fmt}
          onNew={() => { setBuildForm({ id: null, name: "", description: "", status: "catalog", is_featured: false, assembly_type: "percent", assembly_fee_manual: "", image_urls: [] }); setBuildComponents([]); setTab("add_build") }}
          onEdit={editBuild}
          onDupe={duplicateBuild}
          onLink={generateClientLink}
          onStatus={async (b, status) => {
            await api.builds.patch({ id: b.id, status })
            // Обновляем статус главной и всех её вариантов
            setBuilds(bs => bs.map(bb =>
              bb.id === b.id || bb.parent_id === b.id ? { ...bb, status } : bb
            ))
          }}
          onDelete={deleteBuild}
          isArchive={false}
        />}

        {/* CABLES */}
        {tab === "cables" && <CablesTab />}

        {/* ARCHIVE */}
        {tab === "archive" && <BuildsList
          builds={builds.filter(b => b.status === "archive")}
          loading={loading}
          expandedVariants={expandedVariants}
          setExpandedVariants={setExpandedVariants}
          dupeLoading={dupeLoading}
          copiedBuildId={copiedBuildId}
          fmt={fmt}
          onNew={() => {}}
          onEdit={editBuild}
          onDupe={duplicateBuild}
          onLink={generateClientLink}
          onStatus={async (b, status) => { await api.builds.patch({ id: b.id, status }); setBuilds(bs => bs.map(bb => bb.id === b.id ? { ...bb, status } : bb)) }}
          onDelete={deleteBuild}
          isArchive={true}
        />}

        {/* ADD/EDIT BUILD */}
        {tab === "add_build" && (
          <div className="max-w-3xl">
            <h2 className="mb-6 text-xl font-light text-foreground">{buildForm.id ? "Редактировать сборку" : "Новая сборка"}</h2>
            <form onSubmit={submitBuild} className="space-y-6">
              {/* Basic info */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Название сборки *</label>
                  <input required value={buildForm.name} onChange={e => setBuildForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="UltraGame Pro" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Статус</label>
                  <select value={buildForm.status} onChange={e => setBuildForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    {Object.entries(BUILD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Описание</label>
                <textarea rows={2} value={buildForm.description} onChange={e => setBuildForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none resize-none" style={{ cursor: "text" }} />
              </div>
              <div>
                <label className="mb-2 block text-xs text-foreground/60">Фотографии сборки</label>
                <ImageUploader
                  images={buildForm.image_urls}
                  onChange={urls => setBuildForm(f => ({ ...f, image_urls: urls }))}
                  folder="builds"
                />
              </div>

              {/* Components constructor */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Состав сборки</h3>
                  <p className="text-xs text-foreground/40">Выбирайте товары из каталога по категориям</p>
                </div>

                {/* Быстрый поиск по каталогу */}
                {(() => {
                  const allComps = Object.entries(configSlots).flatMap(([slot, comps]) => comps.map(c => ({ ...c, slot })))
                  const q = componentSearch.trim().toLowerCase()
                  const results = q.length >= 1
                    ? allComps.filter(c => c.name.toLowerCase().includes(q)).slice(0, 10)
                    : []
                  const safeIdx = Math.min(componentSearchIdx, results.length - 1)
                  const addComp = (comp: ConfigComponent & { slot: string }) => {
                    addCatalogComponent(comp.slot, comp)
                    setComponentSearch("")
                    setComponentSearchIdx(0)
                    setTimeout(() => componentSearchRef.current?.focus(), 0)
                  }
                  return (
                    <div className="relative mb-4">
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-primary transition-colors">
                        <Icon name="Search" size={15} className="text-foreground/40 shrink-0" />
                        <input
                          ref={componentSearchRef}
                          type="text"
                          value={componentSearch}
                          onChange={e => { setComponentSearch(e.target.value); setComponentSearchIdx(0) }}
                          onKeyDown={e => {
                            if (e.key === "ArrowDown") { e.preventDefault(); setComponentSearchIdx(i => Math.min(i + 1, results.length - 1)) }
                            else if (e.key === "ArrowUp") { e.preventDefault(); setComponentSearchIdx(i => Math.max(i - 1, 0)) }
                            else if (e.key === "Enter") { e.preventDefault(); if (results[safeIdx]) addComp(results[safeIdx]) }
                            else if (e.key === "Escape") { setComponentSearch(""); setComponentSearchIdx(0) }
                          }}
                          placeholder="Быстрый поиск по каталогу..."
                          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
                          style={{ cursor: "text" }}
                        />
                        {componentSearch && (
                          <button type="button" onClick={() => { setComponentSearch(""); setComponentSearchIdx(0); componentSearchRef.current?.focus() }} className="text-foreground/30 hover:text-foreground" style={{ cursor: "pointer" }}>
                            <Icon name="X" size={13} />
                          </button>
                        )}
                      </div>
                      {results.length > 0 && (
                        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                          {results.map((c, i) => {
                            const isAdded = buildComponents.some(bc => bc.source_id === c.id)
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => addComp(c)}
                                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${i === safeIdx ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}
                                style={{ cursor: "pointer" }}
                              >
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground/50">{c.slot}</span>
                                <span className="flex-1 truncate font-medium">{c.name}</span>
                                <span className="shrink-0 text-xs font-bold text-accent">{c.price ? c.price.toLocaleString("ru-RU") + " ₽" : "—"}</span>
                                {isAdded && <Icon name="Check" size={12} className="text-primary shrink-0" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {q.length >= 1 && results.length === 0 && (
                        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card px-4 py-3 text-xs text-foreground/40 shadow-xl">
                          Ничего не найдено
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Уже добавленные компоненты */}
                {buildComponents.length > 0 && (
                  <div className="mb-3 space-y-1.5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <p className="mb-2 text-xs font-medium text-foreground/60">Позиций: {buildComponents.length} · Итого железо: {fmt(partsTotal)}</p>
                    {buildComponents.map((c, i) => (
                      <div key={i} className="rounded-lg border border-border/40 bg-card/60">
                        <div className="flex items-center gap-2 text-sm px-3 py-2">
                          <span className="w-24 shrink-0 text-xs text-foreground/50 font-mono truncate">{c.slot}</span>
                          <span className="flex-1 text-foreground font-medium truncate">{c.name}</span>
                          {/* фото-индикатор */}
                          {(c.image_urls?.length ?? 0) > 0 && (
                            <span className="shrink-0 text-[10px] text-primary/70 font-mono">{c.image_urls!.length}ф</span>
                          )}
                          {/* qty controls */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => setComponentQty(c.source_id ?? 0, -1)}
                              className="h-5 w-5 rounded border border-border text-foreground/50 hover:border-primary hover:text-primary transition-colors flex items-center justify-center"
                              style={{ cursor: "pointer" }}>
                              <Icon name="Minus" size={10} />
                            </button>
                            <span className="w-5 text-center text-xs font-bold text-foreground">{c.qty || 1}</span>
                            <button type="button" onClick={() => setComponentQty(c.source_id ?? 0, 1)}
                              className="h-5 w-5 rounded border border-border text-foreground/50 hover:border-primary hover:text-primary transition-colors flex items-center justify-center"
                              style={{ cursor: "pointer" }}>
                              <Icon name="Plus" size={10} />
                            </button>
                          </div>
                          {c.price === 0 ? (
                            <div className="flex items-center gap-0.5 shrink-0 w-28">
                              <input
                                type="number"
                                min={0}
                                placeholder="цена"
                                value={c.price === 0 ? "" : c.price}
                                onChange={e => {
                                  const val = Number(e.target.value) || 0
                                  setBuildComponents(cs => cs.map((comp, ci) => ci === i ? { ...comp, price: val } : comp))
                                }}
                                className="w-full rounded border border-border bg-background px-2 py-0.5 text-xs text-primary font-bold text-right focus:border-primary focus:outline-none"
                                style={{ cursor: "text" }}
                              />
                              <span className="text-xs text-foreground/40 shrink-0">₽</span>
                            </div>
                          ) : (
                            <span className="shrink-0 font-bold text-primary text-xs w-20 text-right">{fmt(c.price * (c.qty || 1))}</span>
                          )}
                          <button type="button" onClick={() => setExpandedComponent(expandedComponent === i ? null : i)}
                            className="text-foreground/30 hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                            <Icon name={expandedComponent === i ? "ChevronUp" : "Image"} size={13} />
                          </button>
                          <button type="button" onClick={() => removeComponent(c.source_id ?? 0)} className="text-foreground/30 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                            <Icon name="X" size={13} />
                          </button>
                        </div>
                        {expandedComponent === i && (
                          <div className="px-3 pb-3 border-t border-border/30 pt-2">
                            <p className="text-xs text-foreground/50 mb-1.5">Фото компонента</p>
                            <ImageUploader
                              images={c.image_urls || []}
                              onChange={urls => setBuildComponents(cs => cs.map((comp, ci) => ci === i ? { ...comp, image_urls: urls } : comp))}
                              folder="builds"
                              maxImages={6}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Выбор из каталога по категориям */}
                <div className="space-y-2">
                  {categories.length === 0 ? (
                    <p className="text-xs text-foreground/40 text-center py-4">Загрузка категорий...</p>
                  ) : categories.map(cat => {
                    const slotOptions = configSlots[cat.slug] || []
                    const isOpen = addingSlot === cat.slug
                    const addedFromCat = buildComponents.filter(c => c.slot === cat.slug || slotOptions.some(o => o.id === c.source_id))
                    return (
                      <div key={cat.slug} className={`rounded-xl border bg-card transition-all ${addedFromCat.length > 0 ? "border-primary/30" : "border-border"}`}>
                        <button
                          type="button"
                          onClick={() => setAddingSlot(isOpen ? null : cat.slug)}
                          className="flex w-full items-center gap-3 p-4 text-left"
                          style={{ cursor: "pointer" }}
                        >
                          <span className="flex-1 text-sm font-medium text-foreground">{cat.name}</span>
                          {addedFromCat.length > 0 && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{addedFromCat.length} выбрано</span>
                          )}
                          {slotOptions.length === 0
                            ? <span className="text-xs text-foreground/30">Нет товаров</span>
                            : <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={15} className="text-foreground/40" />
                          }
                        </button>
                        {isOpen && slotOptions.length > 0 && (
                          <div className="grid gap-1.5 grid-cols-1 sm:grid-cols-2 border-t border-border p-3">
                            {slotOptions.map(opt => {
                              const isAdded = buildComponents.some(c => c.source_id === opt.id)
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => isAdded ? removeComponent(opt.id) : addCatalogComponent(cat.slug, opt)}
                                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${isAdded ? "border-primary bg-primary/10" : "border-border hover:border-primary"}`}
                                  style={{ cursor: "pointer" }}
                                >
                                  <div className="min-w-0 mr-2">
                                    <p className="text-xs font-medium text-foreground truncate">{opt.name}</p>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <p className="text-xs font-bold text-accent">{fmt(opt.price)}</p>
                                    {isAdded && <Icon name="Check" size={12} className="text-primary" />}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Pricing */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-4 text-sm font-medium text-foreground">Стоимость сборки</h3>
                <div className="mb-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground/60">Железо:</span>
                    <span className="font-bold text-foreground">{fmt(partsTotal)}</span>
                  </div>
                </div>
                <div className="mb-4">
                  <label className="mb-2 block text-xs text-foreground/60">Стоимость сборки</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setBuildForm(f => ({ ...f, assembly_type: "percent" }))}
                      className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${buildForm.assembly_type === "percent" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                      style={{ cursor: "pointer" }}
                    >
                      7% автоматически ({fmt(Math.round(partsTotal * 0.07))})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuildForm(f => ({ ...f, assembly_type: "manual" }))}
                      className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${buildForm.assembly_type === "manual" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary"}`}
                      style={{ cursor: "pointer" }}
                    >
                      Ввести вручную
                    </button>
                  </div>
                  {buildForm.assembly_type === "manual" && (
                    <input
                      type="number"
                      value={buildForm.assembly_fee_manual}
                      onChange={e => setBuildForm(f => ({ ...f, assembly_fee_manual: e.target.value }))}
                      className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                      placeholder="Сумма за сборку (₽)"
                      style={{ cursor: "text" }}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-sm font-medium text-foreground">Итого:</span>
                  <span className="text-2xl font-bold text-foreground">{fmt(buildTotal)}</span>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <label
                  className={`flex items-center gap-2 text-sm transition-opacity ${buildForm.status === "catalog" ? "text-foreground/70 cursor-pointer" : "text-foreground/30 cursor-not-allowed"}`}
                  style={{ cursor: buildForm.status === "catalog" ? "pointer" : "not-allowed" }}
                  title={buildForm.status !== "catalog" ? "Доступно только для сборок со статусом «На сайте»" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={buildForm.in_stock}
                    disabled={buildForm.status !== "catalog"}
                    onChange={e => setBuildForm(f => ({ ...f, in_stock: e.target.checked }))}
                    className="rounded disabled:opacity-40"
                  />
                  В наличии
                  {buildForm.status !== "catalog" && (
                    <span className="text-xs text-foreground/30">(только для «На сайте»)</span>
                  )}
                </label>
                <label
                  className={`flex items-center gap-2 text-sm transition-opacity ${buildForm.status === "catalog" ? "text-foreground/70 cursor-pointer" : "text-foreground/30 cursor-not-allowed"}`}
                  style={{ cursor: buildForm.status === "catalog" ? "pointer" : "not-allowed" }}
                  title={buildForm.status !== "catalog" ? "Доступно только для сборок со статусом «На сайте»" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={buildForm.is_featured}
                    disabled={buildForm.status !== "catalog"}
                    onChange={e => setBuildForm(f => ({ ...f, is_featured: e.target.checked }))}
                    className="rounded disabled:opacity-40"
                  />
                  Рекомендуемая сборка
                </label>
              </div>

              {/* Теги */}
              {tags.length > 0 && (
                <div>
                  <label className="mb-2 block text-xs text-foreground/60">Теги</label>
                  <div className="flex flex-wrap gap-2">
                    {tags.map(t => {
                      const active = buildTagIds.includes(t.id)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setBuildTagIds(ids => active ? ids.filter(i => i !== t.id) : [...ids, t.id])}
                          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-foreground/50 hover:border-primary hover:text-foreground"}`}
                          style={{ cursor: "pointer" }}
                        >
                          {active && <Icon name="Check" size={11} />}
                          {t.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                  {buildForm.id ? "Сохранить" : "Опубликовать сборку"}
                </button>
                <button type="button" onClick={() => setTab("builds")}
                  className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── TAGS ── */}
        {tab === "tags" && (
          <div className="max-w-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-light text-foreground">Теги сборок</h2>
              <button
                onClick={() => { setTagForm({ id: null, name: "", color: "primary", sort_order: "0" }); setTagFormOpen(true) }}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={15} />Новый тег
              </button>
            </div>

            {tagFormOpen && (
              <form onSubmit={submitTag} className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">{tagForm.id ? "Редактировать тег" : "Новый тег"}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-foreground/60">Название *</label>
                    <input required value={tagForm.name} onChange={e => setTagForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                      placeholder="Игровой" style={{ cursor: "text" }} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-foreground/60">Цвет</label>
                    <select value={tagForm.color} onChange={e => setTagForm(f => ({ ...f, color: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                      {TAG_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-foreground/60">Порядок</label>
                    <input type="number" value={tagForm.sort_order} onChange={e => setTagForm(f => ({ ...f, sort_order: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                      style={{ cursor: "text" }} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                    {tagForm.id ? "Сохранить" : "Создать"}
                  </button>
                  <button type="button" onClick={() => setTagFormOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                    Отмена
                  </button>
                </div>
              </form>
            )}

            {loading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-card animate-pulse" />)}</div>
            ) : tags.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-12 text-center">
                <Icon name="Tag" size={32} className="mx-auto mb-3 text-foreground/20" />
                <p className="text-sm text-foreground/40">Тегов пока нет. Создайте первый!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tags.map(t => (
                  <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                    <TagBadge tag={t} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{t.name}</p>
                      <p className="text-xs text-foreground/40">порядок: {t.sort_order}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => { setTagForm({ id: t.id, name: t.name, color: t.color, sort_order: String(t.sort_order) }); setTagFormOpen(true) }}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name="Pencil" size={12} />
                      </button>
                      <button onClick={() => deleteTag(t.id)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/40 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name="Trash2" size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── WIP BUILDS ── */}
        {tab === "wip_builds" && (
          <div>
            {/* Шапка */}
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-light text-foreground">
                Сборки в процессе <span className="ml-1 text-sm text-foreground/40">({wipBuilds.filter(w => !["Забрали","Отменён","Архив"].includes(w.stage)).length})</span>
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setWipEditMode(v => !v)}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${wipEditMode ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
                  style={{ cursor: "pointer" }}>
                  <Icon name={wipEditMode ? "Eye" : "Pencil"} size={15} />
                  {wipEditMode ? "Просмотр" : "Ред. железо"}
                </button>
                <button
                  onClick={() => { setWipForm({ ...EMPTY_WIP }); setWipFormOpen(true) }}
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
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/50">Дата выдачи</label>
                        <input type="date" value={wipForm.issued_at} onChange={e => setWipForm(f => f && ({ ...f, issued_at: e.target.value }))}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-foreground/50">Комментарий</label>
                      <textarea rows={2} value={wipForm.comment} onChange={e => setWipForm(f => f && ({ ...f, comment: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none resize-none" style={{ cursor: "text" }} />
                    </div>
                    <div className="flex flex-wrap gap-3 pt-2">
                      <button
                        onClick={async () => {
                          if (!wipForm.order_number) return
                          if (wipForm.id) await api.wipBuilds.update(wipForm)
                          else await api.wipBuilds.create(wipForm)
                          const d = await api.wipBuilds.getAll()
                          setWipBuilds(d.wip_builds || [])
                          setWipFormOpen(false)
                        }}
                        className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                        Сохранить
                      </button>
                      {wipForm.build_id && (
                        <button
                          onClick={async () => {
                            setWipFormOpen(false)
                            const buildId = wipForm.build_id!
                            let b = builds.find(x => x.id === buildId)
                            if (!b) {
                              // Подгружаем сборку и все нужные данные если не загружены
                              const [buildData, prodData] = await Promise.all([
                                api.builds.getById(buildId),
                                products.length ? Promise.resolve(null) : api.products.getAll(),
                              ])
                              if (prodData) {
                                const prods = prodData.products || []
                                setProducts(prods)
                                setCategories(prodData.categories || [])
                                const slots: Record<string, import("./admin/types").ConfigComponent[]> = {}
                                for (const p of prods) {
                                  const slot = p.category?.slug || "other"
                                  if (!slots[slot]) slots[slot] = []
                                  slots[slot].push({ id: p.id, slot, name: p.name, brand: p.category?.name, price: p.price })
                                }
                                setConfigSlots(slots)
                              }
                              if (buildData?.id) {
                                setBuilds(bs => bs.some(x => x.id === buildData.id) ? bs : [...bs, buildData])
                                b = buildData
                              }
                            }
                            if (b) editBuild(b)
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
                      <div>
                        <p className="text-xs text-foreground/40">Клиент</p>
                        <p className="text-sm font-medium text-foreground">{w.customer_name || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-foreground/40">Телефон</p>
                        <p className="text-sm font-medium text-primary">{clientPhone}</p>
                      </div>
                      {w.contact && (
                        <div>
                          <p className="text-xs text-foreground/40">TG / контакт</p>
                          <p className="text-sm font-medium text-foreground">{w.contact}</p>
                        </div>
                      )}
                    </div>
                    <p className="mb-2 text-sm font-medium text-foreground">Паста · Заказ #{w.order_number}</p>
                    <pre className="mb-4 whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-xs text-foreground/80 leading-relaxed">{paste}</pre>
                    <button
                      onClick={() => { navigator.clipboard.writeText(paste); setWipPasteId(null) }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name="Copy" size={15} />Скопировать
                    </button>
                  </div>
                </div>
              )
            })()}

            {loading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-card animate-pulse" />)}</div>
            ) : (() => {
              const activeBuilds = wipBuilds.filter(w => !["Архив", "Отменён"].includes(w.stage))
              if (activeBuilds.length === 0) return (
                <div className="rounded-xl border border-dashed border-border py-16 text-center">
                  <Icon name="Hammer" size={36} className="mx-auto mb-3 text-foreground/20" />
                  <p className="text-sm text-foreground/40">Сборок в процессе нет</p>
                </div>
              )
              const wipBuildsForTable = activeBuilds
              const usedComps = WIP_COMPONENTS.filter(c => wipBuildsForTable.some(w => !!(w as Record<string, string>)[c.key]))
              // Строки таблицы (поля), столбцы = заказы
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
              return (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="text-xs border-collapse" style={{ minWidth: "100%" }}>
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-3 py-2.5 text-left font-mono text-foreground/30 uppercase tracking-wider whitespace-nowrap border-r border-border/50 w-28">Поле</th>
                        {wipBuildsForTable.map(w => {
                          const colId = String(w.id)
                          const colW = wipColWidths[colId] ?? DEFAULT_COL_W
                          return (
                            <th key={w.id} className={`relative px-3 py-2.5 text-left whitespace-nowrap ${w.stage === "Забрали" ? "opacity-40" : ""}`}
                              style={{ width: colW, minWidth: colW }}>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {w.client_token ? (
                                  <button
                                    onClick={() => navigate(`/build?token=${w.client_token}`)}
                                    className="font-mono font-bold text-primary hover:underline" style={{ cursor: "pointer" }}>
                                    Заказ {w.order_number}
                                  </button>
                                ) : (
                                  <span className="font-mono font-bold text-foreground">Заказ {w.order_number}</span>
                                )}
                                {w.build_id && (
                                  <button
                                    onClick={() => navigate(`/order-sheet/${w.build_id}`)}
                                    className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                                    style={{ cursor: "pointer" }}>
                                    <Icon name="Wrench" size={10} />Собрать
                                  </button>
                                )}
                              </div>
                              {/* Resize-хэндлер */}
                              <div
                                onMouseDown={e => { e.preventDefault(); startResize(colId, e.clientX, colW) }}
                                className="absolute right-0 top-0 h-full w-2 flex items-center justify-center group"
                                style={{ cursor: "col-resize" }}>
                                <div className="w-0.5 h-4 rounded-full bg-border group-hover:bg-primary transition-colors" />
                              </div>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rowIdx) => (
                        <tr key={row.key} className={`border-b border-border/40 last:border-0 ${rowIdx % 2 === 0 ? "bg-card" : "bg-muted/10"}`}>
                          {/* Заголовок строки */}
                          <td className="px-3 py-2 border-r border-border/50 font-mono text-[10px] text-foreground/40 uppercase tracking-wider whitespace-nowrap align-middle">
                            {row.label}
                          </td>
                          {/* Ячейки для каждого заказа */}
                          {wipBuildsForTable.map(w => {
                            const isArchived = w.stage === "Забрали"
                            if (row.key === "_order") return (
                              <td key={w.id} className={`px-3 py-2 ${isArchived ? "opacity-40" : ""}`}>
                                <span className="text-foreground/50 text-[11px]">{new Date(w.created_at || "").toLocaleDateString("ru-RU") || "—"}</span>
                              </td>
                            )
                            if (row.key === "_stage") return (
                              <td key={w.id} className={`px-3 py-2 ${isArchived ? "opacity-40" : ""}`}>
                                <select
                                  value={w.stage}
                                  onChange={e => {
                                    const val = e.target.value
                                    setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, stage: val } : b))
                                    api.wipBuilds.patch({ id: w.id, stage: val })
                                  }}
                                  className={`rounded-full border-0 px-2.5 py-0.5 text-[11px] font-semibold focus:outline-none whitespace-nowrap ${WIP_STAGE_COLORS[w.stage] || "bg-muted text-foreground/60"}`}
                                  style={{ cursor: "pointer" }}>
                                  {WIP_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </td>
                            )
                            if (row.key === "_client") return (
                              <td key={w.id} className={`px-3 py-2 whitespace-nowrap ${isArchived ? "opacity-40" : ""}`}>
                                <div className="font-medium text-foreground/80">{w.customer_name || "—"}</div>
                                <div className="text-primary font-mono">{w.customer_phone || w.contact || ""}</div>
                              </td>
                            )
                            if (row.key === "_received_at") return (
                              <td key={w.id} className={`px-3 py-2 ${isArchived ? "opacity-40" : ""}`}>
                                <input type="date" value={w.received_at || ""}
                                  onChange={e => {
                                    const val = e.target.value
                                    setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, received_at: val } : b))
                                    api.wipBuilds.patch({ id: w.id, received_at: val })
                                  }}
                                  className="wip-date-input rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:border-primary focus:outline-none w-28"
                                  style={{ cursor: "text" }} />
                              </td>
                            )
                            if (row.key === "_issued_at") return (
                              <td key={w.id} className={`px-3 py-2 ${isArchived ? "opacity-40" : ""}`}>
                                <input type="date" value={w.issued_at || ""}
                                  onChange={e => {
                                    const val = e.target.value
                                    setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, issued_at: val } : b))
                                    api.wipBuilds.patch({ id: w.id, issued_at: val })
                                  }}
                                  className="wip-date-input rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:border-primary focus:outline-none w-28"
                                  style={{ cursor: "text" }} />
                              </td>
                            )
                            if (row.key === "_delivery") return (
                              <td key={w.id} className={`px-3 py-2 ${isArchived ? "opacity-40" : ""}`}>
                                <select value={w.delivery_type || ""}
                                  onChange={e => {
                                    const val = e.target.value
                                    setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, delivery_type: val } : b))
                                    api.wipBuilds.patch({ id: w.id, delivery_type: val })
                                  }}
                                  className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:border-primary focus:outline-none max-w-[160px]"
                                  style={{ cursor: "pointer" }}>
                                  <option value="">—</option>
                                  {DELIVERY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </td>
                            )
                            if (row.key === "_actions") return (
                              <td key={w.id} className="px-3 py-2 whitespace-nowrap">
                                <div className="flex items-center gap-1 flex-wrap">
                                  <button onClick={() => setWipPasteId(w.id)}
                                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-foreground/50 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                                    <Icon name="Copy" size={11} />Паста
                                  </button>
                                  <button onClick={() => { setWipForm({ ...w }); setWipFormOpen(true) }}
                                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-foreground/50 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                                    <Icon name="Pencil" size={11} />Ред.
                                  </button>
                                  {w.stage === "Забрали" && (
                                    <button
                                      onClick={() => {
                                        if (!confirm("Перенести сборку в архив?")) return
                                        setWipBuilds(bs => bs.map(b => b.id === w.id ? { ...b, stage: "Архив" } : b))
                                        api.wipBuilds.patch({ id: w.id, stage: "Архив" })
                                      }}
                                      className="flex items-center gap-1 rounded-lg border border-green-500/40 bg-green-500/5 px-2 py-1 text-[11px] text-green-400 hover:bg-green-500/15 transition-colors" style={{ cursor: "pointer" }}>
                                      <Icon name="ArchiveRestore" size={11} />В архив
                                    </button>
                                  )}
                                </div>
                              </td>
                            )
                            // Компонент — берём название и кол-во из build_components
                            const val = (w as Record<string, string>)[row.key] || ""
                            const statusKey = row.key === "case_name" ? "case_status" : row.key + "_status"
                            const status = (w as Record<string, string>)[statusKey] || "pending"
                            const { label: sLabel, cls: sCls } = COMP_STATUS_LABELS[status] || COMP_STATUS_LABELS.pending
                            const cellBg = COMP_STATUS_BG[status] || ""
                            const slotKey = row.key === "case_name" ? "case" : row.key
                            const compInBuild = (w.build_components || []).find(c => c.slot === slotKey)
                            const qty = compInBuild?.qty && compInBuild.qty > 1 ? compInBuild.qty : null
                            const textCls = status === "ready" ? "text-green-400" : status === "need_order" ? "text-red-400" : status === "ordered_delay" ? "text-orange-400" : status === "ordered_transit" ? "text-yellow-400" : "text-foreground/70"
                            return (
                              <td key={w.id} className={`px-3 py-2 transition-colors ${cellBg} ${isArchived ? "opacity-40" : ""}`}>
                                {val ? (
                                  <div className="flex flex-col gap-0.5 min-w-[120px] max-w-[200px]">
                                    <div className="flex items-start gap-1">
                                      <span className={`leading-snug line-clamp-2 ${textCls}`}>{val}</span>
                                      {qty && <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] font-bold text-primary">{qty}шт</span>}
                                    </div>
                                    {wipEditMode ? (
                                      <select
                                        value={status}
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
                                ) : <span className="text-foreground/20">—</span>}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        )}

        {/* ── WIP ARCHIVE ── */}
        {tab === "wip_archive" && (
          <div>
            <div className="mb-5">
              <h2 className="text-xl font-light text-foreground">
                Архив сборок <span className="ml-1 text-sm text-foreground/40">({wipBuilds.filter(w => ["Архив","Отменён","Забрали"].includes(w.stage)).length})</span>
              </h2>
            </div>
            {loading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-card animate-pulse" />)}</div>
            ) : wipBuilds.filter(w => ["Архив","Отменён","Забрали"].includes(w.stage)).length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-16 text-center">
                <Icon name="ArchiveRestore" size={36} className="mx-auto mb-3 text-foreground/20" />
                <p className="text-sm text-foreground/40">Архив пуст</p>
              </div>
            ) : (
              <div className="space-y-2">
                {wipBuilds.filter(w => ["Архив","Отменён","Забрали"].includes(w.stage)).map(w => (
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
                            <span key={c.key} className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${cls}`}>
                              {val}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                    {w.client_token && (
                      <button onClick={() => navigate(`/build?token=${w.client_token}`)}
                        className="shrink-0 text-xs text-foreground/30 hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name="ExternalLink" size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ARTICLES LIST ── */}
        {tab === "articles" && (
          <div>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Статьи и тесты</h2>
              <button onClick={() => { setArticleForm({ id: null, title: "", slug: "", excerpt: "", content: "", image_url: "", category: "article", is_published: false, html_attachment: "" }); setTab("add_article") }}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="Plus" size={15} />Новая статья
              </button>
            </div>
            {loading ? (
              <p className="text-sm text-foreground/40">Загрузка...</p>
            ) : articles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-12 text-center">
                <Icon name="BookOpen" size={32} className="mx-auto mb-3 text-foreground/20" />
                <p className="text-sm text-foreground/40">Статей пока нет. Создайте первую!</p>
              </div>
            ) : (
              <div className="space-y-2">
                {articles.map(a => (
                  <div key={a.id} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
                    {a.image_url && (
                      <img src={a.image_url} alt={a.title} className="h-14 w-20 rounded-lg object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.is_published ? "bg-green-400/10 text-green-400" : "bg-muted text-foreground/40"}`}>
                          {a.is_published ? "Опубликована" : "Черновик"}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">
                          {a.category === "review" ? "Обзор" : a.category === "test" ? "Тест" : "Статья"}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-foreground truncate">{a.title}</p>
                      <p className="text-xs text-foreground/40">{new Date(a.created_at).toLocaleDateString("ru-RU")} · {a.views} просмотров</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => editArticle(a)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                        Редакт.
                      </button>
                      <button onClick={() => deleteArticle(a.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/50 hover:border-red-400 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name="Trash2" size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ADD / EDIT ARTICLE ── */}
        {tab === "add_article" && (
          <div>
            <h2 className="mb-5 text-lg font-semibold text-foreground">{articleForm.id ? "Редактировать статью" : "Новая статья"}</h2>
            <form onSubmit={submitArticle} className="space-y-4 max-w-3xl">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Заголовок *</label>
                  <input required value={articleForm.title}
                    onChange={e => setArticleForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Slug (URL)</label>
                  <input value={articleForm.slug}
                    onChange={e => setArticleForm(f => ({ ...f, slug: e.target.value }))}
                    placeholder="auto-generated"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Категория</label>
                  <select value={articleForm.category}
                    onChange={e => setArticleForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                    <option value="article">Статья</option>
                    <option value="review">Обзор</option>
                    <option value="test">Тест / Бенчмарк</option>
                    <option value="guide">Гайд</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">URL изображения</label>
                  <input value={articleForm.image_url}
                    onChange={e => setArticleForm(f => ({ ...f, image_url: e.target.value }))}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Краткое описание (превью)</label>
                <RichTextEditor
                  value={articleForm.excerpt}
                  onChange={v => setArticleForm(f => ({ ...f, excerpt: v }))}
                  placeholder="Краткое описание для карточки статьи..."
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Текст статьи *</label>
                <RichTextEditor
                  value={articleForm.content}
                  onChange={v => setArticleForm(f => ({ ...f, content: v }))}
                  placeholder="Начните писать статью..."
                  className="min-h-[400px]"
                />
              </div>

              {/* HTML-вложение */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs text-foreground/60">HTML-вложение <span className="text-foreground/30">(опционально — для результатов тестов, бенчмарков)</span></label>
                  {articleForm.html_attachment && (
                    <button type="button" onClick={() => setArticleForm(f => ({ ...f, html_attachment: "" }))}
                      className="text-xs text-foreground/40 hover:text-red-400 transition-colors flex items-center gap-1" style={{ cursor: "pointer" }}>
                      <Icon name="X" size={11} /> Очистить
                    </button>
                  )}
                </div>
                <div className="relative">
                  <textarea rows={8} value={articleForm.html_attachment}
                    onChange={e => setArticleForm(f => ({ ...f, html_attachment: e.target.value }))}
                    placeholder="<!DOCTYPE html>&#10;<html>&#10;  <body>&#10;    <!-- Вставьте HTML-код результатов теста -->&#10;  </body>&#10;</html>"
                    className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none resize-y font-mono" style={{ cursor: "text" }} />
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                    {articleForm.html_attachment && (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {articleForm.html_attachment.length.toLocaleString()} симв.
                      </span>
                    )}
                    <label className="flex cursor-pointer items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground/50 hover:border-primary hover:text-foreground transition-colors">
                      <Icon name="Upload" size={11} />
                      .html
                      <input type="file" accept=".html,.htm" className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const reader = new FileReader()
                          reader.onload = ev => setArticleForm(f => ({ ...f, html_attachment: ev.target?.result as string || "" }))
                          reader.readAsText(file)
                          e.target.value = ""
                        }} />
                    </label>
                  </div>
                </div>
                {articleForm.html_attachment && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-foreground/40 hover:text-foreground/60 select-none">Предпросмотр</summary>
                    <div className="mt-2 rounded-lg border border-border overflow-hidden" style={{ height: 320 }}>
                      <iframe
                        srcDoc={articleForm.html_attachment}
                        sandbox="allow-scripts"
                        className="w-full h-full border-0 bg-white"
                        title="HTML preview"
                      />
                    </div>
                  </details>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_published" checked={articleForm.is_published}
                  onChange={e => setArticleForm(f => ({ ...f, is_published: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary" style={{ cursor: "pointer" }} />
                <label htmlFor="is_published" className="text-sm text-foreground/70" style={{ cursor: "pointer" }}>
                  Опубликовать (показывать на сайте)
                </label>
              </div>
              <div className="flex gap-3">
                <button type="submit" className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                  {articleForm.id ? "Сохранить" : "Создать статью"}
                </button>
                <button type="button" onClick={() => setTab("articles")}
                  className="rounded-lg border border-border px-6 py-2.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        )}

        {tab === "warehouse" && <WarehouseTab />}

      </div>
    </div>
  )
}