import { useEffect, useRef, useState, useMemo } from "react"
import Icon from "@/components/ui/icon"
import { Component, SLOT_NAMES, compPoints, compCenter, fmt } from "./shared"

// Автоматическая карусель — меняется каждые 5-7 сек, можно листать вручную
export function BuildImageCarousel({ images, autoPlay = true }: { images: string[]; autoPlay?: boolean }) {
  const [idx, setIdx] = useState(0)
  const [animating, setAnimating] = useState(false)
  const [dir, setDir] = useState<1 | -1>(1)

  const goTo = (next: number, direction: 1 | -1 = 1) => {
    if (animating || images.length <= 1) return
    setDir(direction)
    setAnimating(true)
    setTimeout(() => {
      setIdx((next + images.length) % images.length)
      setAnimating(false)
    }, 350)
  }

  const prev = () => goTo(idx - 1, -1)
  const next = () => goTo(idx + 1, 1)

  // Авто-прокрутка
  useEffect(() => {
    if (!autoPlay || images.length <= 1) return
    const delay = 5000 + Math.random() * 2000
    const t = setTimeout(() => next(), delay)
    return () => clearTimeout(t)
  }, [idx, autoPlay, images.length])

  if (!images.length) return null

  const nextIdx = (idx + 1) % images.length

  return (
    <div className="relative overflow-hidden rounded-2xl bg-muted border border-border" style={{ minHeight: 220 }}>
      {/* Текущее фото */}
      <img
        key={idx}
        src={images[idx]} alt=""
        className="w-full object-contain transition-all duration-350"
        style={{
          maxHeight: "38vh",
          opacity: animating ? 0 : 1,
          transform: animating ? `translateX(${dir === 1 ? "-40px" : "40px"})` : "translateX(0)",
        }}
      />

      {images.length > 1 && (
        <>
          {/* Превью следующего — маленький справа */}
          <div className="absolute right-3 top-3 w-16 h-12 rounded-lg overflow-hidden border border-white/20 opacity-60 hover:opacity-90 transition-opacity">
            <img src={images[nextIdx]} alt="" className="w-full h-full object-cover" />
          </div>

          <button onClick={prev} style={{ cursor: "pointer" }}
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 border border-border backdrop-blur hover:bg-background hover:border-primary transition-all">
            <Icon name="ChevronLeft" size={16} />
          </button>
          <button onClick={next} style={{ cursor: "pointer" }}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 border border-border backdrop-blur hover:bg-background hover:border-primary transition-all">
            <Icon name="ChevronRight" size={16} />
          </button>

          {/* Точки */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button key={i} onClick={() => goTo(i, i > idx ? 1 : -1)} style={{ cursor: "pointer" }}
                className={`rounded-full transition-all duration-300 ${i === idx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/30 hover:bg-foreground/60"}`} />
            ))}
          </div>

          {/* Счётчик */}
          <div className="absolute top-3 left-3 rounded-full bg-black/50 backdrop-blur px-2.5 py-1 text-xs text-white/80 font-mono">
            {idx + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  )
}

// Карусель-обои для секции обзора — фото меняется каждые 6 сек
export function HeroBuildCarousel({ images, active }: { images: string[]; active: boolean }) {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (images.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % images.length), 6000)
    return () => clearInterval(t)
  }, [images.length])

  return (
    <div className="absolute inset-y-0 right-0 w-1/2 hidden lg:block pointer-events-none overflow-hidden">
      {images.map((src, i) => (
        <img
          key={i} src={src} alt=""
          className="absolute inset-0 h-full w-full object-contain object-right transition-opacity duration-1000"
          style={{ opacity: i === idx && active ? 1 : 0 }}
        />
      ))}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to right, hsl(var(--background)) 0%, hsl(var(--background) / 0.4) 25%, transparent 55%)" }} />
      {/* Точки слева снизу */}
      {images.length > 1 && (
        <div className="absolute bottom-8 left-4 flex gap-1.5 pointer-events-auto">
          {images.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{ cursor: "pointer" }}
              className={`rounded-full transition-all duration-300 ${i === idx ? "w-4 h-1.5 bg-white/70" : "w-1.5 h-1.5 bg-white/25 hover:bg-white/50"}`} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Первый слайд «Витрина»: фото ПК на весь экран, поверх которого по одной
 * каждую ~1 сек ПЛАВНО появляются подписи комплектующих со стрелками к центру.
 * Плашки с backdrop-blur + полупрозрачным фоном и обводкой primary читаются
 * и на тёмном, и на светлом фоне.
 */
export function BuildShowcaseSlide({ images, components, active, buildName, onNext }: {
  images: string[]; components: Component[]; active: boolean; buildName: string; onNext: () => void
}) {
  // Значимые слоты (без «доп.»), максимум 7 — по числу опорных позиций
  const items = useMemo(
    () => components.filter(c => c.name && c.slot !== "extra").slice(0, 7),
    [components]
  )
  const [shown, setShown] = useState(0)

  // === Привязка точек к пикселям на самом ФОТО (object-contain) ===
  // Фото вписано в контейнер с letterbox. Точки заданы в % ОТ ФОТО, поэтому
  // их надо пересчитать в % от КОНТЕЙНЕРА, зная реальный прямоугольник фото.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)   // natural размер фото
  const [wrap, setWrap] = useState<{ w: number; h: number }>({ w: 0, h: 0 }) // размер контейнера

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const upd = () => setWrap({ w: el.clientWidth, h: el.clientHeight })
    upd()
    const ro = new ResizeObserver(upd)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Прямоугольник видимого фото внутри контейнера (в % контейнера) при object-contain
  const photoBox = useMemo(() => {
    if (!nat || !wrap.w || !wrap.h) return { x: 0, y: 0, w: 100, h: 100 }
    const scale = Math.min(wrap.w / nat.w, wrap.h / nat.h)
    const dispW = nat.w * scale, dispH = nat.h * scale
    return {
      x: ((wrap.w - dispW) / 2) / wrap.w * 100,
      y: ((wrap.h - dispH) / 2) / wrap.h * 100,
      w: dispW / wrap.w * 100,
      h: dispH / wrap.h * 100,
    }
  }, [nat, wrap])

  // Пересчёт «% фото» → «% контейнера»
  const toX = (px: number) => photoBox.x + px / 100 * photoBox.w
  const toY = (py: number) => photoBox.y + py / 100 * photoBox.h

  // Появление подписей по одной каждую секунду — только когда слайд активен
  useEffect(() => {
    if (!active) { setShown(0); return }
    setShown(0)
    if (!items.length) return
    const t = setInterval(() => {
      setShown(s => {
        if (s >= items.length) { clearInterval(t); return s }
        return s + 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [active, items.length])

  // Авторасстановка подписей БЕЗ перехлёста лучей.
  // 1) Сторона подписи — по реальному X точки (x<50 → слева, иначе справа):
  //    луч не идёт через центр к чужой стороне.
  // 2) Внутри колонки подписи сортируются по УГЛУ луча (atan2 от общей точки-
  //    старта колонки к точке железки) и раскладываются сверху вниз в этом
  //    порядке. Сортировка по углу математически исключает пересечения лучей
  //    в колонке (в отличие от сортировки только по Y, которая ломалась, когда
  //    две точки почти на одной высоте, но на разном X).
  const anchors = useMemo(() => {
    const YT = 12, YB = 95        // вертикальный диапазон подписей (%)
    const LX = 4, RX = 96         // X-край подписей слева/справа
    const withIdx = items.map((c, i) => ({ c, i }))
    // Центр компонента в координатах КОНТЕЙНЕРА (с учётом letterbox фото),
    // чтобы сторона подписи и сортировка лучей совпадали с реальной картинкой.
    const ctrOf = (c: Component) => {
      const ctr = compCenter(c)
      return ctr ? { x: toX(ctr.x), y: toY(ctr.y) } : null
    }

    const left: { c: Component; i: number }[] = []
    const right: { c: Component; i: number }[] = []
    const noPt: { c: Component; i: number }[] = []
    for (const it of withIdx) {
      const ctr = ctrOf(it.c)
      if (!ctr) { noPt.push(it); continue }
      (ctr.x < 50 ? left : right).push(it)
    }
    for (const it of noPt) (left.length <= right.length ? left : right).push(it)

    const res: Record<number, { x: number; y: number; side: "left" | "right" }> = {}
    const place = (arr: { c: Component; i: number }[], side: "left" | "right") => {
      const x1 = side === "left" ? LX + 14 : RX - 14   // реальный старт луча
      const m = arr.length
      const labelY = (k: number) => m === 1 ? (YT + YB) / 2 : YT + (YB - YT) * (k / (m - 1))
      // Стартовый порядок — по углу от точки-старта колонки
      const sorted = [...arr].sort((a, b) => {
        const ca = ctrOf(a.c), cb = ctrOf(b.c)
        const angA = ca ? Math.atan2(ca.y - 50, ca.x - x1) : 9
        const angB = cb ? Math.atan2(cb.y - 50, cb.x - x1) : 9
        return angA - angB
      })
      // Устранение пересечений обменом соседей: если луч k пересекает луч k+1,
      // меняем подписи местами. Повторяем, пока пересечения есть (сходится).
      const seg = (idx: number) => {
        const ctr = ctrOf(sorted[idx].c) || { x: x1, y: labelY(idx) }
        return { ax: x1, ay: labelY(idx), bx: ctr.x, by: ctr.y }
      }
      const cross = (s1: ReturnType<typeof seg>, s2: ReturnType<typeof seg>) => {
        const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
          (cy - ay) * (bx - ax) > (by - ay) * (cx - ax)
        return ccw(s1.ax, s1.ay, s2.bx, s2.by, s2.ax, s2.ay) !== ccw(s1.bx, s1.by, s2.bx, s2.by, s2.ax, s2.ay)
          && ccw(s1.ax, s1.ay, s1.bx, s1.by, s2.ax, s2.ay) !== ccw(s1.ax, s1.ay, s1.bx, s1.by, s2.bx, s2.by)
      }
      for (let pass = 0; pass < m; pass++) {
        let swapped = false
        for (let k = 0; k < m - 1; k++) {
          if (cross(seg(k), seg(k + 1))) {
            [sorted[k], sorted[k + 1]] = [sorted[k + 1], sorted[k]]
            swapped = true
          }
        }
        if (!swapped) break
      }
      sorted.forEach((it, k) => {
        res[it.i] = { x: side === "left" ? LX : RX, y: labelY(k), side }
      })
    }
    place(left, "left")
    place(right, "right")
    return res
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, photoBox])

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center overflow-hidden bg-background">
      {/* Фото ПК на весь экран */}
      {images.map((src, i) => (
        <img key={i} src={src} alt={buildName}
          className="absolute inset-0 h-full w-full object-contain transition-opacity duration-1000"
          onLoad={i === 0 ? (e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }) : undefined}
          style={{ opacity: i === 0 && active ? 1 : (i === 0 ? 0.4 : 0) }} />
      ))}
      {/* Лёгкое затемнение по краям для читаемости подписей */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 60% 55% at 50% 50%, transparent 40%, hsl(var(--background) / 0.55) 100%)" }} />

      {/* Заголовок сверху */}
      <div className={`absolute top-20 left-1/2 z-10 -translate-x-1/2 text-center transition-all duration-700 ${active ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"}`}>
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">BeGraphics · Готовая сборка</p>
        <h1 className="font-light tracking-tight text-foreground drop-shadow-lg" style={{ fontSize: "clamp(1.5rem, 3.5vw, 2.75rem)" }}>{buildName}</h1>
      </div>

      {/* Лучи-указатели «___/»: жирная горизонтальная палочка от подписи,
          затем наклон к точке. Подложка-обводка для контраста. Подписи
          авторасставлены (anchors) так, что линии в колонке не пересекаются. */}
      <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <marker id="bss-arrow" markerWidth="5" markerHeight="5" refX="3.2" refY="2.5" orient="auto">
            <path d="M0,0 L4.5,2.5 L0,5 Z" fill="hsl(var(--primary))" />
          </marker>
        </defs>
        {items.map((c, i) => {
          const a = anchors[i]
          if (!a || i >= shown) return null
          // Старт луча сразу за плашкой (совпадает с startX в anchors = край±14).
          // Поводок минимальный → луч почти прямой; прямые лучи при сортировке
          // по углу НЕ пересекаются.
          const x1 = a.side === "left" ? a.x + 14 : a.x - 14
          const leadX = a.side === "left" ? x1 + 1 : x1 - 1
          const pointsArr = compPoints(c)
          // Если у компонента несколько точек (qty>1) — от бокса тянем луч
          // к КАЖДОЙ точке. Общий короткий «поводок» у подписи, затем ветки.
          const rays: string[] = pointsArr.length
            ? pointsArr.map(p => `${x1},${a.y} ${leadX},${a.y} ${toX(p.x)},${toY(p.y)}`)
            : [(() => {
                // фолбэк без точки — короткая горизонталь с лёгким изломом вверх
                const midX = a.side === "left" ? x1 + 8 : x1 - 8
                const endX = a.side === "left" ? x1 + 16 : x1 - 16
                return `${x1},${a.y} ${midX},${a.y} ${endX},${a.y - 4}`
              })()]
          return (
            <g key={i} style={{ transition: "opacity 500ms ease", opacity: 1 }}>
              {rays.map((pts, ri) => (
                <g key={ri}>
                  <polyline points={pts} fill="none"
                    stroke="hsl(var(--background))" strokeOpacity="0.65"
                    strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"
                    vectorEffect="non-scaling-stroke" />
                  <polyline points={pts} fill="none"
                    stroke="hsl(var(--primary))" strokeOpacity="0.95"
                    strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"
                    markerEnd="url(#bss-arrow)" vectorEffect="non-scaling-stroke" />
                </g>
              ))}
            </g>
          )
        })}
      </svg>

      {/* Маркеры-точки на фото — по одному на каждую точку компонента */}
      {items.map((c, i) => (
        i < shown ? compPoints(c).map((p, pi) => (
          <div key={`pt-${i}-${pi}`} className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${toX(p.x)}%`, top: `${toY(p.y)}%`,
              opacity: 1, transition: "opacity 500ms ease" }}>
            <span className="block h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-primary/40 ring-offset-1 ring-offset-background/50" />
          </div>
        )) : null
      ))}

      {/* Плашки с названиями — появление fadeInUp (animate.css style).
          Внешний div — позиционирование (не трогаем при анимации),
          внутренний — сама анимация fadeInUp через opacity + translateY. */}
      {items.map((c, i) => {
        const a = anchors[i]
        if (!a) return null
        const visible = i < shown
        return (
          <div key={i} className="absolute z-10"
            style={{
              left: `${a.x}%`, top: `${a.y}%`,
              width: "min(24%, 220px)",
              transform: `translate(${a.side === "left" ? "0" : "-100%"}, -50%)`,
            }}>
            <div className={`flex w-full flex-col rounded-xl border border-primary/40 bg-background/80 px-3 py-2 shadow-xl backdrop-blur-md ${a.side === "right" ? "items-end text-right" : ""}`}
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(40px)",
                transition: "opacity 600ms ease, transform 600ms cubic-bezier(0.19,1,0.22,1)",
                willChange: "opacity, transform",
              }}>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-primary leading-none">
                {SLOT_NAMES[c.slot] || c.slot}
              </span>
              <span className="mt-1 text-sm font-bold text-foreground leading-snug break-words line-clamp-2">
                {c.name}
              </span>
            </div>
          </div>
        )
      })}

      {/* Кнопка/подсказка вниз */}
      <button onClick={onNext} style={{ cursor: "pointer" }}
        className={`absolute bottom-8 left-1/2 z-10 -translate-x-1/2 flex flex-col items-center gap-1.5 transition-all duration-500 ${active ? "opacity-70 hover:opacity-100" : "opacity-0"}`}>
        <span className="text-xs font-medium text-foreground/80">Подробнее о сборке</span>
        <Icon name="ChevronDown" size={18} className="text-primary animate-bounce" />
      </button>
    </div>
  )
}

export function ComponentPhotoCarousel({ photos, name, active }: { photos: string[]; name: string; active: boolean }) {
  const [idx, setIdx] = useState(0)

  // Сброс при смене компонента
  useEffect(() => { setIdx(0) }, [name])

  // Авто-смена каждые 6 сек
  useEffect(() => {
    if (!active || photos.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % photos.length), 6000)
    return () => clearInterval(t)
  }, [active, photos.length])

  const prev = () => setIdx(i => (i - 1 + photos.length) % photos.length)
  const next = () => setIdx(i => (i + 1) % photos.length)

  return (
    <div
      className={`absolute right-0 top-0 bottom-0 hidden lg:block transition-all duration-1000 ${active ? "opacity-100 translate-x-0" : "opacity-0 translate-x-16"}`}
      style={{ width: "50%" }}
    >
      {/* Стек фото — без рамок, на весь блок, object-contain */}
      <div className="absolute inset-0">
        {photos.map((src, i) => (
          <img
            key={i} src={src} alt={name}
            className="absolute inset-0 w-full h-full object-contain transition-opacity duration-700"
            style={{ opacity: i === idx ? 1 : 0 }}
          />
        ))}
      </div>

      {/* Градиент слева — плавный переход к тексту */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "linear-gradient(to right, hsl(var(--background)) 0%, hsl(var(--background) / 0.4) 25%, transparent 55%)"
      }} />

      {/* Кнопки и точки поверх */}
      {photos.length > 1 && (
        <div className="absolute inset-0 flex flex-col justify-end pb-8 pr-6 items-end gap-3">
          <div className="flex items-center gap-2">
            <button onClick={prev} style={{ cursor: "pointer" }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-background/70 border border-border/50 backdrop-blur hover:border-primary transition-all">
              <Icon name="ChevronLeft" size={14} />
            </button>
            <button onClick={next} style={{ cursor: "pointer" }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-background/70 border border-border/50 backdrop-blur hover:border-primary transition-all">
              <Icon name="ChevronRight" size={14} />
            </button>
          </div>
          <div className="flex gap-1.5">
            {photos.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} style={{ cursor: "pointer" }}
                className={`rounded-full transition-all ${i === idx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-foreground/30 hover:bg-foreground/60"}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ComponentSection({ comp, index, total, active, onNext, onPrev }: {
  comp: Component; index: number; total: number; active: boolean; onNext: () => void; onPrev: () => void
}) {
  const price = comp.current_price ?? comp.price
  const photos = comp.image_urls?.length ? comp.image_urls : comp.image_url ? [comp.image_url] : []
  const hasPhoto = photos.length > 0

  // Длинное описание сворачиваем, чтобы не распирало слайд (фикс. высота экрана).
  const [descExpanded, setDescExpanded] = useState(false)
  const descRef = useRef<HTMLDivElement>(null)
  const [descOverflow, setDescOverflow] = useState(false)
  const COLLAPSED_DESC_PX = 132
  useEffect(() => {
    const el = descRef.current
    if (!el) return
    setDescOverflow(el.scrollHeight > COLLAPSED_DESC_PX + 8)
  }, [comp.description])
  // При смене слайда/компонента сбрасываем раскрытие
  useEffect(() => { setDescExpanded(false) }, [comp.name, active])

  return (
    <div className="relative flex h-full w-full items-center overflow-hidden bg-background">

      {/* Тонкий фоновый градиент */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: hasPhoto
          ? "radial-gradient(ellipse 50% 60% at 20% 50%, hsl(var(--primary) / 0.04) 0%, transparent 70%)"
          : "radial-gradient(ellipse 60% 50% at 30% 50%, hsl(var(--primary) / 0.04) 0%, transparent 70%)"
      }} />

      {/* Фото справа — компактная карусель (только десктоп) */}
      {hasPhoto && <ComponentPhotoCarousel photos={photos} name={comp.name} active={active} />}

      {/* Большой номер */}
      <div className="absolute top-16 sm:top-20 left-4 sm:left-16 pointer-events-none select-none">
        <span className="font-mono font-bold leading-none" style={{
          fontSize: "clamp(80px, 15vw, 160px)",
          color: "hsl(var(--foreground) / 0.04)"
        }}>
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      {/* Текст — слева */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-5 sm:px-16 pt-20 pb-24">
        <div className={`max-w-lg transition-all duration-700 ${active ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}>
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">
            <span className="hidden sm:inline">{SLOT_NAMES[comp.slot] || comp.slot} · </span>{index + 1} / {total}
          </p>
          <h2 className="mb-3 font-light leading-tight text-foreground" style={{ fontSize: "clamp(1.6rem, 4vw, 3.2rem)" }}>
            {comp.name}
            {comp.qty && comp.qty > 1 ? (
              <span className="ml-3 inline-block rounded-lg bg-primary/15 px-2.5 py-1 text-base sm:text-xl font-bold text-primary align-middle">×{comp.qty}</span>
            ) : null}
          </h2>
          <p className="mb-4 font-bold text-primary" style={{ fontSize: "clamp(1.3rem, 3vw, 2rem)" }}>{fmt(price)}</p>
          {comp.description && (
            <div className="mb-5 max-w-md">
              <div className="relative">
                <div
                  ref={descRef}
                  className="overflow-hidden text-sm sm:text-base leading-relaxed text-muted-foreground rich-content transition-[max-height] duration-500 ease-in-out"
                  style={{ maxHeight: descExpanded ? "60vh" : `${COLLAPSED_DESC_PX}px`, overflowY: descExpanded ? "auto" : "hidden" }}
                  dangerouslySetInnerHTML={{ __html: comp.description }}
                />
                {/* Градиент-затухание внизу, когда свёрнуто и есть что раскрыть */}
                {!descExpanded && descOverflow && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
                    style={{ background: "linear-gradient(to bottom, transparent, hsl(var(--background)))" }} />
                )}
              </div>
              {descOverflow && (
                <button type="button" onClick={() => setDescExpanded(v => !v)} style={{ cursor: "pointer" }}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  {descExpanded ? "Свернуть" : "Показать полностью"}
                  <Icon name={descExpanded ? "ChevronUp" : "ChevronDown"} size={13} />
                </button>
              )}
            </div>
          )}
          {/* Мобайл — фото под текстом */}
          {hasPhoto && (
            <div className="lg:hidden mb-5">
              <div className="relative overflow-hidden rounded-xl border border-border bg-muted" style={{ aspectRatio: "16/9" }}>
                <img src={photos[0]} alt={comp.name} className="w-full h-full object-contain" />
              </div>
            </div>
          )}
          {comp.specs && Object.keys(comp.specs).length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 max-w-sm">
              {Object.entries(comp.specs).slice(0, 4).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-background/70 backdrop-blur-sm border border-border/60 px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-0.5 truncate">{k}</p>
                  <p className="text-xs sm:text-sm text-foreground font-medium truncate">{v}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Навигация */}
      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-5 transition-all duration-500 ${active ? "opacity-100" : "opacity-0"}`}>
        <button onClick={onPrev} style={{ cursor: "pointer" }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-background/70 backdrop-blur border border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-all">
          <Icon name="ChevronUp" size={16} />
        </button>
        <span className="text-xs font-mono text-muted-foreground bg-background/70 backdrop-blur px-2 py-0.5 rounded">{index + 1} / {total}</span>
        <button onClick={onNext} style={{ cursor: "pointer" }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-background/70 backdrop-blur border border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-all">
          <Icon name="ChevronDown" size={16} />
        </button>
      </div>
    </div>
  )
}

export function ComponentIcon({ slot, size = 14 }: { slot: string; size?: number }) {
  const icons: Record<string, string> = {
    cpu: "Cpu", gpu: "Monitor", ram: "MemoryStick", storage: "HardDrive",
    psu: "Zap", case: "Box", motherboard: "CircuitBoard",
  }
  return <Icon name={icons[slot] || "Package"} size={size} />
}
