import { useEffect, useMemo, useState } from "react"
import funcUrls from "../../../backend/func2url.json"

const IMG_OPTIMIZE_URL = (funcUrls as Record<string, string>)["img-optimize"]
const CDN_PROJECT = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/optimized"
const WIDTHS = [480, 768, 1024]

// Запоминаем URL, для которых уже дернули фоновое создание webp — чтобы не спамить
const ensured = new Set<string>()

// sha1(url).slice(0,16) — ровно как на бэкенде (_slug_from_url)
async function slugFromUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url)
  const buf = await crypto.subtle.digest("SHA-1", data)
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
  return "auto-" + hex.slice(0, 16)
}

function triggerEnsure(srcUrl: string) {
  if (ensured.has(srcUrl) || !IMG_OPTIMIZE_URL) return
  ensured.add(srcUrl)
  const q = new URLSearchParams({ ensure: "1", url: srcUrl, widths: WIDTHS.join(",") })
  // fire-and-forget: создаст webp в фоне, следующий посетитель получит лёгкую версию
  fetch(`${IMG_OPTIMIZE_URL}?${q.toString()}`).catch(() => {})
}

interface Props {
  src?: string | null
  alt: string
  className?: string
  style?: React.CSSProperties
  width?: number
  height?: number
  sizes?: string
  priority?: boolean
}

/**
 * Картинка с автоматической WebP-оптимизацией.
 * Пытается показать лёгкий webp (через srcset); если его ещё нет —
 * показывает оригинал и в фоне запускает создание webp.
 */
export default function OptimizedImage({ src, alt, className, style, width, height, sizes, priority }: Props) {
  const [slug, setSlug] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // Внешние/неподдерживаемые источники не трогаем
  const optimizable = !!src && /^https?:\/\//.test(src) && /\.(jpe?g|png|webp)(\?|$)/i.test(src)

  useEffect(() => {
    setFailed(false)
    setSlug(null)
    if (!optimizable || !src) return
    let alive = true
    slugFromUrl(src).then(s => { if (alive) setSlug(s) })
    return () => { alive = false }
  }, [src, optimizable])

  const webp = useMemo(() => {
    if (!slug) return null
    return {
      src: `${CDN_PROJECT}/${slug}-768.webp`,
      srcSet: WIDTHS.map(w => `${CDN_PROJECT}/${slug}-${w}.webp ${w}w`).join(", "),
    }
  }, [slug])

  const common = {
    alt,
    className,
    style,
    width,
    height,
    loading: priority ? ("eager" as const) : ("lazy" as const),
    decoding: "async" as const,
  }

  // Нет src или не оптимизируем — обычный img
  if (!src || !optimizable || failed || !webp) {
    return (
      // @ts-expect-error fetchpriority — валидный HTML-атрибут
      <img src={src || undefined} srcSet={undefined} fetchpriority={priority ? "high" : undefined} {...common} />
    )
  }

  return (
    <img
      src={webp.src}
      srcSet={webp.srcSet}
      sizes={sizes}
      // @ts-expect-error fetchpriority — валидный HTML-атрибут
      fetchpriority={priority ? "high" : undefined}
      onError={() => { setFailed(true); triggerEnsure(src) }}
      {...common}
    />
  )
}
