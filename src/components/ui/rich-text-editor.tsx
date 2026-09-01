import { useEditor, EditorContent, Node, mergeAttributes, NodeViewWrapper, ReactNodeViewRenderer, NodeViewProps } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import { useEffect, useCallback, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Icon from "@/components/ui/icon"
import ArticleChart from "@/components/article/ArticleChart"
import ChartEditModal from "@/components/article/ChartEditModal"
import { ChartConfig, parseChartConfig } from "@/lib/chartTypes"

const UPLOAD_URL = "https://functions.poehali.dev/5d666dbd-55fd-470b-8b67-fa9fcf6ecd81"

// ─── Просмотр карусели внутри редактора ───────────────────────────────────────
function CarouselNodeView({ node, deleteNode, updateAttributes }: NodeViewProps) {
  const images: string[] = node.attrs.images || []
  const [idx, setIdx] = useState(0)
  const [editing, setEditing] = useState(false)

  const handleDelete = () => {
    if (window.confirm("Удалить карусель?")) deleteNode()
  }

  const handleEditSave = (urls: string[]) => {
    updateAttributes({ images: urls })
    setEditing(false)
  }

  return (
    <NodeViewWrapper>
      <div contentEditable={false} className="group relative my-3 rounded-xl border-2 border-primary/40 bg-card select-none overflow-visible">

        {/* Панель управления — появляется при hover */}
        <div className="absolute -top-4 right-1 z-20 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Drag handle — 9 точек */}
          <div
            data-drag-handle
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-foreground hover:border-primary/40 transition-colors active:cursor-grabbing"
            title="Перетащить"
          >
            <Icon name="GripVertical" size={14} />
          </div>
          {/* Редактировать */}
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setEditing(true) }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-primary hover:border-primary/40 transition-colors"
            style={{ cursor: "pointer" }}
            title="Редактировать карусель"
          >
            <Icon name="Pencil" size={13} />
          </button>
          {/* Удалить */}
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); handleDelete() }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-destructive hover:border-destructive/40 transition-colors"
            style={{ cursor: "pointer" }}
            title="Удалить карусель"
          >
            <Icon name="Trash2" size={13} />
          </button>
        </div>

        {/* Лейбл */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-full bg-primary/80 px-2 py-0.5 text-[11px] text-white">
          <Icon name="GalleryHorizontal" size={11} />
          Карусель · {images.length} фото
        </div>

        {/* Главное фото */}
        <div className="relative overflow-hidden rounded-t-xl" style={{ maxHeight: 280 }}>
          <img src={images[idx]} alt="" style={{ width: "100%", maxHeight: 280, objectFit: "contain", display: "block" }} />
          {images.length > 1 && (
            <>
              <button type="button" onMouseDown={e => { e.preventDefault(); setIdx(i => (i - 1 + images.length) % images.length) }}
                className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white" style={{ cursor: "pointer" }}>
                <Icon name="ChevronLeft" size={16} />
              </button>
              <button type="button" onMouseDown={e => { e.preventDefault(); setIdx(i => (i + 1) % images.length) }}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white" style={{ cursor: "pointer" }}>
                <Icon name="ChevronRight" size={16} />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {images.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-white" : "w-1.5 bg-white/50"}`} />)}
              </div>
            </>
          )}
        </div>

        {/* Миниатюры */}
        {images.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto px-2 py-2">
            {images.map((src, i) => (
              <button key={i} type="button" onMouseDown={e => { e.preventDefault(); setIdx(i) }}
                className={`shrink-0 h-12 w-14 overflow-hidden rounded border-2 transition-colors ${i === idx ? "border-primary" : "border-transparent opacity-60"}`} style={{ cursor: "pointer" }}>
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Модалка редактирования — рендерится в portal */}
      {editing && (
        <CarouselEditModal
          initialImages={images}
          folder="articles"
          onSave={handleEditSave}
          onClose={() => setEditing(false)}
        />
      )}
    </NodeViewWrapper>
  )
}

// ─── Модалка редактирования существующей карусели ────────────────────────────
function CarouselEditModal({ initialImages, folder, onSave, onClose }: {
  initialImages: string[]
  folder: string
  onSave: (urls: string[]) => void
  onClose: () => void
}) {
  const [images, setImages] = useState<string[]>(initialImages)
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragIdx = useRef<number | null>(null)
  const dragOverIdx = useRef<number | null>(null)

  const uploadFile = async (file: File): Promise<string | null> => {
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const res = await fetch(UPLOAD_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: reader.result, name: file.name, folder }) })
          const data = await res.json()
          resolve(data.url || null)
        } catch { resolve(null) }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleFiles = async (files: FileList) => {
    setUploading(true)
    const urls = await Promise.all(Array.from(files).map(uploadFile))
    setImages(prev => [...prev, ...(urls.filter(Boolean) as string[])])
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const addUrl = () => {
    const url = urlInput.trim()
    if (!url || images.includes(url)) return
    setImages(prev => [...prev, url])
    setUrlInput("")
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name="Pencil" size={15} className="text-primary" />
            <h3 className="text-sm font-medium text-foreground">Редактировать карусель</h3>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/40 hover:bg-muted hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="X" size={15} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((url, i) => (
                <div key={url + i} draggable
                  onDragStart={() => { dragIdx.current = i }}
                  onDragEnter={() => { dragOverIdx.current = i }}
                  onDragOver={e => e.preventDefault()}
                  onDragEnd={() => {
                    const from = dragIdx.current; const to = dragOverIdx.current
                    if (from === null || to === null || from === to) return
                    setImages(imgs => { const a = [...imgs]; const [item] = a.splice(from, 1); a.splice(to, 0, item); return a })
                    dragIdx.current = null; dragOverIdx.current = null
                  }}
                  className="group relative h-20 w-20 overflow-hidden rounded-xl border border-border bg-muted" style={{ cursor: "grab" }}>
                  <img src={url} alt="" className="h-full w-full object-cover pointer-events-none" />
                  {i === 0 && <span className="absolute top-1 left-1 rounded bg-primary/80 px-1 py-0.5 text-[9px] text-white leading-none pointer-events-none">1</span>}
                  <button type="button" onClick={() => setImages(imgs => imgs.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity" style={{ cursor: "pointer" }}>
                    <Icon name="X" size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-primary/50 px-4 py-3 transition-colors" style={{ cursor: "pointer" }}>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)} />
            {uploading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : <Icon name="Upload" size={18} className="text-foreground/40" />}
            <p className="text-sm text-foreground/60">{uploading ? "Загружаем..." : "Нажмите чтобы добавить фото"}</p>
          </div>
          <div className="flex gap-2">
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addUrl())}
              placeholder="Или вставьте ссылку на фото..."
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none" />
            <button type="button" onClick={addUrl} disabled={!urlInput.trim()}
              className="rounded-lg bg-muted px-3 py-2 text-xs text-foreground/60 hover:text-foreground disabled:opacity-40" style={{ cursor: "pointer" }}>
              <Icon name="Plus" size={14} />
            </button>
          </div>
          {images.length < 2 && <p className="text-[11px] text-foreground/40">Минимум 2 фото для карусели.</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
          <button type="button" onClick={() => onSave(images)} disabled={images.length < 2 || uploading}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="Check" size={14} />
            Сохранить
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

const CarouselExtension = Node.create({
  name: "imageCarousel",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      images: {
        default: [],
        parseHTML: el => { try { return JSON.parse(el.getAttribute("data-images") || "[]") } catch { return [] } },
        renderHTML: attrs => ({ "data-images": JSON.stringify(attrs.images) }),
      },
    }
  },
  parseHTML() { return [{ tag: "div[data-carousel]" }] },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ "data-carousel": "true" }, HTMLAttributes)] },
  addNodeView() { return ReactNodeViewRenderer(CarouselNodeView) },
})

