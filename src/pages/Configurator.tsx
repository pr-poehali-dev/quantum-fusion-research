import { useState, useEffect, useRef, useMemo } from "react"
import { useCart, CartItem } from "@/store/cart"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { useNavigate, useSearchParams, useParams } from "react-router-dom"
import RichTextEditor from "@/components/ui/rich-text-editor"
import { ImageUploader } from "@/components/image-uploader"
import CommentSection from "@/components/CommentSection"
import NotificationBell from "@/components/NotificationBell"
import SlotPickerModal, { SelectedSpecValues } from "@/components/configurator/SlotPickerModal"
import { findCompatIssues, SpecLinkRule, SchemaAttribute } from "@/components/configurator/compatCheck"
import CatalogTabs from "@/components/CatalogTabs"


const SLOT_LABELS: Record<string, { label: string; icon: string; required: boolean }> = {
  cpu:         { label: "Процессор",             icon: "Cpu",        required: true  },
  motherboard: { label: "Материнская плата",     icon: "CircuitBoard",required: true  },
  gpu:         { label: "Видеокарта",            icon: "Monitor",    required: false },
  ram:         { label: "Оперативная память",    icon: "MemoryStick",required: true  },
  storage:     { label: "Накопитель",            icon: "HardDrive",  required: false },
  cooling:     { label: "Система охлаждения",    icon: "Wind",       required: true  },
  psu:         { label: "Блок питания",          icon: "Zap",        required: true  },
  case:        { label: "Корпус",                icon: "Box",        required: true  },
  fan:         { label: "Вентилятор",            icon: "Fan",        required: false },
}

interface CatalogComp {
  id: number
  slot: string
  name: string
  brand?: string
  price: number
  specs: Record<string, string>
}

interface SelectedComp {
  slot: string
  name: string
  price: number
  qty: number
  link?: string
  source: "catalog" | "custom"
  source_id?: number
  description?: string
  image_urls?: string[]
}

interface SlotExtra {
  description: string
  image_urls: string[]
}

// Автосохранение черновика конфигурации в браузере
const DRAFT_KEY = "configurator-draft-v1"
interface ConfigDraft {
  selected: Record<string, SelectedComp | null>
  customInputs: Record<string, { name: string; price: string; link: string; description: string; image_urls: string[] }>
  slotExtras: Record<string, SlotExtra>
  wantAssembly: boolean
  buildName: string
  // Характеристики выбранных деталей и их привязка к слотам —
  // нужны, чтобы предупреждения о совместимости не пропадали после перезахода.
  selectedSpec: SelectedSpecValues
  specSlotMap: Record<number, string>
}
function loadDraft(): Partial<ConfigDraft> {
  // Не восстанавливаем черновик, если открыта чужая/конкретная сборка по ссылке
  if (new URLSearchParams(window.location.search).get("build")) return {}
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") } catch { return {} }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* noop */ }
}

// Русское склонение числительных: plural(2, "слот","слота","слотов") → "слота"
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

// Компонент счётчика qty
function QtyControl({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(1, qty - 1))}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
        style={{ cursor: "pointer" }}
      >
        <Icon name="Minus" size={11} />
      </button>
      <input
        type="number"
        min={1}
        max={99}
        value={qty}
        onChange={e => onChange(Math.max(1, parseInt(e.target.value) || 1))}
        className="w-11 rounded-lg border border-border bg-background px-1 py-1 text-center text-xs font-medium text-foreground focus:border-primary focus:outline-none"
        style={{ cursor: "text" }}
      />
      <button
        onClick={() => onChange(qty + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
        style={{ cursor: "pointer" }}
      >
        <Icon name="Plus" size={11} />
      </button>
    </div>
  )
}

// Предупреждение о проблемах/совете компонента.
// severity: "critical" — критичные несовместимости (рыжий, ⚠️, «Проблема»),
//           "advice" — мягкий совет (жёлтый, 💡, «Совет»).
// texts — список сообщений. При нескольких critical показывается счётчик
// «Проблемы: N» с раскрытием списка; при одном — обычный текст.
// Совет и проблемы НЕ объединяются — рендерятся отдельными блоками.
function CompatWarning({ texts, severity = "critical" }: { texts: string[]; severity?: "critical" | "advice" }) {
  const [open, setOpen] = useState(false)
  if (texts.length === 0) return null
  const crit = severity === "critical"
  const box = crit
    ? "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400"
    : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
  const icon = crit ? "TriangleAlert" : "Lightbulb"
  const single = texts[0]
  const multi = texts.length > 1

  // Несколько проблем — счётчик «Проблемы: N» с раскрытием (десктоп и моб.)
  if (multi) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button onClick={() => setOpen(o => !o)} style={{ cursor: "pointer" }}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium leading-snug ${box}`}>
          <Icon name={icon} size={13} className="shrink-0" />
          <span>Проблемы: {texts.length}</span>
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={13} className="shrink-0 opacity-70" />
        </button>
        {open && (
          <ul className={`max-w-[240px] space-y-1 rounded-lg border px-2.5 py-1.5 text-right text-[11px] leading-snug ${box}`}>
            {texts.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        )}
      </div>
    )
  }

  // Одно сообщение — единый свёрнутый вид на всех экранах: значок + пояснялка,
  // полный текст раскрывается по клику.
  const label = crit ? "Проблема" : "Совет"
  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={() => setOpen(o => !o)} style={{ cursor: "pointer" }}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium leading-snug ${box}`}>
        <Icon name={icon} size={13} className="shrink-0" />
        <span>{label}</span>
        <Icon name="CircleHelp" size={13} className="shrink-0 opacity-70" />
      </button>
      {open && (
        <div className={`max-w-[240px] rounded-lg border px-2.5 py-1.5 text-right text-[11px] leading-snug ${box}`}>
          {single}
        </div>
      )}
    </div>
  )
}

