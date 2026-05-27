import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { createPortal } from "react-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import CommentSection from "@/components/CommentSection"

interface Article {
  id: number
  title: string
  slug: string
  excerpt: string | null
  image_url: string | null
  image_urls?: string[]
  category: string
  content: string
  html_attachment: string | null
  views: number
  created_at: string
}

const CATEGORY_LABELS: Record<string, string> = {
  article: "Статья",
  review: "Обзор",
  test: "Тест / Бенчмарк",
  guide: "Гайд",
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

// Разбивает HTML на блоки, заменяя data-carousel на интерактивную карусель
function ArticleContent({ html }: { html: string }) {
  const blocks = useMemo(() => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")
    const result: Array<{ type: "html"; content: string } | { type: "carousel"; images: string[] }> = []
    let buf = ""
    doc.body.childNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element
        if (el.getAttribute("data-carousel") === "true") {
          if (buf) { result.push({ type: "html", content: buf }); buf = "" }
          let images: string[] = []
          try { images = JSON.parse(el.getAttribute("data-images") || "[]") } catch { /* skip */ }
          if (!images.length) {
            images = Array.from(el.querySelectorAll("img")).map(img => img.getAttribute("src") || "").filter(Boolean)
          }
          if (images.length) result.push({ type: "carousel", images })
          return
        }
      }
      buf += (node as Element).outerHTML || node.textContent || ""
    })
    if (buf) result.push({ type: "html", content: buf })
    return result
  }, [html])

  const [lightboxState, setLightboxState] = useState<{ images: string[]; idx: number } | null>(null)

  return (
    <div>
      {blocks.map((block, i) =>
        block.type === "html" ? (
          <div key={i} className="rich-content text-foreground/80 leading-relaxed text-base"
            dangerouslySetInnerHTML={{ __html: block.content }} />
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

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
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

  return (
    <>
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

        <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
          <div className="mb-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {CATEGORY_LABELS[article.category] || article.category}
              </span>
              <span className="text-xs text-muted-foreground">{fmt(article.created_at)}</span>
            </div>
            <h1 className="mb-4 text-3xl sm:text-4xl font-light leading-tight text-foreground">{article.title}</h1>
            {article.excerpt && (
              <div className="text-base leading-relaxed text-muted-foreground rich-content" dangerouslySetInnerHTML={{ __html: article.excerpt }} />
            )}
          </div>

          <ArticleCarousel images={images} standalone />

          {article.content && <ArticleContent html={article.content} />}

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

          <div className="mt-12">
            <CommentSection articleId={article.id} />
          </div>
        </main>
      </div>
    </>
  )
}