// ─── Одиночное фото как NodeView ──────────────────────────────────────────────
function SingleImageNodeView({ node, deleteNode }: NodeViewProps) {
  const src: string = node.attrs.src || ""

  const handleDelete = () => {
    if (window.confirm("Удалить фото?")) deleteNode()
  }

  return (
    <NodeViewWrapper>
      <div contentEditable={false} className="group relative my-2 overflow-visible">
        <div className="absolute -top-4 right-1 z-20 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <div data-drag-handle
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-foreground hover:border-primary/40 transition-colors active:cursor-grabbing"
            title="Перетащить">
            <Icon name="GripVertical" size={14} />
          </div>
          <button type="button" onMouseDown={e => { e.preventDefault(); handleDelete() }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-destructive hover:border-destructive/40 transition-colors"
            style={{ cursor: "pointer" }} title="Удалить фото">
            <Icon name="Trash2" size={13} />
          </button>
        </div>
        <img src={src} alt="" className="max-w-full rounded-lg" style={{ maxHeight: 420, objectFit: "contain", display: "block" }} />
      </div>
    </NodeViewWrapper>
  )
}

const SingleImageExtension = Node.create({
  name: "singleImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
    }
  },
  parseHTML() { return [{ tag: "img[data-single]" }] },
  renderHTML({ HTMLAttributes }) { return ["img", mergeAttributes({ "data-single": "true" }, HTMLAttributes)] },
  addNodeView() { return ReactNodeViewRenderer(SingleImageNodeView) },
})

