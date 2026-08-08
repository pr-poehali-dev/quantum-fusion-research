import { useRef, useState } from "react"
import Icon from "@/components/ui/icon"

const UPLOAD_URL = "https://functions.poehali.dev/5d666dbd-55fd-470b-8b67-fa9fcf6ecd81"

// Тело запроса облачной функции ограничено (~5–10 МБ по документации). base64
// раздувает бинарник ещё на треть, поэтому держим итоговую строку с запасом.
const MAX_UPLOAD_BASE64 = 4_000_000
// Не грузим все фото параллельно разом — на медленном интернете это выглядит
// как «зависло», а на деле просто много больших запросов одновременно.
const UPLOAD_CONCURRENCY = 2

// Есть ли у картинки реально видимая прозрачность (не просто RGBA-режим —
// у многих PNG альфа-канал полностью непрозрачный, например скриншоты).
const hasVisibleAlpha = (ctx: CanvasRenderingContext2D, w: number, h: number): boolean => {
  // Сэмплируем не весь холст (может быть медленно на больших фото), а сетку точек
  const step = Math.max(1, Math.floor(Math.min(w, h) / 40))
  for (let y = 0; y < h; y += step) {
    const row = ctx.getImageData(0, y, w, 1).data
    for (let x = 0; x < row.length; x += 4 * step) {
      if (row[x + 3] < 250) return true
    }
  }
  return false
}

// Сжимает/уменьшает изображение в браузере перед загрузкой.
// Большие фото (5–10 МБ) не помещаются в тело запроса облачной функции,
// поэтому ресайзим до maxSide и пережимаем в JPEG. Если итог всё ещё
// слишком большой — уменьшаем качество/размер ещё несколько раз, чтобы
// гарантированно уложиться в лимит (иначе запрос падает с 413).
const compressImage = (file: File, maxSide = 2000, quality = 0.85): Promise<string> =>
  new Promise((resolve, reject) => {
    // SVG не трогаем — отдаём как есть (векторный формат, лёгкий)
    if (file.type === "image/svg+xml") {
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
        const draw = (side: number) => {
          let { width, height } = img
          if (width > side || height > side) {
            const scale = side / Math.max(width, height)
            width = Math.round(width * scale)
            height = Math.round(height * scale)
          }
          const canvas = document.createElement("canvas")
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext("2d")
          if (!ctx) throw new Error("no canvas")
          ctx.drawImage(img, 0, 0, width, height)
          return { canvas, ctx, width, height }
        }
        try {
          const { canvas, ctx, width, height } = draw(maxSide)
          // PNG/GIF с реальной прозрачностью → оставляем PNG, иначе JPEG
          // (для скриншотов и фото без альфы JPEG в разы легче).
          const wantAlpha = (file.type === "image/png" || file.type === "image/gif")
            && hasVisibleAlpha(ctx, width, height)

          if (wantAlpha) {
            resolve(canvas.toDataURL("image/png", quality))
            return
          }

          // Итеративно ужимаем, пока не уложимся в лимит тела запроса.
          let side = maxSide
          let q = quality
          let out = canvas.toDataURL("image/jpeg", q)
          let attempts = 0
          while (out.length > MAX_UPLOAD_BASE64 && attempts < 5) {
            attempts++
            if (q > 0.5) { q -= 0.15 } else { side = Math.round(side * 0.75) }
            const r2 = draw(side)
            out = r2.canvas.toDataURL("image/jpeg", q)
          }
          resolve(out)
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

interface Props {
  images: string[]
  onChange: (urls: string[]) => void
  folder?: string
  maxImages?: number
}

export function ImageUploader({ images: imagesProp, onChange, folder = "builds", maxImages = 8 }: Props) {
  const images = imagesProp || []
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
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
    // Таймаут на сам запрос — без него зависший или очень медленный ответ
    // выглядит для пользователя как «вечная загрузка» без единого сигнала.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    let res: Response
    try {
      res = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: dataUrl, name: file.name, folder }),
        signal: controller.signal,
      })
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw new Error(`${file.name}: превышено время ожидания`)
      throw new Error(`${file.name}: нет связи с сервером`)
    } finally {
      clearTimeout(timeout)
    }
    if (res.status === 413) throw new Error(`${file.name}: файл слишком большой даже после сжатия`)
    if (!res.ok) throw new Error(`${file.name}: сервер ответил ошибкой (${res.status})`)
    const data = await res.json()
    if (data.url) return data.url
    throw new Error(`${file.name}: ${data.error || "не удалось загрузить"}`)
  }

  const handleFiles = async (files: FileList) => {
    if (images.length >= maxImages) return
    setUploading(true)
    setError(null)
    const toUpload = Array.from(files).slice(0, maxImages - images.length)
    setProgress({ done: 0, total: toUpload.length })

    // Грузим ограниченными пачками — параллельно, но не всё разом, чтобы не
    // упереться в лимиты сети/функции и видеть честный прогресс по файлам.
    const results: (string | null)[] = []
    const failures: string[] = []
    for (let i = 0; i < toUpload.length; i += UPLOAD_CONCURRENCY) {
      const batch = toUpload.slice(i, i + UPLOAD_CONCURRENCY)
      const settled = await Promise.allSettled(batch.map(uploadFile))
      for (const r of settled) {
        if (r.status === "fulfilled") results.push(r.value)
        else failures.push((r.reason as Error)?.message || "неизвестная ошибка")
      }
      setProgress(p => ({ ...p, done: Math.min(p.total, p.done + batch.length) }))
    }

    const valid = results.filter(Boolean) as string[]
    if (valid.length) onChange([...images, ...valid])
    if (failures.length) setError(failures.join("; "))
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
            <p className="text-sm text-foreground/60">
              {uploading
                ? `Загружаем${progress.total > 1 ? ` ${progress.done}/${progress.total}` : "..."}`
                : "Нажмите чтобы загрузить фото"}
            </p>
            <p className="text-xs text-foreground/30">JPG, PNG, WebP · до {maxImages} фото</p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
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