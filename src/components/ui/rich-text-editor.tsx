import { useEditor, EditorContent, Node } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import Image from "@tiptap/extension-image"
import { useEffect, useCallback, useRef, useState } from "react"
import Icon from "@/components/ui/icon"

const UPLOAD_URL = "https://functions.poehali.dev/5d666dbd-55fd-470b-8b67-fa9fcf6ecd81"

// Расширение для группы-карусели
const ImageCarousel = Node.create({
  name: "imageCarousel",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      images: { default: [] },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-carousel]' }]
  },
  renderHTML({ node }) {
    const imgs = (node.attrs.images as string[]).map(
      (src: string) => `<img src="${src}" alt="" style="max-width:100%;max-height:420px;object-fit:contain;"/>`
    ).join("")
    return ["div", { "data-carousel": "true", style: "display:flex;gap:4px;overflow-x:auto;" }, ["span", { innerHTML: imgs }]]
  },
  toDOM(node: ReturnType<typeof Node.create> & { attrs: { images: string[] } }) {
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-carousel", "true")
    wrapper.style.cssText = "display:flex;gap:4px;overflow-x:auto;border:1px solid #333;border-radius:8px;padding:8px;"
    ;(node.attrs.images as string[]).forEach((src: string) => {
      const img = document.createElement("img")
      img.src = src
      img.style.cssText = "max-width:120px;max-height:80px;object-fit:cover;border-radius:4px;"
      wrapper.appendChild(img)
    })
    return wrapper
  },
})

interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  folder?: string
}

export default function RichTextEditor({ value, onChange, placeholder, className, folder = "articles" }: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const carouselInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [carouselMode, setCarouselMode] = useState(false)
  const [carouselImages, setCarouselImages] = useState<string[]>([])
  const dragIdx = useRef<number | null>(null)
  const dragOverIdx = useRef<number | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline cursor-pointer" } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ HTMLAttributes: { class: "max-w-full rounded-lg my-2", style: "max-height:420px;object-fit:contain;" } }),
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

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, false)
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

  const uploadFile = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const res = await fetch(UPLOAD_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file: reader.result, name: file.name, folder }),
          })
          const data = await res.json()
          if (data.url) resolve(data.url)
          else reject(new Error("No URL"))
        } catch (e) { reject(e) }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleImageUpload = useCallback(async (files: FileList) => {
    if (!editor) return
    setUploading(true)
    const urls = await Promise.all(
      Array.from(files).map(f => uploadFile(f).catch(() => null))
    )
    const valid = urls.filter(Boolean) as string[]
    for (const url of valid) {
      editor.chain().focus().setImage({ src: url }).run()
      editor.commands.insertContent("<p></p>")
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [editor, folder])

  const handleCarouselUpload = useCallback(async (files: FileList) => {
    setUploading(true)
    const urls = await Promise.all(
      Array.from(files).map(f => uploadFile(f).catch(() => null))
    )
    const valid = urls.filter(Boolean) as string[]
    setCarouselImages(prev => [...prev, ...valid])
    setUploading(false)
    if (carouselInputRef.current) carouselInputRef.current.value = ""
  }, [folder])

  const insertCarousel = useCallback(() => {
    if (!editor || carouselImages.length === 0) return
    // Вставляем карусель как HTML с data-атрибутом
    const imgsHtml = carouselImages.map(
      src => `<img src="${src}" alt="" />`
    ).join("")
    const html = `<div data-carousel="true" data-images='${JSON.stringify(carouselImages)}'>${imgsHtml}</div><p></p>`
    editor.chain().focus().insertContent(html).run()
    setCarouselImages([])
    setCarouselMode(false)
  }, [editor, carouselImages])

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

        {/* Вставить одно фото */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={btn(false)}
          title={uploading ? "Загрузка..." : "Вставить фото"}
          disabled={uploading}
        >
          {uploading ? (
            <div className="h-3 w-3 animate-spin rounded-full border border-foreground/60 border-t-transparent" />
          ) : (
            <Icon name="Image" size={13} />
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => e.target.files && handleImageUpload(e.target.files)}
        />

        {/* Вставить карусель */}
        <button
          type="button"
          onClick={() => setCarouselMode(m => !m)}
          className={btn(carouselMode)}
          title="Вставить карусель фото"
        >
          <Icon name="GalleryHorizontal" size={13} />
        </button>

        <div className="mx-1 h-5 w-px bg-border" />

        <button type="button" onClick={() => editor.chain().focus().undo().run()} className={btn(false)} title="Отменить" disabled={!editor.can().undo()}>
          <Icon name="Undo2" size={13} />
        </button>
        <button type="button" onClick={() => editor.chain().focus().redo().run()} className={btn(false)} title="Повторить" disabled={!editor.can().redo()}>
          <Icon name="Redo2" size={13} />
        </button>
      </div>

      {/* Панель карусели */}
      {carouselMode && (
        <div className="border-b border-border bg-muted/30 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-foreground/70">Карусель фото</p>
            <button type="button" onClick={() => { setCarouselMode(false); setCarouselImages([]) }}
              className="text-xs text-foreground/40 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="X" size={13} />
            </button>
          </div>

          {carouselImages.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {carouselImages.map((url, i) => (
                <div
                  key={url + i}
                  draggable
                  onDragStart={() => { dragIdx.current = i }}
                  onDragEnter={() => { dragOverIdx.current = i }}
                  onDragOver={e => e.preventDefault()}
                  onDragEnd={() => {
                    const from = dragIdx.current
                    const to = dragOverIdx.current
                    if (from === null || to === null || from === to) return
                    setCarouselImages(imgs => {
                      const a = [...imgs]
                      const [item] = a.splice(from, 1)
                      a.splice(to, 0, item)
                      return a
                    })
                    dragIdx.current = null
                    dragOverIdx.current = null
                  }}
                  className="group relative h-14 w-14 overflow-hidden rounded-lg border border-border bg-muted select-none"
                  style={{ cursor: "grab" }}
                >
                  <img src={url} alt="" className="h-full w-full object-cover pointer-events-none" />
                  {i === 0 && (
                    <span className="absolute top-0.5 left-0.5 rounded bg-primary/80 px-1 py-0.5 text-[9px] text-white leading-none pointer-events-none">1</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setCarouselImages(imgs => imgs.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ cursor: "pointer" }}>
                    <Icon name="X" size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => carouselInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors"
              style={{ cursor: "pointer" }}>
              {uploading ? (
                <div className="h-3 w-3 animate-spin rounded-full border border-foreground/60 border-t-transparent" />
              ) : (
                <Icon name="Upload" size={12} />
              )}
              {uploading ? "Загружаем..." : "Добавить фото"}
            </button>
            <input ref={carouselInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => e.target.files && handleCarouselUpload(e.target.files)} />

            {carouselImages.length >= 2 && (
              <button
                type="button"
                onClick={insertCarousel}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                style={{ cursor: "pointer" }}>
                <Icon name="GalleryHorizontal" size={12} />
                Вставить карусель ({carouselImages.length})
              </button>
            )}
          </div>
          {carouselImages.length < 2 && (
            <p className="text-[11px] text-foreground/30">Добавьте минимум 2 фото для карусели</p>
          )}
        </div>
      )}

      {/* Editor area */}
      <div className="relative px-3 py-2.5">
        {!value || value === "<p></p>" ? (
          <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-foreground/30">{placeholder}</span>
        ) : null}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}