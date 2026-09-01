import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { createPortal } from "react-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import Seo, { SITE_URL, SITE_NAME } from "@/components/Seo"
import CommentSection from "@/components/CommentSection"
import { useAuth } from "@/store/auth"
import { isAdminAuthed } from "@/components/admin/AdminGuard"
import ArticleChart from "@/components/article/ArticleChart"
import { ChartConfig, parseChartConfig } from "@/lib/chartTypes"

interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  image_urls?: string[]
  category: string
  categories?: string[]
  content: string
  html_attachment: string | null
  is_published?: boolean
  views: number
  created_at: string
  toc?: TocItem[]
  tier_cards?: TierCard[]
  // SEO-поля из админки (вкладка «SEO»).
  meta_title?: string | null
  meta_description?: string | null
  // Блок «вопрос-ответ» — источник разметки FAQPage для поисковиков и ИИ.
  faq?: { q: string; a: string }[]
}

interface TocItem { title: string; anchor: string }
interface TierCard { title: string; image_url: string; rank: string | null; product_id?: number; anchor?: string }

// Ряды тир-листа статьи (как на /tier-lists)
const TIER_ROWS: Array<{ rank: string; color: string }> = [
  { rank: "S", color: "#ef4444" },
  { rank: "A", color: "#f97316" },
  { rank: "B", color: "#eab308" },
  { rank: "C", color: "#22c55e" },
  { rank: "D", color: "#3b82f6" },
  { rank: "F", color: "#a855f7" },
]

// Одна карточка тир-листа в статье
function ArticleTierCardCell({ c, gi, isAdmin, dragOver, onActivate, onDragStart, onDragEnd, onDragOver, onDrop }: {
  c: TierCard; gi: number; isAdmin: boolean; dragOver: boolean
  onActivate: (c: TierCard) => void
  onDragStart: (gi: number) => void; onDragEnd: () => void
  onDragOver: (gi: number) => void; onDrop: (gi: number) => void
}) {
  const inner = (
    <>
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        {c.image_url
          ? <img src={c.image_url} alt={c.title} draggable={false} className="h-full w-full object-cover" />
          : <div className="flex h-full w-full items-center justify-center"><Icon name="Image" size={22} className="text-foreground/30" /></div>}
        {c.title && (
          <div className="pointer-events-none absolute inset-0 z-20 hidden flex-col items-center justify-center gap-1.5 bg-background/85 px-2.5 text-center opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 sm:flex">
            <p className="text-sm font-semibold leading-snug text-foreground">{c.title}</p>
            {c.anchor && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                <Icon name="ArrowDownToLine" size={11} /> Перейти к разбору
              </span>
            )}
          </div>
        )}
      </div>
      {/* «Борода» — название под фото, всегда видна на телефоне. */}
      {c.title && (
        <div className="flex min-h-[2.25rem] items-center justify-center border-t border-border/60 bg-card px-1.5 py-1 sm:hidden">
          <p className="line-clamp-2 text-center text-[11px] font-medium leading-tight text-foreground">{c.title}</p>
        </div>
      )}
    </>
  )
  const cls = "tier-card group relative flex w-32 flex-col overflow-hidden rounded-xl border border-border bg-muted transition-transform hover:scale-[1.03] sm:w-44 cursor-pointer"
  const style = { scrollMarginTop: 90 }
  // id карточки в блоке тир-листа. ОТЛИЧАЕТСЯ от текстовой метки toc-tier-card-N,
  // иначе getElementById находил бы карточку вместо метки в тексте.
  const aid = `tierblock-card-${gi}`
  return (
    <div className="relative flex shrink-0 items-stretch">
      {/* Полоса-индикатор вставки (только для админа при перетаскивании) */}
      {isAdmin && <div className={`mr-1 w-1 self-stretch rounded-full transition-all ${dragOver ? "bg-primary" : "bg-transparent"}`} />}
      <div
        id={aid}
        draggable={isAdmin}
        onDragStart={e => { if (isAdmin) { onDragStart(gi); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(gi)) } }}
        onDragEnd={onDragEnd}
        onDragOver={e => { if (isAdmin) { e.preventDefault(); onDragOver(gi) } }}
        onDrop={e => { if (isAdmin) { e.preventDefault(); e.stopPropagation(); onDrop(gi) } }}
        onClick={() => onActivate(c)}
        className={cls + (isAdmin ? " active:cursor-grabbing" : "")}
        style={style}
      >
        {inner}
      </div>
    </div>
  )
}

