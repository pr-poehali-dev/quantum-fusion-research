import { useState, useEffect, useRef } from "react"
import { useCart, CartItem } from "@/store/cart"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { useNavigate, useSearchParams } from "react-router-dom"
import RichTextEditor from "@/components/ui/rich-text-editor"
import { ImageUploader } from "@/components/image-uploader"
import CommentSection from "@/components/CommentSection"
import NotificationBell from "@/components/NotificationBell"


const SLOT_LABELS: Record<string, { label: string; icon: string; required: boolean }> = {
  cpu:         { label: "Процессор",             icon: "Cpu",        required: true  },
  motherboard: { label: "Материнская плата",     icon: "CircuitBoard",required: false },
  gpu:         { label: "Видеокарта",            icon: "Monitor",    required: true  },
  ram:         { label: "Оперативная память",    icon: "MemoryStick",required: true  },
  storage:     { label: "Накопитель",            icon: "HardDrive",  required: true  },
  cooling:     { label: "Система охлаждения",    icon: "Wind",       required: false },
  psu:         { label: "Блок питания",          icon: "Zap",        required: true  },
  case:        { label: "Корпус",                icon: "Box",        required: false },
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
}
function loadDraft(): Partial<ConfigDraft> {
  // Не восстанавливаем черновик, если открыта чужая/конкретная сборка по ссылке
  if (new URLSearchParams(window.location.search).get("build")) return {}
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") } catch { return {} }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* noop */ }
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

function ExtrasSection() {
  const { items, removeItem } = useCart()
  const navigate = useNavigate()

  const cableItems = items.filter((i: CartItem) => i.type === "config" && i.name.startsWith("Кастомные кабели"))

  return (
    <div className={`rounded-xl border bg-card transition-all duration-200 ${cableItems.length > 0 ? "border-primary/40" : "border-border"}`}>
      <div className="flex items-center gap-3 p-4">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cableItems.length > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/40"}`}>
          <Icon name="Cable" size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Прочее</p>
          {cableItems.length === 0 && <p className="text-xs text-foreground/30">Кастомные кабели и другие аксессуары</p>}
        </div>
        <button onClick={() => navigate("/cables")}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-primary transition-colors"
          style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={13} />
          Добавить кабели
        </button>
      </div>

      {cableItems.length > 0 && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-2">
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
  const [mode, setMode] = useState<"catalog" | "custom">("catalog")
  const [slotMode, setSlotMode] = useState<Record<string, "catalog" | "custom">>({})
  const [openSlot, setOpenSlot] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [wantAssembly, setWantAssembly] = useState(draft0.wantAssembly ?? true)

  // Сохранение / шеринг
  const [buildName, setBuildName] = useState(draft0.buildName || "Моя сборка")
  const [isPublic, setIsPublic] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [showSavePanel, setShowSavePanel] = useState(false)

  const [buildAuthor, setBuildAuthor] = useState<{ username: string; avatar: string; tag: string } | null>(null)
  const [buildDescription, setBuildDescription] = useState("")
  const [buildImageUrls, setBuildImageUrls] = useState<string[]>([])
  const [slotExtras, setSlotExtras] = useState<Record<string, SlotExtra>>(draft0.slotExtras || {})
  const [slotSearch, setSlotSearch] = useState("")
  const slotSearchRef = useRef<HTMLInputElement>(null)

  const { addItem, count } = useCart()
  const { isAuthed, sessionId, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [buildToken, setBuildToken] = useState<string | null>(null)
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

    // Загрузка сборки по токену из URL
    const token = searchParams.get("build")
    const editMode = searchParams.get("edit") === "1"
    if (token) {
      setBuildToken(editMode ? null : token)
      setIsReadOnly(!editMode)
      api.auth.getBuildByToken(token).then(b => {
        if (b?.components) {
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
          if (b.username) {
            setBuildAuthor({ username: b.username, avatar: b.author_avatar || "", tag: b.author_tag || "" })
          }
        }
      }).catch(() => {})
    }
  }, [])

  // Автосохранение черновика в браузер (кроме режима просмотра чужой сборки)
  useEffect(() => {
    if (isReadOnly) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ selected, customInputs, slotExtras, wantAssembly, buildName }))
    } catch { /* noop */ }
  }, [selected, customInputs, slotExtras, wantAssembly, buildName, isReadOnly])

  const partsTotal = Object.values(selected).reduce((sum, c) => sum + (c ? c.price * c.qty : 0), 0)
  const assemblyFee = wantAssembly ? Math.round(partsTotal * 0.07) : 0
  const total = partsTotal + assemblyFee
  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const requiredSlots = Object.entries(SLOT_LABELS).filter(([, v]) => v.required).map(([k]) => k)
  const isComplete = requiredSlots.every(slot => selected[slot])
  const allFromCatalog = Object.values(selected).filter(Boolean).every(c => c?.source === "catalog")
  const hasComponents = Object.values(selected).some(Boolean)

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

  const selectFromCatalog = (slot: string, comp: CatalogComp) => {
    setSelected(s => ({ ...s, [slot]: { slot, name: comp.name, price: comp.price, qty: 1, source: "catalog", source_id: comp.id } }))
    setOpenSlot(null)
  }

  const applyCustom = (slot: string) => {
    const inp = customInputs[slot]
    if (!inp?.name || !inp?.price) return
    setSelected(s => ({ ...s, [slot]: { slot, name: inp.name, price: parseFloat(inp.price) || 0, qty: 1, link: inp.link || undefined, source: "custom" } }))
    setSlotExtras(e => ({ ...e, [slot]: { description: inp.description || "", image_urls: inp.image_urls || [] } }))
    setOpenSlot(null)
  }

  const updateQty = (slot: string, qty: number) => {
    setSelected(s => s[slot] ? { ...s, [slot]: { ...s[slot]!, qty } } : s)
  }

  const saveBuild = async () => {
    if (!isAuthed() || !sessionId) { navigate("/auth"); return }
    setSaving(true)
    const components = (Object.values(selected).filter(Boolean) as SelectedComp[]).map(c => ({
      ...c,
      description: slotExtras[c.slot]?.description || "",
      image_urls: slotExtras[c.slot]?.image_urls || [],
    }))
    const res = await api.auth.saveUserBuild({
      name: buildName, components,
      parts_total: partsTotal, assembly_fee: assemblyFee, total_price: total,
      is_public: isPublic,
      description: buildDescription,
      image_urls: buildImageUrls,
    }, sessionId)
    setSaving(false)
    if (res?.share_token) setSaveResult({ token: res.share_token })
  }

  const buildShareUrl = (token: string) =>
    user?.is_premium
      ? `${window.location.origin}/user-build/${token}`
      : `${window.location.origin}/configurator?build=${token}`

  const copyLink = () => {
    if (!saveResult) return
    navigator.clipboard.writeText(buildShareUrl(saveResult.token))
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
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
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-7xl gap-0 px-6 overflow-x-auto items-stretch">
          <button onClick={() => navigate("/shop")} className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Package" size={15} />
            Каталог товаров
          </button>
          <button onClick={() => navigate("/builds")} className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Monitor" size={15} />
            Наши ПК
          </button>
          <div className="mx-3 my-3 w-px bg-border shrink-0" />
          <button className="flex shrink-0 items-center gap-2 border-b-2 border-primary px-5 py-3 text-sm font-medium text-primary transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Cpu" size={15} />
            Конфигуратор
          </button>
          <button onClick={() => navigate("/community-builds")} className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-medium text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Users" size={15} />
            Сборки сообщества
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="mb-1 text-3xl font-light text-foreground">Конфигуратор ПК</h1>
          {!buildAuthor && (
            <p className="text-sm text-foreground/60">Выбирайте из каталога или добавляйте своё железо с любого магазина</p>
          )}
        </div>

        {/* Mode toggle */}
        {!(buildToken && isReadOnly) && (
        <div className="mb-6 flex overflow-hidden rounded-xl border border-border">
          <button onClick={() => setMode("catalog")} className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${mode === "catalog" ? "bg-primary text-primary-foreground" : "bg-card text-foreground/70 hover:text-foreground"}`} style={{ cursor: "pointer" }}>
            <Icon name="ShoppingBag" size={16} />Из нашего каталога
          </button>
          <button onClick={() => setMode("custom")} className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${mode === "custom" ? "bg-primary text-primary-foreground" : "bg-card text-foreground/70 hover:text-foreground"}`} style={{ cursor: "pointer" }}>
            <Icon name="PenLine" size={16} />Своё железо
          </button>
        </div>
        )}

        {/* Banner: всё из каталога → предложить сборку */}
        {!(buildToken && isReadOnly) && mode === "custom" && hasComponents && allFromCatalog && (
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
                        const url = `${window.location.origin}/configurator?build=${buildToken}`
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
            {/* Поиск по компонентам */}
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 focus-within:border-primary transition-colors">
              <Icon name="Search" size={15} className="text-foreground/40 shrink-0" />
              <input
                ref={slotSearchRef}
                type="text"
                value={slotSearch}
                onChange={e => setSlotSearch(e.target.value)}
                onKeyDown={e => { if (e.key === "Escape") setSlotSearch("") }}
                placeholder="Поиск по компонентам..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
                style={{ cursor: "text" }}
              />
              {slotSearch && (
                <button type="button" onClick={() => { setSlotSearch(""); slotSearchRef.current?.focus() }} className="text-foreground/30 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                  <Icon name="X" size={13} />
                </button>
              )}
            </div>

            {loading
              ? [...Array(6)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)
              : Object.entries(SLOT_LABELS).map(([slot, meta]) => {
                const options = (slots[slot] || []).filter(o =>
                  !slotSearch || o.name.toLowerCase().includes(slotSearch.toLowerCase())
                )
                const current = selected[slot]
                const isOpen = openSlot === slot || (!!slotSearch && options.length > 0)
                const ci = customInputs[slot] || { name: "", price: "", link: "", description: "", image_urls: [] }

                // Скрываем слот если поиск активен и нет совпадений (и ничего не выбрано)
                if (slotSearch && options.length === 0 && !current) return null

                return (
                  <div key={slot} className={`rounded-xl border bg-card transition-all duration-200 ${current ? "border-primary/40" : "border-border"}`}>

                    {/* Slot header row */}
                    <div className="flex items-center gap-3 p-4">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${current ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/40"}`}>
                        <Icon name={meta.icon as "Cpu"} size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{meta.label}</p>
                        {!current && <p className="text-xs text-foreground/30">{meta.required ? "Обязательный" : "Необязательный"}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {current && (
                          <button onClick={() => setSelected(s => ({ ...s, [slot]: null }))} className="text-foreground/25 hover:text-foreground/60 transition-colors" style={{ cursor: "pointer" }}>
                            <Icon name="X" size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => setOpenSlot(isOpen ? null : slot)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${current ? "border-primary/30 text-primary hover:bg-primary/10" : "border-border text-foreground/60 hover:border-primary hover:text-foreground"}`}
                          style={{ cursor: "pointer" }}
                        >
                          {current ? "Заменить" : "Выбрать"}
                        </button>
                      </div>
                    </div>

                    {/* Selected component: name + link + qty + line total */}
                    {current && (
                      <div className="border-t border-border/40 px-4 pb-4 pt-3">
                        <div className="flex items-start gap-3">
                          {/* Name + link */}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground leading-tight">{current.name}</p>
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

                          {/* Price → qty controls → line total */}
                          <div className="flex shrink-0 items-center gap-3">
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

                    {/* Picker panel */}
                    {isOpen && (() => {
                      const effMode = slotMode[slot] ?? mode
                      return (
                      <div className="border-t border-border p-4">
                        {/* Локальный переключатель: каталог / своё железо для этого слота */}
                        <div className="mb-3 flex overflow-hidden rounded-lg border border-border text-xs">
                          <button onClick={() => setSlotMode(m => ({ ...m, [slot]: "catalog" }))}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 font-medium transition-colors ${effMode === "catalog" ? "bg-primary text-primary-foreground" : "bg-card text-foreground/60 hover:text-foreground"}`}
                            style={{ cursor: "pointer" }}>
                            <Icon name="ShoppingBag" size={13} />Каталог
                          </button>
                          <button onClick={() => setSlotMode(m => ({ ...m, [slot]: "custom" }))}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 font-medium transition-colors ${effMode === "custom" ? "bg-primary text-primary-foreground" : "bg-card text-foreground/60 hover:text-foreground"}`}
                            style={{ cursor: "pointer" }}>
                            <Icon name="PenLine" size={13} />Своё железо
                          </button>
                        </div>
                        {effMode === "catalog" ? (
                          options.length === 0
                            ? <p className="py-3 text-center text-xs text-foreground/40">Нет компонентов в каталоге</p>
                            : (
                              <div className="grid gap-2 sm:grid-cols-2">
                                {options.map(opt => (
                                  <button key={opt.id} onClick={() => selectFromCatalog(slot, opt)}
                                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left hover:border-primary transition-colors"
                                    style={{ cursor: "pointer" }}
                                  >
                                    <div className="min-w-0 mr-2">
                                      <p className="text-xs font-medium text-foreground truncate">{opt.name}</p>
                                      {opt.brand && <p className="text-xs text-foreground/40">{opt.brand}</p>}
                                      {Object.keys(opt.specs).length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          {Object.values(opt.specs).slice(0, 2).map((v, i) => (
                                            <span key={i} className="rounded bg-muted px-1 py-px text-xs text-foreground/50">{v}</span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <p className="shrink-0 text-xs font-bold text-accent">{fmt(opt.price)}</p>
                                  </button>
                                ))}
                              </div>
                            )
                        ) : (
                          /* Custom input */
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <input type="text" placeholder="Название компонента"
                                value={ci.name}
                                onChange={e => setCustomInputs(c => ({ ...c, [slot]: { ...ci, name: e.target.value } }))}
                                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                                style={{ cursor: "text" }}
                              />
                              <input type="number" placeholder="Цена ₽"
                                value={ci.price}
                                onChange={e => setCustomInputs(c => ({ ...c, [slot]: { ...ci, price: e.target.value } }))}
                                className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                                style={{ cursor: "text" }}
                              />
                            </div>
                            <input type="url" placeholder="Ссылка на товар (необязательно)"
                              value={ci.link}
                              onChange={e => setCustomInputs(c => ({ ...c, [slot]: { ...ci, link: e.target.value } }))}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                              style={{ cursor: "text" }}
                            />
                            <div>
                              <p className="mb-1.5 text-xs text-foreground/40">Фото (до 3 шт., необязательно)</p>
                              <ImageUploader
                                images={ci.image_urls}
                                onChange={urls => setCustomInputs(c => ({ ...c, [slot]: { ...ci, image_urls: urls } }))}
                                folder="builds"
                                maxImages={3}
                              />
                            </div>
                            <div>
                              <p className="mb-1.5 text-xs text-foreground/40">Описание (необязательно)</p>
                              <RichTextEditor
                                value={ci.description}
                                onChange={val => setCustomInputs(c => ({ ...c, [slot]: { ...ci, description: val } }))}
                                placeholder="Описание компонента..."
                              />
                            </div>
                            <button onClick={() => applyCustom(slot)}
                              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                              style={{ cursor: "pointer" }}
                            >
                              Применить
                            </button>
                          </div>
                        )}
                      </div>
                      )
                    })()}
                  </div>
                )
              })
            }

            {/* ── Прочее: кастомные кабели ── */}
            <ExtrasSection />
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
                    <p className="text-sm font-medium text-foreground">Сборка PCPRO</p>
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

              <button
                onClick={addToCart}
                disabled={!isComplete}
                className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                style={{ cursor: isComplete ? "pointer" : "not-allowed" }}
              >
                {isComplete ? "Оформить заказ" : "Выберите обязательные компоненты"}
              </button>
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
                          const url = buildShareUrl(saveResult.token)
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
    </div>
  )
}