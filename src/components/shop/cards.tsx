import { useState, useEffect, useRef } from "react"
import Icon from "@/components/ui/icon"
import OptimizedImage from "@/components/ui/optimized-image"
import { Product, Build, BuildTag, CommunityBuild, getTagClass, SLOT_NAMES, SLOT_ICONS } from "./shared"

// ── Мини-карусель фото для карточки товара ──
export function ProductImageCarousel({ images, name, inStock }: { images: string[]; name: string; inStock: boolean }) {
  const [idx, setIdx] = useState(0)
  if (!images.length) return (
    <div className="relative h-full w-full flex flex-col items-center justify-center overflow-hidden">
      <img src="https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/7e41fee1-74d8-448d-8412-0435e59185ae.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <Icon name="ImageOff" size={20} className="text-foreground/40" />
        <span className="text-[11px] text-foreground/40 font-medium">Фото готовятся</span>
      </div>
    </div>
  )
  return (
    <div className="relative h-full w-full">
      {images.map((src, i) => (
        <OptimizedImage key={i} src={src} alt={name} sizes="(max-width: 640px) 50vw, 25vw"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${i === idx ? "opacity-100" : "opacity-0"}`} />
      ))}
      {images.length > 1 && (
        <>
          <button onClick={e => { e.stopPropagation(); setIdx(i => (i - 1 + images.length) % images.length) }}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity hover:border-primary"
            style={{ cursor: "pointer" }}>
            <Icon name="ChevronLeft" size={12} />
          </button>
          <button onClick={e => { e.stopPropagation(); setIdx(i => (i + 1) % images.length) }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity hover:border-primary"
            style={{ cursor: "pointer" }}>
            <Icon name="ChevronRight" size={12} />
          </button>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1 z-10">
            {images.map((_, i) => (
              <button key={i} onClick={e => { e.stopPropagation(); setIdx(i) }}
                className={`rounded-full transition-all ${i === idx ? "w-3 h-1 bg-primary" : "w-1 h-1 bg-white/50"}`}
                style={{ cursor: "pointer" }} />
            ))}
          </div>
        </>
      )}
      {!inStock && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
          <span className="rounded-xl border border-white/25 bg-black/50 px-4 py-1.5 text-sm font-semibold uppercase tracking-widest text-white backdrop-blur-sm">
            Нет в наличии
          </span>
        </div>
      )}
    </div>
  )
}

// ── ProductCard с кнопкой «в корзине» ──
export function ProductCard({
  product: p, onOpen, onAddCart, onPreorder, onUpdateQty, cartQty, fmt, onNavigate, promo
}: {
  product: Product
  onOpen: () => void
  onAddCart: () => void
  onPreorder: () => void
  onUpdateQty: (qty: number) => void
  cartQty: number
  fmt: (n: number) => string
  onNavigate: () => void
  promo?: { code: string; title: string | null; discount_type: string; discount_value: number } | null
}) {
  const images = p.image_urls?.length ? p.image_urls : p.image_url ? [p.image_url] : []
  return (
    <div className="group flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-all duration-300">
      <button onClick={onOpen} className="relative aspect-video bg-muted flex items-center justify-center overflow-hidden" style={{ cursor: "pointer" }}>
        <ProductImageCarousel images={images} name={p.name} inStock={p.in_stock} />
        {p.is_used && (
          <span className="absolute left-2 top-2 z-10 rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
            Б/У
          </span>
        )}
        {promo && (
          <span className={`absolute left-2 z-10 inline-flex items-center gap-1 rounded bg-red-500 px-2 py-0.5 text-xs font-bold text-white ${p.is_used ? "top-9" : "top-2"}`}
            title={`Акция ${promo.code}: ${promo.discount_type === "percent" ? `−${promo.discount_value}%` : `−${fmt(promo.discount_value)}`}. Введите код в корзине.`}>
            <Icon name="Flame" size={12} />
            Акция
          </span>
        )}
        {p.old_price && p.in_stock && (
          <span className="absolute right-2 top-2 z-10 rounded bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
            -{Math.round((1 - p.price / p.old_price) * 100)}%
          </span>
        )}
        {p.in_stock && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/0 group-hover:bg-background/30 transition-all z-10">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-foreground font-medium bg-background/80 px-3 py-1.5 rounded-full">Предпросмотр</span>
          </div>
        )}
      </button>
      <button onClick={onNavigate} className="flex flex-col flex-1 p-4 text-left" style={{ cursor: "pointer" }}>
        {p.category && <span className="mb-1 text-xs text-foreground/40 font-mono">{p.category.name}</span>}
        <span className="mb-2 font-medium text-foreground leading-tight group-hover:text-primary transition-colors">{p.name}</span>
        {p.description && (
          <div className="mb-3 text-xs text-foreground/60 leading-relaxed line-clamp-3 rich-content" dangerouslySetInnerHTML={{ __html: p.description }} />
        )}
        {Object.keys(p.specs).length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {Object.entries(p.specs).slice(0, 3).map(([k, v]) => (
              <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground/60">{v}</span>
            ))}
          </div>
        )}
        <div className="mt-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-lg font-bold text-foreground">{fmt(p.price)}</div>
              {p.old_price && <div className="text-xs text-foreground/40 line-through">{fmt(p.old_price)}</div>}
            </div>
            {cartQty > 0 ? (
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs font-medium text-green-400">в корзине</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => onUpdateQty(cartQty - 1)} className="flex h-6 w-6 items-center justify-center rounded border border-border text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Minus" size={10} />
                  </button>
                  <span className="w-7 text-center text-xs font-bold text-foreground">{cartQty}шт</span>
                  <button onClick={onAddCart} className="flex h-6 w-6 items-center justify-center rounded border border-border text-foreground/60 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
                    <Icon name="Plus" size={10} />
                  </button>
                </div>
              </div>
            ) : (
              p.in_stock ? (
                <button onClick={onAddCart} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
                  <Icon name="Plus" size={14} />
                  В корзину
                </button>
              ) : (
                <button onClick={onPreorder} className="flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors" style={{ cursor: "pointer" }}>
                  <Icon name="Clock" size={14} />
                  Под заказ
                </button>
              )
            )}
          </div>
        </div>
      </button>
    </div>
  )
}

export function BuildTagChip({ tag }: { tag: BuildTag }) {
  const cls = getTagClass(tag.color)
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-sm ${cls}`}>
      {tag.name}
    </span>
  )
}

export function BuildCard({ build: b, onOpen, onOrder, fmt, promo }: { build: Build; onOpen: () => void; onOrder: () => void; fmt: (n: number) => string; promo?: { code: string; title: string | null; discount_type: string; discount_value: number } | null }) {
  const images = b.image_urls || []
  const hasImage = images.length > 0
  const [imgIdx, setImgIdx] = useState(0)
  const [hovered, setHovered] = useState(false)
  const cpu = b.components.find(c => c.slot === "cpu")
  const gpu = b.components.find(c => c.slot === "gpu")
  const tags = b.tags || []
  const previewTags = tags.slice(0, 2)

  const goImg = (e: React.MouseEvent, dir: 1 | -1) => {
    e.stopPropagation()
    setImgIdx(i => (i + dir + images.length) % images.length)
  }

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative flex flex-col rounded-2xl border border-border overflow-hidden hover:border-primary/50 transition-all duration-300 cursor-pointer"
      style={{ minHeight: 340 }}
    >
      {/* Фон */}
      {hasImage ? (
        <div className="absolute inset-0">
          {images.map((url, i) => (
            <OptimizedImage
              key={i}
              src={url} alt={b.name} sizes="(max-width: 640px) 100vw, 50vw"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: "brightness(0.55)", opacity: i === imgIdx ? 1 : 0, transition: "opacity 0.6s ease" }}
            />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-muted/80 to-card" />
      )}
      {/* Градиент */}
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/50 via-black/15 to-transparent group-hover:h-full group-hover:from-black/95 group-hover:via-black/30 transition-all duration-300" />

      {/* Бейджи — сверху */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        {!!b.variantsCount && (
          <span className="flex items-center gap-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/80">
            <Icon name="Layers" size={10} />
            {b.variantsCount + 1} варианта
          </span>
        )}
        {/* Теги — 2 при наведении, скрыты иначе */}
        {previewTags.map(t => (
          <span
            key={t.id}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-sm transition-all duration-300 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"} ${getTagClass(t.color)}`}
          >
            {t.name}
          </span>
        ))}
      </div>

      {/* Бейджи — правый верхний угол */}
      <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
        {b.reserved ? (
          <div
            className="flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg cursor-help"
            title="Другой клиент оформляет покупку этого ПК. Напишите нашим менеджерам, если нужен именно он.">
            <Icon name="Clock" size={10} />
            В резерве
          </div>
        ) : b.in_stock && (
          <div className="flex items-center gap-1 rounded-full bg-green-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg">
            <Icon name="CheckCircle" size={10} />
            В наличии
          </div>
        )}
        {b.is_featured && (
          <div className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow-lg">
            <Icon name="Star" size={10} />
            Рекомендуем
          </div>
        )}
        {promo && (
          <div className="flex items-center gap-1 rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg"
            title={`Акция ${promo.code}: ${promo.discount_type === "percent" ? `−${promo.discount_value}%` : `−${fmt(promo.discount_value)}`}. Введите код в корзине.`}>
            <Icon name="Flame" size={10} />
            Акция
          </div>
        )}
      </div>

      {/* Стрелки карусели — справа сверху, только если >1 фото */}
      {images.length > 1 && (
        <div className={`absolute z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${(b.in_stock || b.is_featured) ? "top-16 right-3" : "top-3 right-3"}`}>
          <button onClick={(e) => goImg(e, -1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ChevronLeft" size={12} />
          </button>
          <span className="text-[10px] text-white/70 font-mono">{imgIdx + 1}/{images.length}</span>
          <button onClick={(e) => goImg(e, 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ChevronRight" size={12} />
          </button>
        </div>
      )}

      {/* Точки карусели — внизу по центру фото */}
      {images.length > 1 && (
        <div className="absolute bottom-[88px] left-1/2 z-20 -translate-x-1/2 flex gap-1.5">
          {images.map((_, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setImgIdx(i) }}
              className={`rounded-full transition-all duration-300 ${i === imgIdx ? "w-4 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/40"}`}
              style={{ cursor: "pointer" }}
            />
          ))}
        </div>
      )}

      {/* Hover-оверлей: CPU + GPU */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 px-6">
        {cpu && (
          <div className="flex items-center gap-2 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 px-4 py-2 w-full max-w-xs">
            <Icon name="Cpu" size={14} className="text-primary shrink-0" />
            <span className="text-xs text-white/90 truncate">{cpu.name}</span>
          </div>
        )}
        {gpu && (
          <div className="flex items-center gap-2 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 px-4 py-2 w-full max-w-xs">
            <Icon name="Monitor" size={14} className="text-primary shrink-0" />
            <span className="text-xs text-white/90 truncate">{gpu.name}</span>
          </div>
        )}
      </div>

      {/* Контент — внизу */}
      <div className="relative z-10 mt-auto p-5">
        <h3 className="mb-3 text-xl font-medium text-white leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-300">
          {b.name}
        </h3>
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xl font-bold text-white">{fmt(b.total_price)}</p>
          {b.reserved ? (
            <span
              className="shrink-0 rounded-xl bg-orange-500/20 border border-orange-400/40 px-4 py-2 text-xs font-semibold text-orange-300 cursor-help"
              title="Другой клиент оформляет покупку этого ПК. Напишите нашим менеджерам, если нужен именно он.">
              В резерве
            </span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onOrder() }}
              className="shrink-0 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              style={{ cursor: "pointer" }}
            >
              Заказать
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ProductModal({ product: p, onClose, onAddCart, fmt }: { product: Product; onClose: () => void; onAddCart: () => void; fmt: (n: number) => string }) {
  const [imgIdx, setImgIdx] = useState(0)
  const images = p.image_urls?.length ? p.image_urls : p.image_url ? [p.image_url] : []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ cursor: "auto" }}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} style={{ cursor: "pointer" }} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-card overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="relative aspect-video bg-muted flex items-center justify-center">
          {images.length > 0 ? (
            <>
              <img src={images[imgIdx]} alt={p.name} className="h-full w-full object-cover" />
              {images.length > 1 && (
                <>
                  <button onClick={() => setImgIdx(i => (i - 1 + images.length) % images.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 border border-border/50 hover:border-primary transition-colors backdrop-blur"
                    style={{ cursor: "pointer" }}>
                    <Icon name="ChevronLeft" size={16} />
                  </button>
                  <button onClick={() => setImgIdx(i => (i + 1) % images.length)}
                    className="absolute right-12 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 border border-border/50 hover:border-primary transition-colors backdrop-blur"
                    style={{ cursor: "pointer" }}>
                    <Icon name="ChevronRight" size={16} />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {images.map((_, i) => (
                      <button key={i} onClick={() => setImgIdx(i)} className={`h-1.5 rounded-full transition-all ${i === imgIdx ? "w-6 bg-primary" : "w-1.5 bg-foreground/30"}`} style={{ cursor: "pointer" }} />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : <Icon name="Monitor" size={64} className="text-foreground/15" />}
          <button onClick={onClose} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground/70 hover:text-foreground backdrop-blur" style={{ cursor: "pointer" }}>
            <Icon name="X" size={16} />
          </button>
          {p.old_price && <span className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">-{Math.round((1 - p.price / p.old_price) * 100)}%</span>}
        </div>
        <div className="p-6">
          {p.category && <p className="mb-1 font-mono text-xs text-foreground/40">{p.category.name}</p>}
          <h2 className="mb-2 text-2xl font-medium text-foreground">{p.name}</h2>
          {p.description && <div className="mb-4 text-sm text-foreground/70 leading-relaxed rich-content" dangerouslySetInnerHTML={{ __html: p.description }} />}
          {Object.keys(p.specs).length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-xs font-mono text-foreground/40 uppercase tracking-wider">Характеристики</h3>
              <div className="space-y-2">
                {Object.entries(p.specs).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-sm text-foreground/60 capitalize">{k}</span>
                    <span className="text-sm font-medium text-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-bold text-foreground">{fmt(p.price)}</div>
              {p.old_price && <div className="text-sm text-foreground/40 line-through">{fmt(p.old_price)}</div>}
            </div>
            <button onClick={onAddCart} disabled={!p.in_stock} className="btn-tilt flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors" style={{ cursor: p.in_stock ? "pointer" : "not-allowed" }}>
              <Icon name="ShoppingCart" size={16} />
              {p.in_stock ? "В корзину" : "Нет в наличии"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BuildModal({ build: b, onClose, onOrder, fmt }: { build: Build; onClose: () => void; onOrder: () => void; fmt: (n: number) => string }) {
  const [slideIdx, setSlideIdx] = useState(0)
  const [animDir, setAnimDir] = useState<"left" | "right">("right")
  const [animating, setAnimating] = useState(false)
  const [userInteracted, setUserInteracted] = useState(false)
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Слайды: общее описание + по одному на каждый компонент
  const slides = [
    { type: "overview" as const },
    ...b.components.map((c, i) => ({ type: "component" as const, component: c, index: i })),
    { type: "summary" as const },
  ]
  const total = slides.length

  const goTo = (idx: number, dir: "left" | "right", manual = true) => {
    if (animating || idx === slideIdx) return
    if (manual) setUserInteracted(true)
    setAnimDir(dir)
    setAnimating(true)
    setTimeout(() => {
      setSlideIdx(idx)
      setAnimating(false)
    }, 320)
  }

  const prev = () => { if (slideIdx > 0) goTo(slideIdx - 1, "left") }
  const next = () => { if (slideIdx < total - 1) goTo(slideIdx + 1, "right") }

  // Автосмена слайдов компонентов каждые 5 сек (только если user не взаимодействовал)
  useEffect(() => {
    if (userInteracted) return
    const compSlides = slides
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.type === "component")
    if (compSlides.length < 2) return
    autoRef.current = setInterval(() => {
      setSlideIdx(cur => {
        const curPos = compSlides.findIndex(({ i }) => i === cur)
        if (curPos === -1) {
          // не на компоненте — перейти к первому
          setAnimDir("right")
          setAnimating(true)
          setTimeout(() => { setAnimating(false) }, 320)
          return compSlides[0].i
        }
        const next = compSlides[(curPos + 1) % compSlides.length]
        setAnimDir("right")
        setAnimating(true)
        setTimeout(() => { setAnimating(false) }, 320)
        return next.i
      })
    }, 5000)
    return () => { if (autoRef.current) clearInterval(autoRef.current) }
  }, [userInteracted, total])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next()
      else if (e.key === "ArrowLeft") prev()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [slideIdx, animating])

  const slide = slides[slideIdx]
  const images = b.image_urls || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ cursor: "auto" }}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} style={{ cursor: "pointer" }} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card overflow-hidden" style={{ maxHeight: "90vh" }}>

        {/* Слайд */}
        <div
          className="transition-all duration-300 ease-out"
          style={{
            opacity: animating ? 0 : 1,
            transform: animating
              ? `translateX(${animDir === "right" ? "32px" : "-32px"})`
              : "translateX(0)",
          }}
        >
          {slide.type === "overview" && (
            <div>
              <div className="relative aspect-video bg-gradient-to-br from-card to-muted flex items-center justify-center overflow-hidden">
                {images.length > 0 ? (
                  <img src={images[0]} alt={b.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Icon name="Cpu" size={56} className="text-primary/30" />
                    <span className="font-mono text-sm text-foreground/30">BeGraphics Build</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <p className="font-mono text-xs text-foreground/50 uppercase tracking-wider mb-1">Готовая сборка</p>
                  <h2 className="text-2xl font-medium text-white">{b.name}</h2>
                </div>
              </div>
              <div className="p-6">
                {b.description && <div className="text-sm text-foreground/70 leading-relaxed mb-4 rich-content" dangerouslySetInnerHTML={{ __html: b.description }} />}
                <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
                  <span className="text-sm text-foreground/60">{b.components.length} компонентов</span>
                  <span className="text-lg font-bold text-foreground">{fmt(b.total_price)}</span>
                </div>
                <p className="mt-3 text-center text-xs text-foreground/40">Листайте вправо, чтобы увидеть каждый компонент</p>
              </div>
            </div>
          )}

          {slide.type === "component" && (
            <div>
              <div className="relative aspect-video bg-gradient-to-br from-card to-muted flex items-center justify-center overflow-hidden">
                {images[slide.index + 1] ? (
                  <img
                    key={slide.index}
                    src={images[slide.index + 1]}
                    alt={slide.component.name}
                    className="h-full w-full object-cover"
                    style={{ animation: "fadeIn 0.6s ease" }}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Icon name={SLOT_ICONS[slide.component.slot] || "Cpu"} size={64} className="text-primary/25" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <p className="font-mono text-xs text-primary/80 uppercase tracking-wider mb-1">{SLOT_NAMES[slide.component.slot] || slide.component.slot}</p>
                  <h3 className="text-xl font-medium text-white leading-snug">{slide.component.name}</h3>
                </div>
              </div>
              <div className="p-6">
                {slide.component.description && (
                  <div className="text-sm text-foreground/70 leading-relaxed mb-4 rich-content" dangerouslySetInnerHTML={{ __html: slide.component.description }} />
                )}
                {!slide.component.description && (
                  <p className="text-sm text-foreground/40 italic mb-4">Комплектующее уровня {SLOT_NAMES[slide.component.slot] || slide.component.slot}</p>
                )}
                <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                  <span className="text-sm text-foreground/60">Стоимость</span>
                  <span className="text-xl font-bold text-primary">{fmt(slide.component.current_price ?? slide.component.price)}</span>
                </div>
              </div>
            </div>
          )}

          {slide.type === "summary" && (
            <div className="p-6 pt-8">
              <h3 className="mb-5 text-center text-lg font-medium text-foreground">Итоговая стоимость</h3>
              <div className="mb-4 space-y-2 rounded-xl border border-border p-4">
                {b.components.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-xs text-foreground/40 font-mono w-20">{SLOT_NAMES[c.slot] || c.slot}</span>
                      <span className="text-foreground/70 truncate">{c.name}</span>
                    </div>
                    <span className="ml-2 shrink-0 text-foreground/80">{fmt(c.current_price ?? c.price)}</span>
                  </div>
                ))}
              </div>
              {(() => {
                const calcParts = b.components.reduce((s, c) => s + (c.current_price ?? c.price ?? 0), 0)
                const calcFee = b.assembly_fee || 0
                return (
                  <div className="mb-6 rounded-xl border border-border/50 bg-muted/30 p-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground/60">Железо:</span>
                      <span className="text-foreground">{fmt(calcParts)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground/60">Сборка:</span>
                      <span className="text-foreground">{fmt(calcFee)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <span className="font-medium text-foreground">Итого:</span>
                      <span className="text-xl font-bold text-foreground">{fmt(calcParts + calcFee)}</span>
                    </div>
                  </div>
                )
              })()}
              <button onClick={onOrder} className="w-full rounded-xl bg-primary py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>Заказать эту сборку</button>
              <p className="mt-2 text-center text-xs text-foreground/40">После оформления менеджер свяжется для подтверждения</p>
            </div>
          )}
        </div>

        {/* Навигация */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            onClick={prev}
            disabled={slideIdx === 0}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground/60 hover:border-primary hover:text-foreground disabled:opacity-20 transition-all"
            style={{ cursor: slideIdx === 0 ? "default" : "pointer" }}
          >
            <Icon name="ChevronLeft" size={16} />
          </button>

          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i, i > slideIdx ? "right" : "left")}
                className={`rounded-full transition-all duration-300 ${i === slideIdx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/20 hover:bg-foreground/40"}`}
                style={{ cursor: "pointer" }}
              />
            ))}
          </div>

          <button
            onClick={slideIdx === total - 1 ? onClose : next}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground/60 hover:border-primary hover:text-foreground transition-all"
            style={{ cursor: "pointer" }}
          >
            <Icon name={slideIdx === total - 1 ? "X" : "ChevronRight"} size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function CommunityBuildCard({ build: b, fmt, onLoad }: { build: CommunityBuild; fmt: (n: number) => string; onLoad: () => void }) {
  const slotNames: Record<string, string> = { cpu: "CPU", gpu: "GPU", ram: "RAM", storage: "SSD", psu: "БП", case: "Корпус" }
  return (
    <div className="rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-all">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="font-medium text-foreground">{b.name}</h3>
          <p className="text-xs text-foreground/40">от {b.username} · {new Date(b.created_at).toLocaleDateString("ru-RU")}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">{b.components.length} компонентов</span>
      </div>
      <div className="mb-4 space-y-1.5">
        {b.components.slice(0, 4).map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 rounded bg-muted px-1 py-0.5 text-center text-foreground/40 font-mono text-xs">{slotNames[c.slot] || c.slot}</span>
            <span className="flex-1 truncate text-foreground/70">{c.name}</span>
            <span className="text-foreground/50 shrink-0">{fmt(c.price * (c.qty || 1))}</span>
          </div>
        ))}
        {b.components.length > 4 && <p className="text-xs text-foreground/30 pl-10">+ ещё {b.components.length - 4}</p>}
      </div>
      <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
        <span className="text-foreground/50">Итого со сборкой</span>
        <span className="font-bold text-foreground">{fmt(b.total_price)}</span>
      </div>
      <button onClick={onLoad} className="w-full flex items-center justify-center gap-2 rounded-lg border border-border py-2 text-xs font-medium text-foreground/70 hover:border-primary hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
        <Icon name="Copy" size={13} />Открыть в конфигураторе
      </button>
    </div>
  )
}