function ExtrasSection({ extraItems, onAddCustom, onRemoveExtra }: {
  extraItems: { key: string; item: SelectedComp }[]
  onAddCustom: () => void
  onRemoveExtra: (key: string) => void
}) {
  const { items, removeItem } = useCart()
  const navigate = useNavigate()

  const cableItems = items.filter((i: CartItem) => i.type === "config" && i.name.startsWith("Кастомные кабели"))
  const fmtP = (n: number) => n.toLocaleString("ru-RU") + " ₽"
  const hasAny = cableItems.length > 0 || extraItems.length > 0

  return (
    <div className={`rounded-xl border bg-card transition-all duration-200 ${hasAny ? "border-primary/40" : "border-border"}`}>
      <div className="flex items-center gap-3 p-4">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${hasAny ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/40"}`}>
          <Icon name="Package" size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Прочее</p>
          {!hasAny && <p className="text-xs text-foreground/30">Кабели, аксессуары и свои позиции</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <button onClick={onAddCustom}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors"
            style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={13} />
            Своя позиция
          </button>
          <button onClick={() => navigate("/cables")}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors"
            style={{ cursor: "pointer" }}>
            <Icon name="Cable" size={13} />
            Кабели
          </button>
        </div>
      </div>

      {hasAny && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-2">
          {extraItems.map(({ key, item }) => (
            <div key={key} className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon name="Box" size={14} className="text-primary shrink-0" />
                <p className="text-sm text-foreground truncate">{item.name}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-medium text-foreground/60">{fmtP(item.price)}</span>
                <button onClick={() => onRemoveExtra(key)}
                  className="text-foreground/30 hover:text-red-400 transition-colors"
                  style={{ cursor: "pointer" }}>
                  <Icon name="X" size={14} />
                </button>
              </div>
            </div>
          ))}
          {cableItems.map((item: CartItem) => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon name="Cable" size={14} className="text-primary shrink-0" />
                <p className="text-sm text-foreground truncate">
                  {item.name.replace("Кастомные кабели C-Cables: ", "")}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-foreground/40">C-Cables</span>
                <button onClick={() => removeItem(item.id)}
                  className="text-foreground/30 hover:text-red-400 transition-colors"
                  style={{ cursor: "pointer" }}>
                  <Icon name="X" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Configurator() {
  const draft0 = useRef(loadDraft()).current
  const [slots, setSlots] = useState<Record<string, CatalogComp[]>>({})
  const [selected, setSelected] = useState<Record<string, SelectedComp | null>>(draft0.selected || {})
  const [customInputs, setCustomInputs] = useState<Record<string, { name: string; price: string; link: string; description: string; image_urls: string[] }>>(draft0.customInputs || {})
  const [viewMode, setViewMode] = useState<"detailed" | "compact">("detailed")
  // Мобильный экран (<640px): на телефоне фото делаем компактными и кладём
  // название поверх фото — иначе крупное превью ломает вёрстку карточки слота.
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)")
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  // НОВОЕ окно выбора с фильтрами совместимости (тестовый прототип)
  const [pickerSlot, setPickerSlot] = useState<string | null>(null)
  // Значения характеристик уже выбранных деталей (для расчёта совместимости).
  // Восстанавливаем из черновика, иначе предупреждения слетают после перезахода.
  const [selectedSpec, setSelectedSpec] = useState<SelectedSpecValues>(draft0.selectedSpec || {})
  // Соответствие spec-категория → слот (чтобы знать кол-во выбранных деталей)
  const [specSlotMap, setSpecSlotMap] = useState<Record<number, string>>(draft0.specSlotMap || {})
  // Схема совместимости (правила + атрибуты) для предупреждений прямо в конфигураторе
  const [compatLinks, setCompatLinks] = useState<SpecLinkRule[]>([])
  const [compatAttrs, setCompatAttrs] = useState<SchemaAttribute[]>([])
  const [loading, setLoading] = useState(true)
  const [wantAssembly, setWantAssembly] = useState(draft0.wantAssembly ?? true)

  // Сохранение / шеринг
  const [buildName, setBuildName] = useState(draft0.buildName || "Моя сборка")
  const [isPublic, setIsPublic] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ token: string; code?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [showSavePanel, setShowSavePanel] = useState(false)

  const [buildAuthor, setBuildAuthor] = useState<{ username: string; avatar: string; tag: string } | null>(null)
  const [buildDescription, setBuildDescription] = useState("")
  const [buildImageUrls, setBuildImageUrls] = useState<string[]>([])
  const [slotExtras, setSlotExtras] = useState<Record<string, SlotExtra>>(draft0.slotExtras || {})
  const [slotSearch, setSlotSearch] = useState("")
  const [slotSearchIdx, setSlotSearchIdx] = useState(0)
  const slotSearchRef = useRef<HTMLInputElement>(null)

  const { addItem, count } = useCart()
  const { isAuthed, sessionId, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { code: routeCode } = useParams<{ code: string }>()
  const [buildToken, setBuildToken] = useState<string | null>(null)
  const [buildShortCode, setBuildShortCode] = useState<string | null>(null)
  const [buildCopied, setBuildCopied] = useState(false)
  const [isReadOnly, setIsReadOnly] = useState(false)
  const highlightCommentId = (() => {
    const hash = window.location.hash
    const m = hash.match(/comment-(\d+)/)
    return m ? Number(m[1]) : null
  })()

  useEffect(() => {
    api.configurator.getSlots().then(data => {
      setSlots(data.slots || {})
      setLoading(false)
    })

    // Схема совместимости — для предупреждений прямо в конфигураторе
    api.warehouse.specSchema().then(schema => {
      setCompatLinks((schema.links || []).filter((l: SpecLinkRule) => l.is_active))
      setCompatAttrs(schema.attributes || [])
    }).catch(() => {})

    // Загрузка готовой сборки, переданной из BuildPreview (компоненты на руках)
    const navState = window.history.state?.usr as { initialComponents?: SelectedComp[]; buildName?: string } | undefined
    if (navState?.initialComponents?.length) {
      const loaded: Record<string, SelectedComp | null> = {}
      const extras: Record<string, SlotExtra> = {}
      for (const c of navState.initialComponents) {
        if (c.slot) {
          loaded[c.slot] = { ...c, qty: c.qty || 1 }
          if (c.description || c.image_urls?.length) {
            extras[c.slot] = { description: c.description || "", image_urls: c.image_urls || [] }
          }
        }
      }
      setSelected(loaded)
      setSlotExtras(extras)
      if (navState.buildName) setBuildName(`${navState.buildName} (моя версия)`)
      return
    }

    // Загрузка сборки: новый короткий код /s/:code или старая ссылка ?build=token
    const token = searchParams.get("build")
    const editMode = searchParams.get("edit") === "1"

    const applyBuild = (b: { components?: SelectedComp[]; name?: string; username?: string; author_avatar?: string; author_tag?: string; share_token?: string; short_code?: string }) => {
      if (!b?.components) return
      const loaded: Record<string, SelectedComp | null> = {}
      const extras: Record<string, SlotExtra> = {}
      for (const c of b.components) {
        if (c.slot) {
          loaded[c.slot] = { ...c, qty: c.qty || 1 }
          if (c.description || c.image_urls?.length) {
            extras[c.slot] = { description: c.description || "", image_urls: c.image_urls || [] }
          }
        }
      }
      setSelected(loaded)
      setSlotExtras(extras)
      setBuildName(b.name || "Загруженная сборка")
      if (b.short_code) setBuildShortCode(b.short_code)
      if (b.share_token && !editMode) setBuildToken(b.share_token)
      if (b.username) {
        setBuildAuthor({ username: b.username, avatar: b.author_avatar || "", tag: b.author_tag || "" })
      }
    }

    if (routeCode) {
      setIsReadOnly(true)
      setBuildShortCode(routeCode)
      api.auth.getBuildByCode(routeCode).then(applyBuild).catch(() => {})
    } else if (token) {
      setBuildToken(editMode ? null : token)
      setIsReadOnly(!editMode)
      api.auth.getBuildByToken(token).then(applyBuild).catch(() => {})
    }
  }, [])

  // Автосохранение черновика в браузер (кроме режима просмотра чужой сборки)
  useEffect(() => {
    if (isReadOnly) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ selected, customInputs, slotExtras, wantAssembly, buildName, selectedSpec, specSlotMap }))
    } catch { /* noop */ }
  }, [selected, customInputs, slotExtras, wantAssembly, buildName, selectedSpec, specSlotMap, isReadOnly])

  const partsTotal = Object.values(selected).reduce((sum, c) => sum + (c ? c.price * c.qty : 0), 0)
  const assemblyFee = wantAssembly ? Math.round(partsTotal * 0.07) : 0
  const total = partsTotal + assemblyFee
  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const requiredSlots = Object.entries(SLOT_LABELS).filter(([, v]) => v.required).map(([k]) => k)
  const isComplete = requiredSlots.every(slot => selected[slot])
  const allFromCatalog = Object.values(selected).filter(Boolean).every(c => c?.source === "catalog")
  const hasComponents = Object.values(selected).some(Boolean)

  // Незаполненные обязательные слоты — для предупреждения (без блокировки)
  const missingRequired = requiredSlots
    .filter(slot => !selected[slot])
    .map(slot => SLOT_LABELS[slot]?.label || slot)

  const addToCart = () => {
    const names = Object.values(selected).filter(Boolean).map(c => c!.name).join(", ").substring(0, 80)
    const components = Object.values(selected).filter(Boolean).map(c => ({
      slot: c!.slot,
      name: c!.name,
      price: c!.price,
      qty: c!.qty,
      source: c!.source as "catalog" | "custom",
      source_id: c!.source_id,
    }))
    addItem({ id: Date.now(), name: `Сборка: ${names}`, price: total, type: "config", assembly: wantAssembly, components })
    clearDraft()
    navigate("/cart")
  }

  // «Добавить все товары в корзину» — кладёт КАЖДЫЙ выбранный товар из каталога
  // отдельной позицией (пустые слоты и «своё железо» пропускаем).
  const addAllProductsToCart = async () => {
    const fromCatalog = Object.values(selected)
      .filter(Boolean)
      .filter(c => c!.source === "catalog" && c!.source_id) as SelectedComp[]
    if (!fromCatalog.length) return

    // Для товаров без сохранённого фото подтягиваем актуальную картинку из каталога
    const needImage = fromCatalog.filter(c => !c.image_urls?.[0] && c.source_id)
    const imageById: Record<number, string | null> = {}
    await Promise.all(needImage.map(async c => {
      try {
        const p = await api.products.getById(c.source_id!)
        imageById[c.source_id!] = p?.image_url || p?.image_urls?.[0] || null
      } catch { imageById[c.source_id!] = null }
    }))

    fromCatalog.forEach(c => {
      const image_url = c.image_urls?.[0] || imageById[c.source_id!] || null
      for (let i = 0; i < (c.qty || 1); i++) {
        addItem({
          id: c.source_id!,
          name: c.name,
          price: c.price,
          image_url,
          description: c.description || null,
          type: "product",
        })
      }
    })
    navigate("/cart")
  }
  const catalogPicked = Object.values(selected).filter(c => c?.source === "catalog" && c?.source_id).length

  // Выбор из НОВОГО окна (с фильтрами совместимости).
  // p — товар слота с values характеристик, specCatId — id spec-категории.
  const pickFromPicker = (slot: string) => (
    p: { id: number; name: string; price: number; image_urls?: string[]; description?: string; values: Record<string, string | string[]> },
    specCatId: number
  ) => {
    setSelected(s => ({ ...s, [slot]: {
      slot, name: p.name, price: p.price, qty: 1, source: "catalog", source_id: p.id,
      description: p.description, image_urls: p.image_urls,
    } }))
    // запоминаем характеристики выбранной детали для совместимости остальных слотов
    setSelectedSpec(prev => ({ ...prev, [specCatId]: p.values }))
    setSpecSlotMap(prev => ({ ...prev, [specCatId]: slot }))
    setPickerSlot(null)
  }

  // Быстрый выбор товара из глобального поиска (дропдаун вверху).
  // Подставляем деталь в её слот сразу. Spec-значения для совместимости здесь
  // не подгружаем — пользователь может открыть полное окно слота для проверки.
  const quickPick = (comp: CatalogComp) => {
    setSelected(s => ({ ...s, [comp.slot]: {
      slot: comp.slot, name: comp.name, price: comp.price, qty: 1, source: "catalog", source_id: comp.id,
    } }))
    setSlotSearch("")
    setSlotSearchIdx(0)
    setTimeout(() => slotSearchRef.current?.focus(), 0)
  }

  // Очистка слота: убираем деталь И её характеристики/привязку, чтобы не
  // оставались «висячие» предупреждения по удалённой детали.
  const clearSlot = (slot: string) => {
    setSelected(s => ({ ...s, [slot]: null }))
    setSpecSlotMap(prevMap => {
      const nextMap = { ...prevMap }
      setSelectedSpec(prevSpec => {
        const nextSpec = { ...prevSpec }
        for (const [catId, sl] of Object.entries(prevMap)) {
          if (sl === slot) { delete nextSpec[Number(catId)]; delete nextMap[Number(catId)] }
        }
        return nextSpec
      })
      return nextMap
    })
  }

  // Кол-во выбранных деталей по spec-категориям (для расчёта мощности БП с учётом
  // нескольких видеокарт и т.п.)
  const selectedQty = useMemo(() => {
    const m: Record<number, number> = {}
    for (const [catId, slot] of Object.entries(specSlotMap)) {
      m[Number(catId)] = selected[slot]?.qty || 1
    }
    return m
  }, [specSlotMap, selected])

  // Ручной ввод своей позиции из нового окна
  const addCustomFromPicker = (slot: string) => (item: { name: string; price: number; link?: string }) => {
    // «Прочее» (extra) — добавляем как отдельную позицию с уникальным ключом,
    // чтобы можно было добавить несколько. Остальные слоты — заменяем содержимое.
    const key = slot === "extra" ? `extra:${Date.now()}` : slot
    setSelected(s => ({ ...s, [key]: { slot: key, name: item.name, price: item.price, qty: 1, link: item.link, source: "custom" } }))
    setPickerSlot(null)
  }

  const removeExtra = (key: string) => setSelected(s => { const n = { ...s }; delete n[key]; return n })

  // Позиции «Прочее» (свои), добавленные вручную
  const extraItems = Object.entries(selected)
    .filter(([k, v]) => k.startsWith("extra:") && v)
    .map(([k, v]) => ({ key: k, item: v! }))

  const updateQty = (slot: string, qty: number) => {
    setSelected(s => s[slot] ? { ...s, [slot]: { ...s[slot]!, qty } } : s)
  }

  // Полная очистка конфигурации
  const clearAll = () => {
    setSelected({})
    setSelectedSpec({})
    setSpecSlotMap({})
    setCustomInputs({})
    setSlotExtras({})
    clearDraft()
  }

  // ── Проверка: число накопителей M.2 vs слотов M.2 на материнской плате ──
  // attribute_id из спек-схемы (стабильные seed-значения):
  //   11 — «Слотов M.2» у материнской платы (spec-категория motherboard)
  //   31 — «Интерфейс» у накопителя (spec-категория storage)
  const ssdSlotWarning = useMemo(() => {
    const ATTR_MB_M2_SLOTS = 11
    const ATTR_STORAGE_INTERFACE = 31

    const storage = selected.storage
    if (!storage || storage.source !== "catalog") return null

    // spec-категория накопителя (по карте specCat → slot)
    const storageCatEntry = Object.entries(specSlotMap).find(([, sl]) => sl === "storage")
    if (!storageCatEntry) return null
    const storageVals = selectedSpec[Number(storageCatEntry[0])]
    if (!storageVals) return null

    // Накопитель считается M.2, если его интерфейс содержит "M.2" или "NVMe"
    const rawIface = storageVals[String(ATTR_STORAGE_INTERFACE)]
    const ifaceText = (Array.isArray(rawIface) ? rawIface.join(" ") : String(rawIface ?? "")).toLowerCase()
    const isM2 = ifaceText.includes("m.2") || ifaceText.includes("m2") || ifaceText.includes("nvme")
    if (!isM2) return null

    // Кол-во слотов M.2 у выбранной материнской платы
    const mbCatEntry = Object.entries(specSlotMap).find(([, sl]) => sl === "motherboard")
    if (!mbCatEntry) return null
    const mbVals = selectedSpec[Number(mbCatEntry[0])]
    if (!mbVals) return null
    const rawSlots = mbVals[String(ATTR_MB_M2_SLOTS)]
    const slotsCount = parseInt(String(Array.isArray(rawSlots) ? rawSlots[0] : rawSlots), 10)
    if (!Number.isFinite(slotsCount) || slotsCount <= 0) return null

    const qty = storage.qty || 1
    if (qty <= slotsCount) return null

    return { slots: slotsCount, qty, over: qty - slotsCount }
  }, [selected, selectedSpec, specSlotMap])

  // ── Проверка: мощность БП vs суммарный TDP (процессор + видеокарта) ──
  // attribute_id из спек-схемы (стабильные seed-значения):
  //   3  — TDP процессора, 18 — TDP видеокарты, 20 — Мощность БП (Вт)
  const psuWarning = useMemo(() => {
    const ATTR_CPU_TDP = 3
    const ATTR_GPU_TDP = 18
    const ATTR_PSU_WATT = 20
    const RESERVE = 300

    const psu = selected.psu
    if (!psu || psu.source !== "catalog") return null

    // Мощность выбранного БП
    const psuEntry = Object.entries(specSlotMap).find(([, sl]) => sl === "psu")
    if (!psuEntry) return null
    const psuVals = selectedSpec[Number(psuEntry[0])]
    if (!psuVals) return null
    const rawWatt = psuVals[String(ATTR_PSU_WATT)]
    const psuWatt = parseFloat(String(Array.isArray(rawWatt) ? rawWatt[0] : rawWatt).replace(",", "."))
    if (!Number.isFinite(psuWatt) || psuWatt <= 0) return null

    // Суммарный TDP процессора и видеокарты с учётом их количества
    const tdpFor = (slot: string, attrId: number): number => {
      const entry = Object.entries(specSlotMap).find(([, sl]) => sl === slot)
      if (!entry) return 0
      const vals = selectedSpec[Number(entry[0])]
      if (!vals) return 0
      const raw = vals[String(attrId)]
      const w = parseFloat(String(Array.isArray(raw) ? raw[0] : raw).replace(",", "."))
      if (!Number.isFinite(w) || w <= 0) return 0
      const qty = selected[slot]?.qty || 1
      return w * qty
    }
    const totalTdp = tdpFor("cpu", ATTR_CPU_TDP) + tdpFor("gpu", ATTR_GPU_TDP)
    if (totalTdp <= 0) return null

    const needed = totalTdp + RESERVE
    if (psuWatt >= needed) return null

    const NOMINALS = [450, 550, 650, 750, 850, 1000, 1200, 1300, 1500, 1600]
    const recommended = NOMINALS.find(n => n >= needed) || Math.ceil(needed / 100) * 100
    return { watt: psuWatt, recommended, totalTdp }
  }, [selected, selectedSpec, specSlotMap])

  // ── Предупреждения о несовместимости (сокет, тип памяти и т.п.) по слотам ──
  // Те же правила spec_links, что в окне выбора, но показываем прямо у строк.
  const compatWarningsBySlot = useMemo(() => {
    const issues = findCompatIssues(compatLinks, compatAttrs, selectedSpec)
    const bySlot: Record<string, string[]> = {}
    for (const iss of issues) {
      // Привязываем нарушение к обоим слотам участвующих деталей
      for (const cat of [iss.fromCat, iss.toCat]) {
        const slot = specSlotMap[cat]
        if (!slot) continue
        if (!bySlot[slot]) bySlot[slot] = []
        if (!bySlot[slot].includes(iss.message)) bySlot[slot].push(iss.message)
      }
    }
    return bySlot
  }, [compatLinks, compatAttrs, selectedSpec, specSlotMap])

  const saveBuild = async () => {
    if (!isAuthed() || !sessionId) { navigate("/auth"); return }
    setSaving(true)
    const components = (Object.values(selected).filter(Boolean) as SelectedComp[]).map(c => ({
      ...c,
      description: slotExtras[c.slot]?.description || c.description || "",
      image_urls: (slotExtras[c.slot]?.image_urls?.length ? slotExtras[c.slot].image_urls : c.image_urls) || [],
    }))
    const res = await api.auth.saveUserBuild({
      name: buildName, components,
      parts_total: partsTotal, assembly_fee: assemblyFee, total_price: total,
      is_public: isPublic,
      description: buildDescription,
      image_urls: buildImageUrls,
    }, sessionId)
    setSaving(false)
    if (res?.share_token) setSaveResult({ token: res.share_token, code: res.short_code })
  }

  const buildShareUrl = (token: string, code?: string) =>
    code
      ? `${window.location.origin}/s/${code}`
      : user?.is_premium
        ? `${window.location.origin}/user-build/${token}`
        : `${window.location.origin}/configurator?build=${token}`

  const copyLink = () => {
    if (!saveResult) return
    navigator.clipboard.writeText(buildShareUrl(saveResult.token, saveResult.code))
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground" style={{ cursor: "auto" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <NotificationBell />
            {isAuthed() ? (
              <button onClick={() => navigate("/profile")} className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="User" size={15} />
              </button>
            ) : (
              <button onClick={() => navigate("/auth")} className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="LogIn" size={15} />
              </button>
            )}
            <button onClick={() => navigate("/cart")} className="relative flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="ShoppingCart" size={16} />
              <span>Корзина</span>
              {count() > 0 && <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">{count()}</span>}
            </button>
          </div>
        </div>
      </header>

      {/* Табы */}
      <CatalogTabs />

      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-8">
        <div className="mb-4 flex items-start justify-between gap-4 sm:mb-6">
          <div>
            <h1 className="mb-1 hidden text-3xl font-light text-foreground sm:block">Конфигуратор ПК</h1>
            {!buildAuthor && (
              <p className="text-sm text-foreground/60">Выбирайте из каталога или добавляйте своё железо с любого магазина</p>
            )}
          </div>
          {!(buildToken && isReadOnly) && hasComponents && (
            <button onClick={clearAll}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground/60 hover:border-red-400 hover:text-red-400 transition-colors"
              style={{ cursor: "pointer" }}>
              <Icon name="Trash2" size={14} />
              Очистить список
            </button>
          )}
        </div>

        {/* View toggle: подробный (с превью, как в корзине) / компактный.
            На мобилке скрыт — там карточка всегда в своём компактном виде. */}
        {!(buildToken && isReadOnly) && !isMobile && (
        <div className="mb-6 flex flex-wrap items-center justify-start gap-1.5 sm:justify-end">
          <span className="mr-1 text-xs text-foreground/40">Вид:</span>
          <button onClick={() => setViewMode("detailed")} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "detailed" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:text-foreground hover:border-primary/40"}`} style={{ cursor: "pointer" }}>
            <Icon name="LayoutList" size={14} />Подробный
          </button>
          <button onClick={() => setViewMode("compact")} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "compact" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:text-foreground hover:border-primary/40"}`} style={{ cursor: "pointer" }}>
            <Icon name="Menu" size={14} />Компактный
          </button>
        </div>
        )}

        {/* Banner: всё из каталога → предложить сборку */}
        {!(buildToken && isReadOnly) && hasComponents && allFromCatalog && !wantAssembly && (
          <div className="mb-5 flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <Icon name="Sparkles" size={20} className="text-primary shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Всё из нашего каталога!</p>
              <p className="text-xs text-foreground/60">Соберём за вас — 7% от стоимости железа: {fmt(Math.round(partsTotal * 0.07))}</p>
            </div>
            <button onClick={() => setWantAssembly(true)} className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" style={{ cursor: "pointer" }}>Добавить сборку</button>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">

          {/* ── Slots / Read-only view ── */}
          <div className="space-y-3">

            {/* Режим просмотра загруженной сборки */}
            {buildToken && isReadOnly ? (
              <div className="rounded-2xl border border-primary/30 bg-card overflow-hidden">
                {/* Шапка */}
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon name="Cpu" size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{buildName}</p>
                      {buildAuthor && (
                        <p className="text-xs text-foreground/50">Сборка от {buildAuthor.username}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        const url = buildShortCode
                          ? `${window.location.origin}/s/${buildShortCode}`
                          : `${window.location.origin}/configurator?build=${buildToken}`
                        navigator.clipboard.writeText(url)
                        setBuildCopied(true)
                        setTimeout(() => setBuildCopied(false), 2500)
                      }}
                      style={{ cursor: "pointer" }}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
                    >
                      <Icon name={buildCopied ? "Check" : "Copy"} size={13} />
                      {buildCopied ? "Скопировано!" : "Копировать ссылку"}
                    </button>
                    <button
                      onClick={() => {
                        setBuildToken(null)
                        setIsReadOnly(false)
                        navigate("/configurator")
                      }}
                      style={{ cursor: "pointer" }}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <Icon name="Copy" size={13} />
                      Скопировать и редактировать
                    </button>
                  </div>
                </div>

                {/* Список компонентов */}
                <div className="divide-y divide-border/40">
                  {Object.entries(SLOT_LABELS).map(([slot, meta]) => {
                    const c = selected[slot]
                    if (!c) return null
                    return (
                      <div key={slot} className="flex items-center gap-3 px-5 py-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon name={meta.icon as "Cpu"} size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-xs text-foreground/50 leading-none">{meta.label}</p>
                            {c.source === "catalog" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-1.5 py-px text-[10px] font-medium text-green-400">
                                <Icon name="CheckCircle" size={9} />
                                Наш склад
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-foreground leading-snug">
                            {c.name}
                            {c.qty > 1 && <span className="ml-1.5 text-foreground/40 font-normal">×{c.qty}</span>}
                          </p>
                          {c.link && (
                            <a href={c.link} target="_blank" rel="noopener noreferrer"
                              className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              style={{ cursor: "pointer" }}
                            >
                              <Icon name="ExternalLink" size={10} />
                              Ссылка на товар
                            </a>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {c.qty > 1 && (
                            <p className="text-xs text-foreground/40 mb-0.5">{fmt(c.price)} × {c.qty}</p>
                          )}
                          <p className="text-sm font-bold text-primary tabular-nums">{fmt(c.price * c.qty)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Итог */}
                <div className="flex items-center justify-between px-5 py-4 bg-muted/30 border-t border-border/60">
                  <span className="text-sm text-foreground/60">Итого железо</span>
                  <span className="text-lg font-bold text-foreground">{fmt(partsTotal)}</span>
                </div>

                {/* Комментарии */}
                <div className="px-5 pb-5">
                  <CommentSection buildToken={buildToken} highlightId={highlightCommentId} />
                </div>
              </div>
            ) : (
            <>
            {/* Быстрый поиск по всему железу — с выпадающим списком и мгновенным
                выбором (как в админке при создании сборки). */}
            {(() => {
              const allComps = Object.entries(slots).flatMap(([slot, comps]) =>
                comps.map(c => ({ ...c, slot })))
              const q = slotSearch.trim().toLowerCase()
              const results = q.length >= 1
                ? allComps.filter(c => c.name.toLowerCase().includes(q)).slice(0, 12)
                : []
              const safeIdx = Math.min(slotSearchIdx, results.length - 1)
              return (
                <div className="relative">
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 focus-within:border-primary transition-colors">
                    <Icon name="Search" size={15} className="text-foreground/40 shrink-0" />
                    <input
                      ref={slotSearchRef}
                      type="text"
                      value={slotSearch}
                      onChange={e => { setSlotSearch(e.target.value); setSlotSearchIdx(0) }}
                      onKeyDown={e => {
                        if (e.key === "ArrowDown") { e.preventDefault(); setSlotSearchIdx(i => Math.min(i + 1, results.length - 1)) }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setSlotSearchIdx(i => Math.max(i - 1, 0)) }
                        else if (e.key === "Enter") { e.preventDefault(); if (results[safeIdx]) quickPick(results[safeIdx]) }
                        else if (e.key === "Escape") { setSlotSearch(""); setSlotSearchIdx(0) }
                      }}
                      placeholder="Быстрый поиск по железу — выберите деталь сразу..."
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
                      style={{ cursor: "text" }}
                    />
                    {slotSearch && (
                      <button type="button" onClick={() => { setSlotSearch(""); setSlotSearchIdx(0); slotSearchRef.current?.focus() }} className="text-foreground/30 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name="X" size={13} />
                      </button>
                    )}
                  </div>

                  {results.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
                      {results.map((c, i) => {
                        const isAdded = selected[c.slot]?.source_id === c.id
                        const meta = SLOT_LABELS[c.slot]
                        return (
                          <button key={`${c.slot}-${c.id}`} type="button" onClick={() => quickPick(c)}
                            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${i === safeIdx ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}
                            style={{ cursor: "pointer" }}>
                            <Icon name={(meta?.icon as "Cpu") || "Box"} size={15} className="shrink-0 text-foreground/40" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{c.name}</span>
                              {meta && <span className="block text-[11px] text-foreground/40">{meta.label}</span>}
                            </span>
                            <span className="shrink-0 text-xs font-bold text-primary tabular-nums">{c.price ? fmt(c.price) : "—"}</span>
                            {isAdded && <Icon name="Check" size={13} className="shrink-0 text-primary" />}
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

            {loading
              ? [...Array(6)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)
              : Object.entries(SLOT_LABELS).map(([slot, meta]) => {
                const current = selected[slot]

                return (
                  <div key={slot} className={`rounded-xl border bg-card transition-all duration-200 ${current ? "border-primary/40" : "border-border"}`}>

                    {/* Slot header row — вся строка кликабельна, открывает окно выбора */}
                    <div className="flex items-center gap-3 p-4 cursor-pointer rounded-xl hover:bg-muted/20 transition-colors"
                      onClick={() => setPickerSlot(slot)}
                    >
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${current ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/40"}`}>
                        <Icon name={meta.icon as "Cpu"} size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{meta.label}</p>
                        {!current && <p className="text-xs text-foreground/30">{meta.required ? "Обязательный" : "Необязательный"}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {current && (
                          <button onClick={e => { e.stopPropagation(); clearSlot(slot) }} className="text-foreground/25 hover:text-foreground/60 transition-colors" style={{ cursor: "pointer" }}>
                            <Icon name="X" size={14} />
                          </button>
                        )}
                        <span
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${current ? "border-primary/30 text-primary" : "border-border text-foreground/60"}`}
                        >
                          {current ? "Заменить" : "Выбрать"}
                        </span>
                      </div>
                    </div>

                    {/* Selected component: name + link + qty + line total */}
                    {current && (
                      <div className="border-t border-border/40 px-4 pb-4 pt-3">
                        {/* На мобильном: фото на всю ширину с названием поверх (компактнее).
                            На десктопе: фото слева + текст рядом (как было). */}
                        {isMobile ? (
                          <div className="mb-3">
                            {(() => {
                              const inner = current.image_urls?.[0]
                                ? <img src={current.image_urls[0]} alt={current.name} className="h-full w-full object-cover" />
                                : <div className="flex h-full w-full items-center justify-center"><Icon name={meta.icon as "Cpu"} size={40} className="text-foreground/40" /></div>
                              const wrapCls = "relative block h-32 w-full overflow-hidden rounded-lg bg-muted"
                              const overlay = (
                                <>
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                                  <div className="absolute inset-x-0 bottom-0 p-2.5">
                                    <p className="text-[10px] uppercase tracking-wider text-white/60">{meta.label}</p>
                                    <p className="text-sm font-semibold leading-tight text-white line-clamp-2">{current.name}</p>
                                  </div>
                                </>
                              )
                              return current.source === "catalog" && current.source_id ? (
                                <a href={`/product/${current.source_id}`} target="_blank" rel="noopener noreferrer" className={wrapCls} style={{ cursor: "pointer" }}>
                                  {inner}{overlay}
                                </a>
                              ) : (
                                <div className={wrapCls}>{inner}{overlay}</div>
                              )
                            })()}
                            {current.link && (
                              <a href={current.link} target="_blank" rel="noopener noreferrer"
                                className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline" style={{ cursor: "pointer" }}>
                                <Icon name="ExternalLink" size={11} />
                                Ссылка на товар
                              </a>
                            )}
                          </div>
                        ) : (
                        <div className={`flex gap-3 items-center`}>
                          {/* Превью-фото — крупное в подробном (h-40), маленькое в компактном (h-14) */}
                          {(() => {
                            const photoClass = `flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ${viewMode === "detailed" ? "h-40 w-40" : "h-14 w-14"}`
                            const iconSize = viewMode === "detailed" ? 56 : 24
                            const inner = current.image_urls?.[0]
                              ? <img src={current.image_urls[0]} alt={current.name} className="h-full w-full object-contain" />
                              : <Icon name={meta.icon as "Cpu"} size={iconSize} className="text-foreground/40" />
                            return current.source === "catalog" && current.source_id ? (
                              <a href={`/product/${current.source_id}`} target="_blank" rel="noopener noreferrer"
                                title="Открыть товар в новой вкладке"
                                className={`${photoClass} transition-opacity hover:opacity-90`} style={{ cursor: "pointer" }}>
                                {inner}
                              </a>
                            ) : (
                              <div className={photoClass}>{inner}</div>
                            )
                          })()}
                          {/* Name + type + description + link */}
                          <div className={`min-w-0 flex-1 ${viewMode === "detailed" ? "text-center" : ""}`}>
                            <p className={`text-sm font-medium text-foreground leading-tight ${viewMode === "detailed" ? "" : "truncate"}`}>{current.name}</p>
                            <p className="mt-0.5 text-xs text-foreground/40">{meta.label}</p>
                            {viewMode === "detailed" && current.description && (
                              <p className="mt-1 text-xs leading-snug text-foreground/50 line-clamp-3">
                                {current.description.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()}
                              </p>
                            )}
                            {current.link && (
                              <a href={current.link} target="_blank" rel="noopener noreferrer"
                                className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                style={{ cursor: "pointer" }}
                              >
                                <Icon name="ExternalLink" size={11} />
                                Ссылка на товар
                              </a>
                            )}
                          </div>
                        </div>
                        )}

                        {/* Price → qty controls → line total + предупреждения.
                            Общий блок для мобильного и десктопа.
                            На десктопе предупреждения стоят в один ряд с ценой;
                            на мобильных — переносятся под кол-во и ценник, по правому краю. */}
                        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                          {/* Предупреждения: на десктопе слева от цены (order меняем флексом),
                              на мобильных — ниже цены (порядок DOM сохраняем, но визуально вниз) */}
                          <div className="order-2 flex flex-col items-end gap-1.5 sm:order-1 sm:flex-row sm:items-center">
                            {/* Критичные проблемы (рыжие) складываем в один список:
                                при нескольких — счётчик «Проблемы: N». Совет (БП) — отдельно. */}
                            {(() => {
                              const problems: string[] = [
                                ...(slot === "storage" && ssdSlotWarning
                                  ? [`На материнской плате ${ssdSlotWarning.slots} ${plural(ssdSlotWarning.slots, "слот", "слота", "слотов")} M.2, вы поставили ${ssdSlotWarning.qty}. Уменьшите на ${ssdSlotWarning.over}.`]
                                  : []),
                                ...(compatWarningsBySlot[slot] || []),
                              ]
                              return <CompatWarning texts={problems} />
                            })()}
                            {slot === "psu" && psuWarning && (
                              <CompatWarning severity="advice" texts={[`Блок питания на ${psuWarning.watt} Вт справится: ваша сборка под нагрузкой потребляет около ${psuWarning.totalTdp} Вт. Но запас небольшой — для тихой работы и апгрейда в будущем советуем взять блок питания от ${psuWarning.recommended} Вт.`]} />
                            )}
                          </div>
                          {/* Цена / кол-во / итог */}
                          <div className="order-1 flex items-center gap-3 sm:order-2">
                            <span className="text-xs text-foreground/50">{fmt(current.price)}</span>
                            <QtyControl qty={current.qty} onChange={q => updateQty(slot, q)} />
                            <span className="w-24 text-right text-sm font-bold text-primary">
                              {fmt(current.price * current.qty)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Премиум: фото и описание компонента */}
                    {current && user?.is_premium && (
                      <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">
                        <div className="flex items-center gap-1.5">
                          <Icon name="Star" size={12} className="text-primary" />
                          <span className="text-xs font-medium text-primary">Фото и описание компонента</span>
                        </div>
                        <ImageUploader
                          images={slotExtras[slot]?.image_urls || []}
                          onChange={urls => setSlotExtras(e => ({ ...e, [slot]: { ...e[slot] || { description: "" }, image_urls: urls } }))}
                          folder="builds"
                          maxImages={3}
                        />
                        <RichTextEditor
                          value={slotExtras[slot]?.description || ""}
                          onChange={val => setSlotExtras(e => ({ ...e, [slot]: { ...e[slot] || { image_urls: [] }, description: val } }))}
                          placeholder="Описание компонента..."
                        />
                      </div>
                    )}

                  </div>
                )
              })
            }

            {/* ── Прочее: свои позиции + кастомные кабели ── */}
            <ExtrasSection extraItems={extraItems} onRemoveExtra={removeExtra} onAddCustom={() => setPickerSlot("extra")} />
            </>
            )}
          </div>

          {/* ── Summary panel ── */}
          <div className="space-y-4 lg:sticky lg:top-24 h-fit">

            {/* Author card */}
            {buildAuthor && isReadOnly && (
              <button
                onClick={() => buildAuthor.tag ? navigate(`/profile/${buildAuthor.tag}`) : undefined}
                className="w-full flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 hover:border-primary transition-colors"
                style={{ cursor: buildAuthor.tag ? "pointer" : "default" }}
              >
                {buildAuthor.avatar ? (
                  <img src={buildAuthor.avatar} alt={buildAuthor.username} className="h-28 w-28 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-full bg-primary/20 text-5xl font-medium text-primary shrink-0">
                    {buildAuthor.username[0]?.toUpperCase()}
                  </div>
                )}
                <div className="text-left">
                  <p className="text-xs text-foreground/50 mb-0.5">Сборка от</p>
                  <p className="text-base font-semibold text-foreground">{buildAuthor.username}</p>
                  {buildAuthor.tag && <p className="text-xs text-foreground/40">@{buildAuthor.tag}</p>}
                </div>
              </button>
            )}

            {/* Totals card */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-base font-medium text-foreground">Итого</h2>

              <div className="mb-4 space-y-2">
                {Object.entries(SLOT_LABELS).map(([slot, meta]) => {
                  const c = selected[slot]
                  return (
                    <div key={slot} className="flex items-center justify-between text-sm">
                      <span className="text-foreground/50 truncate">{meta.label}</span>
                      <span className={`ml-2 shrink-0 ${c ? "font-medium text-foreground" : "text-foreground/20"}`}>
                        {c ? fmt(c.price * c.qty) : "—"}
                        {c && c.qty > 1 && <span className="ml-1 text-xs text-foreground/40">×{c.qty}</span>}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Assembly toggle */}
              <div className="mb-4 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Профессиональная сборка BeGraphics</p>
                    <p className="text-xs text-foreground/50">7% от стоимости железа</p>
                  </div>
                  <button
                    onClick={() => setWantAssembly(w => !w)}
                    className={`relative h-6 w-11 rounded-full transition-colors ${wantAssembly ? "bg-primary" : "bg-muted"}`}
                    style={{ cursor: "pointer" }}
                  >
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${wantAssembly ? "left-6" : "left-1"}`} />
                  </button>
                </div>
                {wantAssembly && partsTotal > 0 && (
                  <p className="mt-1 text-right text-xs text-primary">+ {fmt(assemblyFee)}</p>
                )}
              </div>

              <div className="mb-5 flex items-center justify-between border-t border-border pt-4">
                <span className="text-foreground/70">Итого:</span>
                <span className="text-2xl font-bold text-foreground">{fmt(total)}</span>
              </div>

              {!isComplete && hasComponents && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
                  <span>Не выбраны: {missingRequired.join(", ")}. Можно оформить как есть — часть железа может быть вашей.</span>
                </div>
              )}
              <button
                onClick={addToCart}
                disabled={!hasComponents}
                className="btn-tilt w-full rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                style={{ cursor: hasComponents ? "pointer" : "not-allowed" }}
              >
                {hasComponents ? "Оформить заказ" : "Добавьте компоненты"}
              </button>
              {catalogPicked > 0 && (
                <button
                  onClick={addAllProductsToCart}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                  style={{ cursor: "pointer" }}
                >
                  <Icon name="ShoppingCart" size={15} />
                  Добавить все товары в корзину ({catalogPicked})
                </button>
              )}
              <p className="mt-2 text-center text-xs text-foreground/40">Менеджер свяжется для подтверждения</p>
            </div>

            {/* Save & Share card */}
            {!(buildToken && isReadOnly) && (
            <div className="rounded-xl border border-border bg-card p-5">
              <button
                onClick={() => setShowSavePanel(v => !v)}
                className="flex w-full items-center justify-between"
                style={{ cursor: "pointer" }}
              >
                <div className="flex items-center gap-2">
                  <Icon name="Save" size={16} className="text-foreground/60" />
                  <span className="text-sm font-medium text-foreground">Сохранить и поделиться</span>
                </div>
                <Icon name={showSavePanel ? "ChevronUp" : "ChevronDown"} size={16} className="text-foreground/40" />
              </button>

              {showSavePanel && (
                <div className="mt-4 space-y-3">
                  {saveResult ? (
                    /* После сохранения */
                    <>
                      <div className="flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2.5">
                        <Icon name="CheckCircle" size={15} className="text-green-400 shrink-0" />
                        <p className="text-xs text-green-400 font-medium">Сборка сохранена!</p>
                      </div>

                      <button
                        onClick={copyLink}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors"
                        style={{ cursor: "pointer" }}
                      >
                        <Icon name={copied ? "Check" : "Link"} size={15} />
                        {copied ? "Ссылка скопирована!" : "Скопировать ссылку"}
                      </button>

                      <button
                        onClick={() => {
                          const url = buildShareUrl(saveResult.token, saveResult.code)
                          const text = `Смотри мою сборку на PCPRO: ${url}`
                          if (navigator.share) {
                            navigator.share({ title: buildName, text, url })
                          } else {
                            navigator.clipboard.writeText(text)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 2500)
                          }
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary/10 border border-primary/20 py-2.5 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
                        style={{ cursor: "pointer" }}
                      >
                        <Icon name="Share2" size={15} />
                        Поделиться
                      </button>

                      {user?.is_premium && (
                        <button
                          onClick={() => navigate(`/user-build/${saveResult.token}`)}
                          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors"
                          style={{ cursor: "pointer" }}
                        >
                          <Icon name="ExternalLink" size={15} />
                          Открыть страницу сборки
                        </button>
                      )}

                      <button
                        onClick={() => { setSaveResult(null) }}
                        className="w-full text-center text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
                        style={{ cursor: "pointer" }}
                      >
                        Сохранить ещё раз с другим названием
                      </button>
                    </>
                  ) : (
                    /* Форма сохранения */
                    <>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/50">Название сборки</label>
                        <input
                          type="text"
                          value={buildName}
                          onChange={e => setBuildName(e.target.value)}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                          placeholder="Например: Игровой монстр 2024"
                          style={{ cursor: "text" }}
                        />
                      </div>

                      <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground/60">
                        <input
                          type="checkbox"
                          checked={isPublic}
                          onChange={e => setIsPublic(e.target.checked)}
                          className="rounded border-border"
                        />
                        Показывать в сборках сообщества
                      </label>

                      {/* Премиум: описание и фото сборки */}
                      {user?.is_premium ? (
                        <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                          <div className="flex items-center gap-1.5">
                            <Icon name="Star" size={13} className="text-primary" />
                            <span className="text-xs font-medium text-primary">Премиум возможности</span>
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs text-foreground/50">Фото сборки (до 3 шт.)</label>
                            <ImageUploader
                              images={buildImageUrls}
                              onChange={setBuildImageUrls}
                              folder="builds"
                              maxImages={3}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs text-foreground/50">Описание сборки</label>
                            <RichTextEditor
                              value={buildDescription}
                              onChange={setBuildDescription}
                              placeholder="Расскажите про свою сборку..."
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                          <Icon name="Star" size={13} className="text-foreground/30" />
                          <p className="text-xs text-foreground/40">Описание и фото — только для премиум</p>
                        </div>
                      )}

                      <button
                        onClick={saveBuild}
                        disabled={saving || !hasComponents}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                        style={{ cursor: hasComponents ? "pointer" : "not-allowed" }}
                      >
                        <Icon name="Save" size={15} />
                        {saving ? "Сохранение..." : isAuthed() ? "Сохранить" : "Войдите для сохранения"}
                      </button>

                      {!isAuthed() && (
                        <button
                          onClick={() => navigate("/auth")}
                          className="w-full text-center text-xs text-primary hover:underline"
                          style={{ cursor: "pointer" }}
                        >
                          Войти / Зарегистрироваться →
                        </button>
                      )}

                      {!hasComponents && (
                        <p className="text-center text-xs text-foreground/40">Добавьте компоненты для сохранения</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            )}

            {/* ── Кастомные кабели ── */}
            {!(buildToken && isReadOnly) && <button
              onClick={() => navigate("/cables")}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors group"
              style={{ cursor: "pointer" }}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon name="Cable" size={16} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Кастомные кабели</p>
                  <p className="text-xs text-foreground/50">C-Cables · настрой цвет и разъёмы</p>
                </div>
              </div>
              <Icon name="ArrowRight" size={16} className="text-foreground/30 group-hover:text-primary transition-colors" />
            </button>}

          </div>
        </div>
      </div>

      {/* Окно выбора с фильтрами совместимости */}
      {pickerSlot && (
        <SlotPickerModal
          slotCode={pickerSlot}
          slotLabel={pickerSlot === "extra" ? "Своя позиция" : (SLOT_LABELS[pickerSlot]?.label || pickerSlot)}
          selectedSpec={selectedSpec}
          selectedQty={selectedQty}
          onPick={pickFromPicker(pickerSlot)}
          onClose={() => setPickerSlot(null)}
          onCustomAdd={addCustomFromPicker(pickerSlot)}
          startCustom={pickerSlot === "extra"}
          hideCatalogToggle={pickerSlot === "extra"}
        />
      )}
    </div>
  )
}