// ─── Видео как NodeView ───────────────────────────────────────────────────────
// Свой видеофайл, загруженный в хранилище. Показываем обычный плеер — так
// редактор сразу выглядит как готовая статья.
function VideoNodeView({ node, deleteNode }: NodeViewProps) {
  const src: string = node.attrs.src || ""
  const poster: string = node.attrs.poster || ""

  const handleDelete = () => {
    if (window.confirm("Удалить видео?")) deleteNode()
  }

  return (
    <NodeViewWrapper>
      <div contentEditable={false} className="group relative my-2 overflow-visible">
        <div className="absolute -top-4 right-1 z-20 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <div data-drag-handle
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-foreground hover:border-primary/40 transition-colors active:cursor-grabbing"
            title="Перетащить">
            <Icon name="GripVertical" size={14} />
          </div>
          <button type="button" onMouseDown={e => { e.preventDefault(); handleDelete() }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-destructive hover:border-destructive/40 transition-colors"
            style={{ cursor: "pointer" }} title="Удалить видео">
            <Icon name="Trash2" size={13} />
          </button>
        </div>
        <video src={src} poster={poster || undefined} controls preload="metadata"
          className="w-full rounded-lg bg-black" style={{ maxHeight: 420, display: "block" }} />
        <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-foreground/40">
          <Icon name="Video" size={11} />
          Видео
        </span>
      </div>
    </NodeViewWrapper>
  )
}

const VideoExtension = Node.create({
  name: "articleVideo",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "" },
      poster: { default: "" },
    }
  },
  parseHTML() { return [{ tag: "video[data-video]" }] },
  renderHTML({ HTMLAttributes }) { return ["video", mergeAttributes({ "data-video": "true", controls: "true", preload: "metadata" }, HTMLAttributes)] },
  addNodeView() { return ReactNodeViewRenderer(VideoNodeView) },
})

// ─── График как NodeView ──────────────────────────────────────────────────────
function ChartNodeView({ node, deleteNode, updateAttributes }: NodeViewProps) {
  const config: ChartConfig | null = parseChartConfig(
    typeof node.attrs.config === "string" ? node.attrs.config : JSON.stringify(node.attrs.config || null)
  )
  const [editing, setEditing] = useState(false)

  const handleDelete = () => { if (window.confirm("Удалить график?")) deleteNode() }
  const handleSave = (c: ChartConfig) => { updateAttributes({ config: JSON.stringify(c) }); setEditing(false) }

  return (
    <NodeViewWrapper>
      <div contentEditable={false} className="group relative my-3 rounded-xl border-2 border-primary/40 bg-card select-none overflow-visible">
        <div className="absolute -top-4 right-1 z-20 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <div data-drag-handle
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-foreground hover:border-primary/40 transition-colors active:cursor-grabbing"
            title="Перетащить">
            <Icon name="GripVertical" size={14} />
          </div>
          <button type="button" onMouseDown={e => { e.preventDefault(); setEditing(true) }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-primary hover:border-primary/40 transition-colors"
            style={{ cursor: "pointer" }} title="Редактировать график">
            <Icon name="Pencil" size={13} />
          </button>
          <button type="button" onMouseDown={e => { e.preventDefault(); handleDelete() }}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-background border border-border text-foreground/40 hover:text-destructive hover:border-destructive/40 transition-colors"
            style={{ cursor: "pointer" }} title="Удалить график">
            <Icon name="Trash2" size={13} />
          </button>
        </div>
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-full bg-primary/80 px-2 py-0.5 text-[11px] text-white">
          <Icon name="ChartLine" size={11} />
          График
        </div>
        {config
          ? <ArticleChart config={config} compact />
          : <div className="py-10 text-center text-sm text-foreground/40">Нажмите «карандаш», чтобы настроить график</div>}
      </div>

      {editing && (
        <ChartEditModal initial={config || undefined} onSave={handleSave} onClose={() => setEditing(false)} />
      )}
    </NodeViewWrapper>
  )
}

const ChartExtension = Node.create({
  name: "articleChart",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      config: {
        default: null,
        parseHTML: el => el.getAttribute("data-chart-config") || null,
        renderHTML: attrs => ({ "data-chart-config": typeof attrs.config === "string" ? attrs.config : JSON.stringify(attrs.config) }),
      },
    }
  },
  parseHTML() { return [{ tag: "div[data-chart]" }] },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes({ "data-chart": "true" }, HTMLAttributes)] },
  addNodeView() { return ReactNodeViewRenderer(ChartNodeView) },
})

