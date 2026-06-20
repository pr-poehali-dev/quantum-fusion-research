import { useRef, useState } from "react"
import Icon from "@/components/ui/icon"

const UPLOAD_URL = "https://functions.poehali.dev/5d666dbd-55fd-470b-8b67-fa9fcf6ecd81"

interface Props {
  images: string[]
  onChange: (urls: string[]) => void
  folder?: string
  maxImages?: number
}

// Сжимает/уменьшает изображение в браузере перед загрузкой.
// Большие фото (5–10 МБ) не помещаются в тело запроса облачной функции,
// поэтому ресайзим до maxSide и пережимаем в JPEG.
const compressImage = (file: File, maxSide = 2000, quality = 0.85): Promise<string> =>
  new Promise((resolve, reject) => {
    // SVG и GIF не трогаем — отдаём как есть
    if (file.type === "image/svg+xml" || file.type === "image/gif") {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = reject
      r.readAsDataURL(file)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxSide || height > maxSide) {
          const scale = maxSide / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) { reject(new Error("no canvas")); return }
        ctx.drawImage(img, 0, 0, width, height)
        // PNG с прозрачностью → оставляем PNG, иначе JPEG (меньше вес)
        const hasAlpha = file.type === "image/png"
        resolve(canvas.toDataURL(hasAlpha ? "image/png" : "image/jpeg", quality))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

export function ImageUploader({ images: imagesProp, onChange, folder = "builds", maxImages = 8 }: Props) {
  const images = imagesProp || []
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadUrl, setUploadUrl] = useState("")

  const uploadFile = async (file: File): Promise<string> => {
    // Сжимаем перед отправкой (если не вышло — шлём оригинал)
    let dataUrl: string
    try {
      dataUrl = await compressImage(file)
    } catch {
      dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = rej
        r.readAsDataURL(file)
      })
    }
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: dataUrl, name: file.name, folder }),
    })
    const data = await res.json()
    if (data.url) return data.url
    throw new Error(data.error || "No URL")
  }

  const handleFiles = async (files: FileList) => {
    if (images.length >= maxImages) return
    setUploading(true)
    const toUpload = Array.from(files).slice(0, maxImages - images.length)
    const urls = await Promise.all(toUpload.map(uploadFile).map(p => p.catch(() => null)))
    const valid = urls.filter(Boolean) as string[]
    onChange([...images, ...valid])
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  const addUrl = () => {
    const url = uploadUrl.trim()
    if (!url || images.includes(url)) return
    onChange([...images, url])
    setUploadUrl("")
  }

  const remove = (idx: number, e: React.MouseEvent) => { e.stopPropagation(); onChange(images.filter((_, i) => i !== idx)) }
  const moveLeft = (idx: number, e: React.MouseEvent) => { e.stopPropagation(); if (idx === 0) return; const a = [...images]; [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; onChange(a) }
  const moveRight = (idx: number, e: React.MouseEvent) => { e.stopPropagation(); if (idx === images.length - 1) return; const a = [...images]; [a[idx], a[idx + 1]] = [a[idx + 1], a[idx]]; onChange(a) }

  return (
    <div className="space-y-3">
      {/* Превью */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((url, i) => (
            <div key={i} className="group relative w-24 h-24 rounded-xl overflow-hidden border border-border bg-muted">
              <img src={url} alt="" className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute top-1 left-1 rounded bg-primary/80 px-1 py-0.5 text-[10px] text-white">гл.</span>
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                <div className="flex gap-1">
                  <button type="button" onClick={(e) => moveLeft(i, e)} style={{ cursor: "pointer" }}
                    className="flex h-6 w-6 items-center justify-center rounded bg-white/20 text-white hover:bg-white/40">
                    <Icon name="ChevronLeft" size={12} />
                  </button>
                  <button type="button" onClick={(e) => moveRight(i, e)} style={{ cursor: "pointer" }}
                    className="flex h-6 w-6 items-center justify-center rounded bg-white/20 text-white hover:bg-white/40">
                    <Icon name="ChevronRight" size={12} />
                  </button>
                </div>
                <button type="button" onClick={(e) => remove(i, e)} style={{ cursor: "pointer" }}
                  className="flex h-6 w-6 items-center justify-center rounded bg-red-500/70 text-white hover:bg-red-500">
                  <Icon name="Trash2" size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Загрузить файл */}
      {images.length < maxImages && (
        <div
          onClick={() => inputRef.current?.click()}
          style={{ cursor: "pointer" }}
          className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-primary/50 p-4 transition-colors"
        >
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => e.target.files && handleFiles(e.target.files)} />
          {uploading ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : (
            <Icon name="Upload" size={18} className="text-foreground/40" />
          )}
          <div>
            <p className="text-sm text-foreground/60">{uploading ? "Загружаем..." : "Нажмите чтобы загрузить фото"}</p>
            <p className="text-xs text-foreground/30">JPG, PNG, WebP · до {maxImages} фото</p>
          </div>
        </div>
      )}

      {/* Или вставить URL */}
      <div className="flex gap-2">
        <input
          value={uploadUrl}
          onChange={e => setUploadUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addUrl())}
          placeholder="Или вставьте ссылку на фото..."
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
          style={{ cursor: "text" }}
        />
        <button type="button" onClick={addUrl} disabled={!uploadUrl.trim()} style={{ cursor: "pointer" }}
          className="rounded-lg bg-muted px-3 py-2 text-xs text-foreground/60 hover:text-foreground disabled:opacity-40 transition-colors">
          <Icon name="Plus" size={14} />
        </button>
      </div>
    </div>
  )
}