// Блок тир-листа внутри статьи. Все ряды S/A/B/C/D/F + «Без оценки».
// Для админа — drag&drop карточек по рядам с сохранением. Клик по карточке
// (для всех) ведёт к её якорю в тексте, если он задан.
function ArticleTierList({ cards, isAdmin, onReorder }: {
  cards: TierCard[]; isAdmin: boolean; onReorder: (next: TierCard[]) => void
}) {
  const [dragGi, setDragGi] = useState<number | null>(null)
  const [dragOverGi, setDragOverGi] = useState<number | null>(null)
  if (!cards.length) return null

  // Клик по карточке: ведём к её якорю в тексте. Приоритет:
  // 1) собственный anchor карточки; 2) метка [[#tier-card-N]] по индексу в тексте;
  // 3) для гостя без меток и с товаром — открыть товар.
  const activate = (c: TierCard) => {
    const idx = cards.indexOf(c)
    const ownAnchor = c.anchor && document.getElementById(`toc-${c.anchor}`)
    if (ownAnchor) { goToAnchor(c.anchor!); return }
    const byIndex = document.getElementById(`toc-tier-card-${idx}`)
    if (byIndex) { goToAnchor(`tier-card-${idx}`); return }
    if (!isAdmin && c.product_id) window.location.href = `/product/${c.product_id}`
  }

  // Переместить карточку gi в ряд rank, перед карточкой beforeGi (или в конец).
  // Работаем по индексам исходного массива cards.
  const moveToRank = (gi: number, rank: string | null, beforeGi: number | null) => {
    const moving = { ...cards[gi], rank }
    // массив без перемещаемой карточки (с сохранением индексов через объекты)
    const rest = cards.filter((_, i) => i !== gi)
    let insertAt = rest.length
    if (beforeGi != null && beforeGi !== gi) {
      const beforeCard = cards[beforeGi]
      const idx = rest.indexOf(beforeCard)
      if (idx >= 0) insertAt = idx
    }
    rest.splice(insertAt, 0, moving)
    onReorder(rest)
    setDragGi(null); setDragOverGi(null)
  }

  const onDropRow = (rank: string | null) => {
    if (dragGi != null) moveToRank(dragGi, rank, null)
  }
  const onDropCard = (overGi: number) => {
    if (dragGi != null && dragGi !== overGi) moveToRank(dragGi, cards[overGi].rank, overGi)
  }

  const cellProps = (c: TierCard) => ({
    c, gi: cards.indexOf(c), isAdmin,
    dragOver: dragOverGi === cards.indexOf(c) && dragGi != null && dragGi !== cards.indexOf(c),
    onActivate: activate,
    onDragStart: setDragGi, onDragEnd: () => { setDragGi(null); setDragOverGi(null) },
    onDragOver: setDragOverGi, onDrop: onDropCard,
  })

  const unranked = cards.filter(c => !c.rank || !TIER_ROWS.some(t => t.rank === c.rank))

  return (
    <div id="toc-__tierlist__" className="my-8 overflow-hidden rounded-2xl border border-border" style={{ scrollMarginTop: 90 }}>
      {isAdmin && (
        <div className="flex items-center gap-1.5 border-b border-border bg-primary/5 px-3 py-1.5 text-xs text-primary">
          <Icon name="Info" size={12} /> Режим редактирования: перетаскивайте карточки между рядами — расстановка сохранится автоматически.
        </div>
      )}
      {TIER_ROWS.map((t, idx) => (
        <div key={t.rank}
          onDragOver={e => { if (isAdmin) e.preventDefault() }}
          onDrop={() => { if (isAdmin) onDropRow(t.rank) }}
          className={`flex items-stretch ${idx > 0 ? "border-t border-border" : ""}`}>
          <div className="flex w-14 shrink-0 items-center justify-center sm:w-16" style={{ backgroundColor: t.color }}>
            <span className="text-2xl font-black text-white drop-shadow">{t.rank}</span>
          </div>
          <div className="flex min-h-[6rem] flex-1 flex-wrap content-start gap-2 bg-card/40 p-3">
            {cards.filter(c => c.rank === t.rank).map(c => <ArticleTierCardCell key={cards.indexOf(c)} {...cellProps(c)} />)}
          </div>
        </div>
      ))}
      {(unranked.length > 0 || isAdmin) && (
        <div
          onDragOver={e => { if (isAdmin) e.preventDefault() }}
          onDrop={() => { if (isAdmin) onDropRow(null) }}
          className="flex items-stretch border-t border-border">
          <div className="flex w-14 shrink-0 items-center justify-center bg-muted px-1 text-center sm:w-16">
            <span className="text-[10px] font-semibold uppercase leading-tight text-foreground/50">Без оценки</span>
          </div>
          <div className="flex min-h-[6rem] flex-1 flex-wrap content-start gap-2 bg-card/40 p-3">
            {unranked.map(c => <ArticleTierCardCell key={cards.indexOf(c)} {...cellProps(c)} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// Превращает метки [[#anchor]] в тексте в невидимые якоря для оглавления.
function injectAnchors(html: string): string {
  return html.replace(/\[\[#([a-zA-Z0-9_-]+)\]\]/g,
    (_, slug) => `<span id="toc-${slug}" class="toc-anchor"></span>`)
}

// Плавная прокрутка к якорю + двойная вспышка нужного абзаца.
// Якорь [[#slug]] вставлен как <span> внутри абзаца. Подсвечиваем и скроллим
// именно блок верхнего уровня (прямой ребёнок .rich-content), где стоит якорь —
// иначе у средних пунктов подсвечивался случайный inline-элемент.
function goToAnchor(slug: string) {
  const el = document.getElementById(`toc-${slug}`)
  if (!el) return

  let target: HTMLElement = el
  // Если якорь — пустой span-метка внутри текста, ищем видимый блок для подсветки.
  if (el.classList.contains("toc-anchor")) {
    // 1) поднимаемся до блока верхнего уровня (прямой ребёнок .rich-content)
    let node: HTMLElement | null = el
    while (node && !node.parentElement?.classList.contains("rich-content")) {
      node = node.parentElement
      if (node) target = node
    }
    if (node) target = node
    // 2) если получившийся target — сам пустой span-якорь (метка стояла прямо
    // в .rich-content), берём ближайший непустой соседний блок.
    if (target.classList.contains("toc-anchor") || target.offsetHeight === 0) {
      let sib = el.nextElementSibling as HTMLElement | null
      while (sib && (sib as HTMLElement).offsetHeight === 0) sib = sib.nextElementSibling as HTMLElement | null
      if (sib) target = sib
      else if (el.parentElement) target = el.parentElement
    }
  }

  // Скроллим именно к видимому блоку (отступ от липкой шапки)
  target.style.scrollMarginTop = "90px"
  target.scrollIntoView({ behavior: "smooth", block: "start" })

  // У карточек тир-листа фон перекрыт картинкой — подсвечиваем рамкой (ring),
  // у обычных абзацев — фоновой вспышкой.
  const flashClass = target.classList.contains("tier-card") ? "toc-flash-card" : "toc-flash"
  target.classList.remove(flashClass)
  void target.offsetWidth   // reflow — чтобы анимация перезапускалась при повторном клике
  target.classList.add(flashClass)
  window.setTimeout(() => target.classList.remove(flashClass), 1500)
}

// Прокрутка к карточке в блоке тир-листа (по её id tierblock-card-N) + подсветка
function goToTierCard(idx: number) {
  const el = document.getElementById(`tierblock-card-${idx}`)
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.classList.remove("toc-flash-card")
  void el.offsetWidth
  el.classList.add("toc-flash-card")
  window.setTimeout(() => el.classList.remove("toc-flash-card"), 1500)
}

const CATEGORY_LABELS: Record<string, string> = {
  article: "Статья",
  review: "Обзор",
  test: "Тест / Бенчмарк",
  guide: "Гайд",
  repair: "Ремонты",
  tier_detail: "Подробный тир-лист",
}

function openHtmlInNewTab(html: string) {
  const blob = new Blob([html], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank")
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function Lightbox({ images, startIdx, onClose }: { images: string[]; startIdx: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIdx)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const changeIdx = useCallback((next: number) => { setIdx(next); setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowRight") changeIdx((idx + 1) % images.length)
      if (e.key === "ArrowLeft") changeIdx((idx - 1 + images.length) % images.length)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [images.length, onClose, idx, changeIdx])

  const clampPan = (x: number, y: number, z: number) => {
    if (!imgRef.current || !containerRef.current) return { x, y }
    const img = imgRef.current
    const maxX = (img.offsetWidth * (z - 1)) / 2
    const maxY = (img.offsetHeight * (z - 1)) / 2
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const newZoom = Math.min(5, Math.max(1, zoom * (1 - e.deltaY * 0.001)))
    setPan(p => clampPan(p.x, p.y, newZoom))
    setZoom(newZoom)
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (zoom <= 1 || !imgRef.current) return
    const img = imgRef.current
    const rect = img.getBoundingClientRect()
    const relX = (e.clientX - (rect.left + rect.width / 2)) / rect.width
    const relY = (e.clientY - (rect.top + rect.height / 2)) / rect.height
    const maxX = (img.offsetWidth * (zoom - 1)) / 2
    const maxY = (img.offsetHeight * (zoom - 1)) / 2
    setPan({
      x: Math.min(maxX, Math.max(-maxX, -relX * img.offsetWidth * (zoom - 1))),
      y: Math.min(maxY, Math.max(-maxY, -relY * img.offsetHeight * (zoom - 1))),
    })
  }

  const onImgClick = () => {
    if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); return }
    setZoom(2.5)
  }

  return createPortal(
    <div className="fixed inset-0 z-[999] flex flex-col bg-black/95 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <span className="text-sm text-white/40">{idx + 1} / {images.length}</span>
        <div className="flex items-center gap-3">
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="text-xs text-white/40 hover:text-white transition-colors" style={{ cursor: "pointer" }}>
            Сбросить зум
          </button>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="X" size={16} />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="relative flex flex-1 items-center justify-center overflow-hidden" style={{ userSelect: "none" }} onWheel={onWheel} onMouseMove={onMouseMove}>
        <img
          ref={imgRef}
          src={images[idx]}
          alt=""
          draggable={false}
          onClick={onImgClick}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: "transform 0.08s ease-out",
            cursor: zoom > 1 ? "zoom-out" : "zoom-in",
            maxWidth: "88vw",
            maxHeight: "73vh",
            objectFit: "contain",
          }}
        />
        {images.length > 1 && <>
          <button onClick={() => changeIdx((idx - 1 + images.length) % images.length)}
            className="absolute left-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ChevronLeft" size={20} />
          </button>
          <button onClick={() => changeIdx((idx + 1) % images.length)}
            className="absolute right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ChevronRight" size={20} />
          </button>
        </>}
      </div>
      {images.length > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 py-3 shrink-0">
          {images.map((src, i) => (
            <button key={i} onClick={() => changeIdx(i)}
              className={`shrink-0 h-14 w-14 overflow-hidden rounded-lg border-2 transition-colors ${i === idx ? "border-white" : "border-white/20 hover:border-white/50"}`}
              style={{ cursor: "pointer" }}>
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}

function ArticleCarousel({ images, onOpenLightbox, standalone = false }: { images: string[]; onOpenLightbox?: (images: string[], idx: number) => void; standalone?: boolean }) {
  const [idx, setIdx] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const changeIdx = useCallback((next: number) => setIdx(next), [])

  const openLightbox = (i: number) => {
    if (onOpenLightbox) onOpenLightbox(images, i)
    else setLightboxOpen(true)
  }

  const go = (next: number) => changeIdx(next)

  if (images.length === 0) return null

  const wrapCls = standalone ? "mb-8" : ""

  if (images.length === 1) {
    return (
      <div className={`${wrapCls} overflow-hidden rounded-2xl border border-border cursor-zoom-in`} onClick={() => openLightbox(0)}>
        <img src={images[0]} alt="" className="w-full object-contain" style={{ maxHeight: "50vh" }} />
        {lightboxOpen && <Lightbox images={images} startIdx={0} onClose={() => setLightboxOpen(false)} />}
      </div>
    )
  }

  return (
    <div className={wrapCls}>
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        <div className="relative cursor-zoom-in" style={{ maxHeight: "55vh" }} onClick={() => openLightbox(idx)}>
          <img key={idx} src={images[idx]} alt="" className="w-full object-contain" style={{ maxHeight: "55vh", transition: "opacity 0.3s ease" }} />
          <div className="absolute top-3 right-3 rounded-full bg-black/50 px-2.5 py-1 text-xs text-white/80 backdrop-blur-sm">
            {idx + 1} / {images.length}
          </div>
        </div>
        <button onClick={e => { e.stopPropagation(); go((idx - 1 + images.length) % images.length) }}
          className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors backdrop-blur-sm" style={{ cursor: "pointer" }}>
          <Icon name="ChevronLeft" size={18} />
        </button>
        <button onClick={e => { e.stopPropagation(); go((idx + 1) % images.length) }}
          className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors backdrop-blur-sm" style={{ cursor: "pointer" }}>
          <Icon name="ChevronRight" size={18} />
        </button>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button key={i} onClick={e => { e.stopPropagation(); go(i) }}
              className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"}`} style={{ cursor: "pointer" }} />
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {images.map((src, i) => (
          <button key={i} onClick={() => go(i)}
            className={`shrink-0 h-16 w-20 overflow-hidden rounded-lg border-2 transition-colors ${i === idx ? "border-primary" : "border-border hover:border-primary/50"}`} style={{ cursor: "pointer" }}>
            <img src={src} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {lightboxOpen && <Lightbox images={images} startIdx={idx} onClose={() => setLightboxOpen(false)} />}
    </div>
  )
}

// Метка для вставки блока тир-листа прямо в текст: [[#tierlist]]
const TIERLIST_MARK = "[[#tierlist]]"

// Разбивает HTML на блоки, заменяя data-carousel на интерактивную карусель.
// tierSlot — готовый блок тир-листа, вставляется на место метки [[#tierlist]].
function ArticleContent({ html, tierSlot }: { html: string; tierSlot?: React.ReactNode }) {
  const blocks = useMemo(() => {
    // Убираем абзац-обёртку, если он содержит только метку тир-листа —
    // чтобы при разрезе не оставалось «осиротевших» <p></p>.
    const cleanHtml = tierSlot
      ? html.replace(/<p>\s*\[\[#tierlist\]\]\s*<\/p>/gi, TIERLIST_MARK)
      : html
    const parser = new DOMParser()
    const doc = parser.parseFromString(cleanHtml, "text/html")
    const result: Array<{ type: "html"; content: string } | { type: "carousel"; images: string[] } | { type: "tierlist" } | { type: "chart"; config: ChartConfig } | { type: "video"; src: string; poster: string }> = []
    let buf = ""
    const flush = () => { if (buf) { result.push({ type: "html", content: buf }); buf = "" } }
    doc.body.childNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        if (el.getAttribute("data-carousel") === "true") {
          flush()
          let images: string[] = []
          try { images = JSON.parse(el.getAttribute("data-images") || "[]") } catch { /* skip */ }
          if (!images.length) {
            images = Array.from(el.querySelectorAll("img")).map(img => img.getAttribute("src") || "").filter(Boolean)
          }
          if (images.length) result.push({ type: "carousel", images })
          return
        }
        if (el.getAttribute("data-chart") === "true") {
          flush()
          const cfg = parseChartConfig(el.getAttribute("data-chart-config"))
          if (cfg) result.push({ type: "chart", config: cfg })
          return
        }
        if (el.getAttribute("data-video") === "true") {
          flush()
          const src = el.getAttribute("src") || ""
          if (src) result.push({ type: "video", src, poster: el.getAttribute("poster") || "" })
          return
        }
      }
      buf += (node as Element).outerHTML || node.textContent || ""
    })
    flush()
    // Разрезаем html-блоки по метке тир-листа, вставляя плейсхолдер блока
    if (tierSlot) {
      const split: typeof result = []
      result.forEach(b => {
        if (b.type !== "html" || !b.content.includes(TIERLIST_MARK)) { split.push(b); return }
        const parts = b.content.split(TIERLIST_MARK)
        parts.forEach((part, pi) => {
          if (part.trim()) split.push({ type: "html", content: part })
          if (pi < parts.length - 1) split.push({ type: "tierlist" })
        })
      })
      return split
    }
    return result
  }, [html, tierSlot])

  const [lightboxState, setLightboxState] = useState<{ images: string[]; idx: number } | null>(null)

  return (
    <div>
      {blocks.map((block, i) =>
        block.type === "html" ? (
          <div key={i} className="rich-content text-foreground/80 leading-relaxed text-base"
            dangerouslySetInnerHTML={{ __html: injectAnchors(block.content) }} />
        ) : block.type === "tierlist" ? (
          <div key={i}>{tierSlot}</div>
        ) : block.type === "chart" ? (
          <ArticleChart key={i} config={block.config} />
        ) : block.type === "video" ? (
          // preload="metadata" — тянем только первый кадр и длительность,
          // иначе тяжёлый ролик замедлит открытие всей статьи.
          <div key={i} className="my-4 overflow-hidden rounded-2xl border border-border bg-black">
            <video src={block.src} poster={block.poster || undefined}
              controls playsInline preload="metadata"
              className="w-full" style={{ maxHeight: "70vh" }} />
          </div>
        ) : (
          <div key={i} className="my-4">
            <ArticleCarousel images={block.images} onOpenLightbox={(images, idx) => setLightboxState({ images, idx })} />
          </div>
        )
      )}
      {lightboxState && (
        <Lightbox images={lightboxState.images} startIdx={lightboxState.idx} onClose={() => setLightboxState(null)} />
      )}
    </div>
  )
}

// Оглавление статьи. На десктопе — липкий блок сбоку, на телефоне —
// сворачиваемый блок сверху. Пункт «Тир-лист» (anchor __tierlist__) раскрывается
// в подсписок карточек тир-листа (ссылка на каждую железку).
function TableOfContents({ items, variant, cards }: { items: TocItem[]; variant: "side" | "mobile"; cards: TierCard[] }) {
  const [open, setOpen] = useState(variant === "side")
  const [tierOpen, setTierOpen] = useState(false)
  if (!items.length) return null

  const list = (
    <ol className="space-y-1">
      {items.map((it, i) => {
        const isTier = it.anchor === "__tierlist__" && cards.length > 0
        return (
          <li key={it.anchor + i}>
            <div className="flex items-stretch gap-1">
              <button
                onClick={() => goToAnchor(it.anchor)}
                className="group flex flex-1 items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground/70 transition-colors hover:bg-primary/10 hover:text-primary"
                style={{ cursor: "pointer" }}
              >
                <span className="mt-0.5 text-xs font-mono text-foreground/30 group-hover:text-primary">{String(i + 1).padStart(2, "0")}</span>
                <span className="leading-snug">{it.title}</span>
              </button>
              {isTier && (
                <button onClick={() => setTierOpen(o => !o)} title="Показать список"
                  className="flex shrink-0 items-center rounded-lg px-1.5 text-foreground/40 transition-colors hover:bg-primary/10 hover:text-primary" style={{ cursor: "pointer" }}>
                  <Icon name={tierOpen ? "ChevronUp" : "ChevronDown"} size={15} />
                </button>
              )}
            </div>
            {isTier && tierOpen && (
              <ol className="ml-3 mt-1 space-y-0.5 border-l border-border pl-2">
                {cards.map((c, ci) => (
                  <li key={ci}>
                    <button onClick={() => goToTierCard(ci)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-xs text-foreground/60 transition-colors hover:bg-primary/10 hover:text-primary"
                      style={{ cursor: "pointer" }}>
                      {c.rank && <span className="mt-px font-mono text-foreground/30">{c.rank}</span>}
                      <span className="leading-snug">{c.title || `Карточка ${ci + 1}`}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </li>
        )
      })}
    </ol>
  )

  if (variant === "mobile") {
    return (
      <div className="mb-6 rounded-xl border border-border bg-card lg:hidden">
        <button onClick={() => setOpen(o => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground"
          style={{ cursor: "pointer" }}>
          <span className="flex items-center gap-2"><Icon name="List" size={16} className="text-primary" /> Оглавление</span>
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} className="text-foreground/40" />
        </button>
        {open && <div className="border-t border-border px-2 pb-2 pt-2">{list}</div>}
      </div>
    )
  }

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24">
        <p className="mb-2 flex items-center gap-2 px-2.5 text-xs font-semibold uppercase tracking-widest text-foreground/40">
          <Icon name="List" size={13} className="text-primary" /> Оглавление
        </p>
        {list}
      </div>
    </aside>
  )
}

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = isAdminAuthed() || user?.role === "admin"
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!id) { setError("Статья не найдена"); setLoading(false); return }
    api.articles.getById(Number(id))
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setArticle(data)
        setLoading(false)
      })
      .catch(() => { setError("Не удалось загрузить статью"); setLoading(false) })
  }, [id])

  // Сохранение новой расстановки карточек тир-листа (для админа, прямо в статье)
  const saveTierCards = (next: TierCard[]) => {
    if (!article) return
    setArticle({ ...article, tier_cards: next })  // оптимистично
    api.articles.update({
      id: article.id,
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      content: article.content,
      image_urls: article.image_urls || [],
      categories: article.categories,
      is_published: article.is_published !== false,
      html_attachment: article.html_attachment,
      toc: article.toc || [],
      tier_cards: next,
    })
  }

  const fmt = (date: string) =>
    new Date(date).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )

  if (error || !article) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <Icon name="FileX" size={48} className="mb-4 text-muted-foreground/30" />
      <h1 className="mb-2 text-xl font-medium text-foreground">{error || "Статья не найдена"}</h1>
      <button onClick={() => navigate("/")} className="mt-5 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
        На главную
      </button>
    </div>
  )

  const images = article.image_urls?.length ? article.image_urls : article.image_url ? [article.image_url] : []
  const toc = (article.toc || []).filter(t => t.title?.trim() && t.anchor?.trim())
  const hasToc = toc.length > 0

  // Тир-лист статьи. Если в тексте есть метка [[#tierlist]] — блок встанет на её
  // место; иначе — сразу после фото (как раньше).
  const hasTier = !!(article.tier_cards && article.tier_cards.length > 0)
  const tierMarkInText = hasTier && !!article.content && article.content.includes("[[#tierlist]]")
  const tierBlock = hasTier
    ? <ArticleTierList cards={article.tier_cards!} isAdmin={isAdmin} onReorder={saveTierCards} />
    : null

  return (
    <>
      {/* Метки из SEO-центра приоритетнее автоматических. */}
      <Seo
        title={article.meta_title || article.title}
        description={article.meta_description || article.excerpt}
        image={images[0]}
        path={`/articles/${article.slug || article.id}`}
        type="article"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          description: (article.excerpt || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
          image: images,
          datePublished: article.created_at,
          author: { "@type": "Organization", name: SITE_NAME },
          publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
          mainEntityOfPage: `${SITE_URL}/articles/${article.slug || article.id}`,
        }}
      />
      {/* Блок «вопрос-ответ» отдельной разметкой: именно её берут Google,
          Яндекс и ИИ-ассистенты, когда цитируют статью как источник ответа. */}
      {(article.faq || []).length > 0 && (
        <Seo
          jsonLd={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: (article.faq || []).map(f => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }}
        />
      )}
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-40 border-b border-border/50 bg-background/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="ArrowLeft" size={15} />
              Назад
            </button>
            <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">B</div>
              <span className="hidden sm:block text-sm font-medium text-foreground/70">BeGraphics</span>
            </button>
          </div>
        </header>

        <main className={`mx-auto px-4 py-10 sm:py-16 ${hasToc ? "max-w-6xl" : "max-w-4xl"}`}>
          <div className="mb-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {(article.categories && article.categories.length ? article.categories : [article.category]).map(cat => (
                <span key={cat} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {CATEGORY_LABELS[cat] || cat}
                </span>
              ))}
              <span className="text-xs text-muted-foreground">{fmt(article.created_at)}</span>
            </div>
            <h1 className="mb-4 text-3xl sm:text-4xl font-light leading-tight text-foreground">{article.title}</h1>
            {article.excerpt && (
              <div className="text-base leading-relaxed text-muted-foreground rich-content" dangerouslySetInnerHTML={{ __html: article.excerpt }} />
            )}
          </div>

          {hasToc && <TableOfContents items={toc} variant="mobile" cards={article.tier_cards || []} />}

          <div className={hasToc ? "grid gap-8 lg:grid-cols-[1fr_260px]" : ""}>
            <div className="min-w-0">
              <ArticleCarousel images={images} standalone />

              {/* Тир-лист после фото — только если в тексте нет метки [[#tierlist]] */}
              {hasTier && !tierMarkInText && tierBlock}

              {article.content && <ArticleContent html={article.content} tierSlot={tierMarkInText ? tierBlock : undefined} />}

              {article.html_attachment && (
                <div className="mt-10">
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Icon name="FileCode2" size={18} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">HTML-вложение</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Интерактивные результаты теста или бенчмарк</p>
                    </div>
                    <button
                      onClick={() => openHtmlInNewTab(article.html_attachment!)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                      style={{ cursor: "pointer" }}
                    >
                      <Icon name="ExternalLink" size={13} />
                      Посмотреть вложение
                    </button>
                  </div>
                </div>
              )}

              {/* Вопросы и ответы: полезны читателю и это же содержимое
                  цитируют нейросети и Google в блоке быстрых ответов. */}
              {(article.faq || []).length > 0 && (
                <div className="mt-12">
                  <h2 className="mb-4 text-xl font-medium text-foreground">Частые вопросы</h2>
                  <div className="space-y-2">
                    {(article.faq || []).map((f, i) => (
                      <details key={i} className="group rounded-xl border border-border bg-card p-4">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
                          {f.q}
                          <Icon name="ChevronDown" size={16} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                        </summary>
                        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                      </details>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-12">
                <CommentSection articleId={article.id} />
              </div>
            </div>

            {hasToc && <TableOfContents items={toc} variant="side" cards={article.tier_cards || []} />}
          </div>
        </main>
      </div>
    </>
  )
}