// ─── Модальное окно добавления фото ──────────────────────────────────────────
type ModalMode = "image" | "carousel" | null

interface PhotoModalProps {
  mode: ModalMode
  folder: string
  onInsert: (urls: string[], mode: "image" | "carousel") => void
  onClose: () => void
}

// Окно загрузки видео. Файл идёт НАПРЯМУЮ в хранилище по временной ссылке:
// ролик весит сотни мегабайт и в тело обычного запроса не помещается.
function VideoModal({ onInsert, onClose }: { onInsert: (src: string) => void; onClose: () => void }) {
  const [pct, setPct] = useState<number | null>(null)
  const [src, setSrc] = useState("")
  const [error, setError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError("")
    if (!file.type.startsWith("video/")) {
      setError("Нужен видеофайл: MP4, WebM или MOV")
      return
    }
    const start = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "video_upload_url", content_type: file.type }),
    }).then(r => r.json()).catch(() => null)

    if (!start?.key) {
      setError(start?.error || "Не удалось начать загрузку")
      return
    }

    // Файл отправляем частями: за один запрос проходит ограниченный объём,
    // поэтому режем видео и досылаем куски по очереди.
    const chunkSize: number = start.chunk_size || 2 * 1024 * 1024
    const total = Math.ceil(file.size / chunkSize)
    setPct(0)

    const readChunk = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "")
      reader.onerror = () => reject(new Error("read"))
      reader.readAsDataURL(blob)
    })

    try {
      for (let i = 0; i < total; i++) {
        const blob = file.slice(i * chunkSize, Math.min((i + 1) * chunkSize, file.size))
        const data = await readChunk(blob)
        const res = await fetch(UPLOAD_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "video_chunk", key: start.key, index: i, data }),
        }).then(r => r.json())
        if (!res?.ok) throw new Error(res?.error || "chunk")
        // Последние проценты оставляем на склейку файла
        setPct(Math.round(((i + 1) / total) * 95))
      }

      const fin = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "video_finish", key: start.key, total, content_type: file.type,
        }),
      }).then(r => r.json())
      if (!fin?.ok) throw new Error(fin?.error || "finish")

      setPct(100)
      setSrc(fin.url)
    } catch {
      setError("Видео не загрузилось — проверьте интернет и попробуйте снова")
    } finally {
      setPct(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name="Video" size={16} className="text-primary" />
            <h3 className="text-sm font-medium text-foreground">Вставить видео</h3>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/40 hover:bg-muted hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="X" size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {src ? (
            <video src={src} controls preload="metadata" className="w-full rounded-xl bg-black" style={{ maxHeight: 260 }} />
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={pct !== null}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-10 transition-colors hover:border-primary/50 disabled:opacity-60"
              style={{ cursor: pct === null ? "pointer" : "default" }}>
              {pct !== null ? (
                <>
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-sm text-foreground/60">Загружаем... {pct}%</p>
                </>
              ) : (
                <>
                  <Icon name="Upload" size={18} className="text-foreground/40" />
                  <p className="text-sm text-foreground/60">Нажмите, чтобы выбрать видео</p>
                  <p className="text-xs text-foreground/35">MP4, WebM или MOV</p>
                </>
              )}
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 hover:bg-muted transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
          <button type="button" onClick={() => { onInsert(src); onClose() }} disabled={!src}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
            style={{ cursor: src ? "pointer" : "default" }}>
            <Icon name="Check" size={14} />
            Вставить
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function PhotoModal({ mode, folder, onInsert, onClose }: PhotoModalProps) {
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragIdx = useRef<number | null>(null)
  const dragOverIdx = useRef<number | null>(null)

  const uploadFile = async (file: File): Promise<string | null> => {
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const res = await fetch(UPLOAD_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file: reader.result, name: file.name, folder }),
          })
          const data = await res.json()
          resolve(data.url || null)
        } catch { resolve(null) }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleFiles = async (files: FileList) => {
    setUploading(true)
    const urls = await Promise.all(Array.from(files).map(uploadFile))
    const valid = urls.filter(Boolean) as string[]
    setImages(prev => [...prev, ...valid])
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const addUrl = () => {
    const url = urlInput.trim()
    if (!url || images.includes(url)) return
    setImages(prev => [...prev, url])
    setUrlInput("")
  }

  const handleInsert = () => {
    if (!images.length) return
    onInsert(images, mode!)
    onClose()
  }

  const isCarousel = mode === "carousel"
  const canInsert = isCarousel ? images.length >= 2 : images.length >= 1

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Заголовок */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name={isCarousel ? "GalleryHorizontal" : "Image"} size={16} className="text-primary" />
            <h3 className="text-sm font-medium text-foreground">
              {isCarousel ? "Карусель фото" : "Вставить фото"}
            </h3>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/40 hover:bg-muted hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="X" size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Превью загруженных */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((url, i) => (
                <div
                  key={url + i}
                  draggable={isCarousel}
                  onDragStart={() => { dragIdx.current = i }}
                  onDragEnter={() => { dragOverIdx.current = i }}
                  onDragOver={e => e.preventDefault()}
                  onDragEnd={() => {
                    const from = dragIdx.current; const to = dragOverIdx.current
                    if (from === null || to === null || from === to) return
                    setImages(imgs => { const a = [...imgs]; const [item] = a.splice(from, 1); a.splice(to, 0, item); return a })
                    dragIdx.current = null; dragOverIdx.current = null
                  }}
                  className="group relative h-20 w-20 overflow-hidden rounded-xl border border-border bg-muted"
                  style={{ cursor: isCarousel ? "grab" : "default" }}
                >
                  <img src={url} alt="" className="h-full w-full object-cover pointer-events-none" />
                  {i === 0 && isCarousel && (
                    <span className="absolute top-1 left-1 rounded bg-primary/80 px-1 py-0.5 text-[9px] text-white leading-none pointer-events-none">1</span>
                  )}
                  <button type="button" onClick={() => setImages(imgs => imgs.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ cursor: "pointer" }}>
                    <Icon name="X" size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Зона загрузки */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-primary/50 px-4 py-3 transition-colors"
            style={{ cursor: "pointer" }}
          >
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)} />
            {uploading
              ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              : <Icon name="Upload" size={18} className="text-foreground/40" />}
            <div>
              <p className="text-sm text-foreground/60">{uploading ? "Загружаем..." : "Нажмите чтобы загрузить"}</p>
              <p className="text-xs text-foreground/30">JPG, PNG, WebP</p>
            </div>
          </div>

          {/* Вставить URL */}
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addUrl())}
              placeholder="Или вставьте ссылку на фото..."
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
              style={{ cursor: "text" }}
            />
            <button type="button" onClick={addUrl} disabled={!urlInput.trim()}
              className="rounded-lg bg-muted px-3 py-2 text-xs text-foreground/60 hover:text-foreground disabled:opacity-40 transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="Plus" size={14} />
            </button>
          </div>

          {isCarousel && images.length < 2 && (
            <p className="text-[11px] text-foreground/40">Добавьте минимум 2 фото для карусели. Перетащите для сортировки.</p>
          )}
        </div>

        {/* Футер */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
            Отмена
          </button>
          <button type="button" onClick={handleInsert} disabled={!canInsert || uploading}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name={isCarousel ? "GalleryHorizontal" : "ImagePlus"} size={14} />
            {isCarousel ? `Вставить карусель (${images.length})` : `Вставить фото`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Основной редактор ────────────────────────────────────────────────────────
interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  folder?: string
}

export default function RichTextEditor({ value, onChange, placeholder, className, folder = "articles" }: RichTextEditorProps) {
  const [modal, setModal] = useState<ModalMode>(null)
  const [chartModal, setChartModal] = useState(false)
  const [videoModal, setVideoModal] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline cursor-pointer" } }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      CarouselExtension,
      SingleImageExtension,
      ChartExtension,
      VideoExtension,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "outline-none min-h-[120px] prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-a:text-primary prose-img:rounded-lg",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML())
    },
  })

  // Синхронизация внешнего value → редактор (например при открытии карточки
  // на редактирование). Сравниваем с текущим HTML: если совпадает — значит
  // это эхо нашего же onChange, пропускаем; если отличается — применяем.
  // Отдельного ref-флага не держим (он мог «залипать» и глотать первую
  // подстановку, из-за чего форма редактирования открывалась пустой).
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const next = value || ""
    if (next !== current) {
      editor.commands.setContent(next, false)
    }
  }, [value, editor])

  const setLink = useCallback(() => {
    if (!editor) return
    const prev = editor.getAttributes("link").href
    const url = window.prompt("Ссылка:", prev)
    if (url === null) return
    if (url === "") { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
  }, [editor])

  // Вставка через insertContent — тот же путь что карусель (через NodeView, без setContent)
  const handleInsert = useCallback((urls: string[], mode: "image" | "carousel") => {
    if (!editor) return
    if (mode === "carousel") {
      editor.chain().focus().insertContent({
        type: "imageCarousel",
        attrs: { images: urls },
      }).run()
    } else {
      for (const url of urls) {
        editor.chain().focus().insertContent({
          type: "singleImage",
          attrs: { src: url, alt: "" },
        }).run()
      }
    }
  }, [editor])

  const insertChart = useCallback((config: ChartConfig) => {
    if (!editor) return
    editor.chain().focus().insertContent({
      type: "articleChart",
      attrs: { config: JSON.stringify(config) },
    }).run()
  }, [editor])

  const insertVideo = useCallback((src: string) => {
    if (!editor || !src) return
    editor.chain().focus().insertContent({
      type: "articleVideo",
      attrs: { src, poster: "" },
    }).run()
  }, [editor])

  if (!editor) return null

  const btn = (active: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded transition-colors ${active ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:bg-muted hover:text-foreground"}`

  return (
    <div className={`rounded-lg border border-border bg-background focus-within:border-primary transition-colors ${className ?? ""}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive("bold"))} title="Жирный">
          <Icon name="Bold" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive("italic"))} title="Курсив">
          <Icon name="Italic" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive("underline"))} title="Подчёркнутый">
          <Icon name="Underline" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={btn(editor.isActive("strike"))} title="Зачёркнутый">
          <Icon name="Strikethrough" size={13} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive("heading", { level: 2 }))} title="Заголовок">
          <Icon name="Heading2" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive("bulletList"))} title="Список">
          <Icon name="List" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive("orderedList"))} title="Нумерованный список">
          <Icon name="ListOrdered" size={13} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button type="button" onClick={setLink} className={btn(editor.isActive("link"))} title="Ссылка">
          <Icon name="Link" size={13} />
        </button>
        {editor.isActive("link") && (
          <button type="button" onClick={() => editor.chain().focus().unsetLink().run()} className={btn(false)} title="Убрать ссылку">
            <Icon name="LinkOff" size={13} />
          </button>
        )}

        <div className="mx-1 h-5 w-px bg-border" />

        <button type="button" onClick={() => setModal("image")} className={btn(modal === "image")} title="Вставить фото">
          <Icon name="Image" size={13} />
        </button>
        <button type="button" onClick={() => setModal("carousel")} className={btn(modal === "carousel")} title="Вставить карусель">
          <Icon name="GalleryHorizontal" size={13} />
        </button>
        <button type="button" onClick={() => setChartModal(true)} className={btn(chartModal)} title="Вставить график">
          <Icon name="ChartLine" size={13} />
        </button>
        <button type="button" onClick={() => setVideoModal(true)} className={btn(videoModal)} title="Вставить видео">
          <Icon name="Video" size={13} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button type="button" onClick={() => editor.chain().focus().undo().run()} className={btn(false)} title="Отменить">
          <Icon name="Undo2" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().redo().run()} className={btn(false)} title="Повторить">
          <Icon name="Redo2" size={13} />
        </button>
      </div>

      {/* Editor area */}
      <div className="relative px-3 py-2.5">
        {!value || value === "<p></p>" ? (
          <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-foreground/30">{placeholder}</span>
        ) : null}
        <EditorContent editor={editor} />
      </div>

      {/* Модальное окно */}
      {modal && (
        <PhotoModal
          mode={modal}
          folder={folder}
          onInsert={handleInsert}
          onClose={() => setModal(null)}
        />
      )}
      {/* Модалка добавления графика */}
      {chartModal && (
        <ChartEditModal
          onSave={c => { insertChart(c); setChartModal(false) }}
          onClose={() => setChartModal(false)}
        />
      )}
      {/* Модалка загрузки видео */}
      {videoModal && (
        <VideoModal
          onInsert={insertVideo}
          onClose={() => setVideoModal(false)}
        />
      )}
    </div>
  )
}