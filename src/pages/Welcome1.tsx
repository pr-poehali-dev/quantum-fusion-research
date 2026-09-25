import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent, type RefObject } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import Seo from "@/components/Seo"
import { api } from "@/lib/api"

const CDN = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/"

const IMG = {
  bench: CDN + "8f14efb7-cd14-4eb7-a83f-d24d99b8b964.png",
  benchMobile: CDN + "0e77bbc4-46de-459d-a991-513f7ea2afaf.png",
  open: CDN + "462003f5-d562-4dac-82b1-df23ea5011ce.jpg",
  gpu: CDN + "cc116cf9-1a99-4450-ad0d-4d793046d01b.jpg",
  board: CDN + "dbedf91f-be5f-4379-b798-e2badeb51446.jpg",
  case: CDN + "67eef1e4-07a9-4cff-b1da-ff045a75b61f.jpg",
  desk: CDN + "5d4da50e-c287-4b2b-98d3-732c0e5fa7b9.jpg",
  work: CDN + "2ecd28b0-5720-465d-9e1a-1e15239f2b34.jpg",
  close: CDN + "50b13ef2-6dd4-4d41-8bb1-2d0f862dbe20.jpg",
  hud: CDN + "0d7ce192-1a95-4853-9d77-2c6780517402.png",
  solder: CDN + "808b8b3c-9619-472f-a9a3-097decedec20.jpeg",
  pcb: CDN + "cd91f011-25b9-4aa9-9de5-5741a2511beb.jpg",
  bay: CDN + "93c263ee-3512-4c6f-b42d-86c8240c169a.jpg",
  goldRig: CDN + "28cc1b34-7577-428c-8654-573d4d618539.png",
  shot: CDN + "1aabcdb0-f5d7-4b3a-ae8a-5995c0323881.png",
  rig: "/welcome/rig-gpu.png",
  sff: "/welcome/sff-build.png",
}

const ARTICLE_FALLBACK_IMGS = [IMG.solder, IMG.pcb, IMG.work, IMG.bay, IMG.close, IMG.hud]

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

function useSeen<T extends HTMLElement = HTMLDivElement>(threshold = 0.15) {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (reducedMotion() || !("IntersectionObserver" in window)) {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      ([en]) => {
        if (en.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold, rootMargin: "0px 0px -6% 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold, seen])
  return { ref, seen }
}

const FROM = {
  up: "translate-y-10 opacity-0",
  left: "-translate-x-10 opacity-0",
  right: "translate-x-10 opacity-0",
  zoom: "scale-[0.94] opacity-0",
}

function Reveal({ children, delay = 0, from = "up", className = "" }: { children: ReactNode; delay?: number; from?: keyof typeof FROM; className?: string }) {
  const { ref, seen } = useSeen()
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-[cubic-bezier(.2,.7,.2,1)] ${seen ? "translate-x-0 translate-y-0 scale-100 opacity-100" : FROM[from]} ${className}`}
    >
      {children}
    </div>
  )
}

function CountUp({ to, suffix = "", duration = 1400 }: { to: number; suffix?: string; duration?: number }) {
  const { ref, seen } = useSeen<HTMLSpanElement>(0.4)
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!seen) return
    if (reducedMotion()) {
      setV(to)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration)
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [seen, to, duration])
  return (
    <span ref={ref}>
      {v.toLocaleString("ru-RU")}
      {suffix}
    </span>
  )
}

function useParallax(img: RefObject<HTMLImageElement>, text: RefObject<HTMLDivElement>, bar: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const rm = reducedMotion()
    let raf = 0
    const update = () => {
      const y = window.scrollY
      const h = window.innerHeight
      if (!rm && img.current && y < h * 1.2) {
        img.current.style.transform = `translate3d(0, ${y * 0.35}px, 0) scale(${1.08 + y * 2e-4})`
      }
      if (!rm && text.current && y < h * 1.2) {
        text.current.style.opacity = String(Math.max(0, 1 - y / (h * 0.75)))
        text.current.style.transform = `translate3d(0, ${y * -0.12}px, 0)`
      }
      if (bar.current) {
        const max = document.documentElement.scrollHeight - h
        bar.current.style.transform = `scaleX(${max > 0 ? y / max : 0})`
      }
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    update()
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [img, text, bar])
}

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (top) setActive(top.target.id)
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5] },
    )
    ids.forEach((id) => {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [ids])
  return active
}

function spot(e: RPointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`)
}

function Marquee({ items, reverse, className = "", speed = 38 }: { items: ReactNode[]; reverse?: boolean; className?: string; speed?: number }) {
  return (
    <div className={`wl-mask-x overflow-hidden ${className}`}>
      <div className={`wl-marquee flex w-max items-center ${reverse ? "wl-rev" : ""}`} style={{ animationDuration: `${speed}s` }}>
        {[0, 1].map((n) => (
          <div key={n} className="flex shrink-0 items-center" aria-hidden={n === 1}>
            {items.map((it, i) => (
              <div key={i} className="shrink-0">
                {it}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

const CSS = `
@keyframes wl-marquee { from { transform: translate3d(0,0,0) } to { transform: translate3d(-50%,0,0) } }
.wl-marquee { animation: wl-marquee linear infinite; }
.wl-marquee.wl-rev { animation-direction: reverse; }
.wl-mask-x { -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); }
@keyframes wl-shine { from { background-position: 200% 0 } to { background-position: -200% 0 } }
.wl-shine-text { background: linear-gradient(100deg, #fff 30%, #ff6b5a 45%, #fff 60%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: wl-shine 5s linear infinite; }
.wl-cta { position: relative; overflow: hidden; isolation: isolate; }
.wl-cta::after { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 35%, rgba(255,255,255,.55) 50%, transparent 65%); transform: translateX(-120%); animation: wl-sweep 3.6s ease-in-out infinite; z-index: -1; }
@keyframes wl-sweep { 0%, 55% { transform: translateX(-120%) } 100% { transform: translateX(120%) } }
.wl-scan { background: repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px); }
.wl-grid { background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px); background-size: 44px 44px; }
@keyframes wl-sweepline { from { transform: translateY(-100%) } to { transform: translateY(100vh) } }
.wl-sweepline { animation: wl-sweepline 6s linear infinite; }
.wl-spot { position: relative; isolation: isolate; }
.wl-spot::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 2; opacity: 0; transition: opacity .35s; background: radial-gradient(380px circle at var(--mx,50%) var(--my,50%), rgba(255,70,50,.20), transparent 42%); }
.wl-spot:hover::before { opacity: 1; }
.wl-ring { position: relative; }
.wl-ring::after { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; background: conic-gradient(from var(--wl-a, 0deg), transparent 0 70%, rgba(255,80,60,.9) 85%, transparent 100%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: wl-spin 5s linear infinite; }
@property --wl-a { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
@keyframes wl-spin { to { --wl-a: 360deg } }
@keyframes wl-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
.wl-float { animation: wl-float 5s ease-in-out infinite; }
@keyframes wl-blob { 0%,100% { transform: translate(0,0) scale(1) } 33% { transform: translate(8%,-6%) scale(1.12) } 66% { transform: translate(-6%,5%) scale(.92) } }
.wl-blob { animation: wl-blob 14s ease-in-out infinite; }
@keyframes wl-cue { 0%,100% { transform: translateY(0); opacity: .4 } 50% { transform: translateY(8px); opacity: 1 } }
.wl-cue { animation: wl-cue 1.8s ease-in-out infinite; }
.wl-noscroll { scrollbar-width: none; } .wl-noscroll::-webkit-scrollbar { display: none; }
@media (prefers-reduced-motion: reduce) {
  .wl-marquee, .wl-shine-text, .wl-cta::after, .wl-sweepline, .wl-ring::after, .wl-float, .wl-blob, .wl-cue { animation: none !important; }
}
`

const NAV = [
  { id: "hero", t: "Стенд" },
  { id: "who", t: "Кто мы" },
  { id: "shop", t: "Магазин" },
  { id: "config", t: "Конфиг" },
  { id: "stress", t: "Прогон" },
  { id: "service", t: "Услуги" },
  { id: "tiers", t: "База" },
  { id: "articles", t: "Статьи" },
  { id: "feed", t: "Лента" },
  { id: "faq", t: "FAQ" },
  { id: "contacts", t: "Контакты" },
]
const NAV_IDS = NAV.map((n) => n.id)

const TICKER = ["RTX 5090", "Ryzen 7 9800X3D", "DDR5 6000 CL30", "RTX 5070 Ti", "Core Ultra 9", "B650E", "NVMe Gen5", "12V-2x6", "1000 W Gold", "360 AIO", "RX 9070 XT", "Z890"]

const TIERS: Record<string, { color: string; title: string }> = {
  S: { color: "#ef4444", title: "Эталон" },
  A: { color: "#f97316", title: "Отличный выбор" },
  B: { color: "#eab308", title: "Крепкий середняк" },
  C: { color: "#22c55e", title: "На любителя" },
  D: { color: "#3b82f6", title: "Так себе" },
  F: { color: "#a855f7", title: "Не рекомендуем" },
}

const CONFIG_ROWS = [
  { k: "CPU", v: "Ryzen 7 9800X3D" },
  { k: "Плата", v: "B650E · AM5" },
  { k: "RAM", v: "32 ГБ DDR5 6000" },
  { k: "GPU", v: "RTX 5070 Ti · 304 мм" },
  { k: "БП", v: "850 W · 12V-2x6" },
]

const SERVICES = [
  { t: "Сборка под задачу", d: "Задача и бюджет — остальное на нас.", img: IMG.sff, to: "/quiz" },
  { t: "Комплектующие", d: "То, что сами ставим в сборки.", img: IMG.goldRig, pos: "object-top", to: "/shop" },
  { t: "Ремонт и апгрейд", d: "Паяем и поднимаем то, что уже списали.", img: IMG.solder, to: "/service" },
  { t: "Стресс на стенде", d: "Уезжает только с отчётом.", img: IMG.hud, to: "/stresstester" },
]

const REPAIRS = [
  { t: "Диагностика", d: "Посмотрим и скажем: чинить или заменить.", img: IMG.pcb, to: "/service" },
  { t: "Пайка и оживление", d: "Карты и ноутбуки, за которые обычный сервис не берётся.", img: IMG.solder, to: "/service" },
  { t: "Апгрейд", d: "Другая карта, больше памяти, тише — подберём.", img: IMG.bay, to: "/service" },
]

const SHOP_CARDS = [
  { t: "Видеокарты", img: "/welcome/shop-gpu.png", to: "/shop" },
  { t: "Платы и процессоры", img: "/welcome/shop-board.png", to: "/shop" },
]

const WHO = [
  { t: "Сервисный центр", d: "Поднимаем то, что в соседнем сервисе списали.", img: IMG.solder, to: "/service" },
  { t: "Собираем ПК", d: "Под задачу, не из случайного прайса.", img: IMG.work, to: "/quiz" },
  { t: "База знаний", d: "Тирлисты и разборы. Конфиг из неё, не на глаз.", img: IMG.hud, to: "/tier-lists" },
]

const PIKABU = [
  { title: "RTX 4090 48 ГБ — первая модификация из 24 в 48 ГБ в РФ", url: "https://pikabu.ru/story/rtx_4090_48_gb_vozmozhno_pervaya_modifikatsiya_iz_rtx_4090_24_v_48_gb_v_rf_12934738", img: IMG.gpu },
  { title: "Можно ли собрать видеокарту с нуля? Самая быстрая RTX 4090 в мире", url: "https://pikabu.ru/story/mozhno_li_sobrat_videokartu_s_nulya_samaya_byistraya_rtx_4090_v_mire_12006408", img: IMG.pcb },
  { title: "Правильное отключение фаз питания — ремонт Thunderobot Zero на RTX 4080", url: "https://pikabu.ru/story/pravilnoe_otklyuchenie_faz_pitaniya_videokartyi_remont_thunderobot_zero_na_grafike_rtx_4080_13452933", img: IMG.solder },
  { title: "Видеокарта с саморезами — весёлый ремонт Gamerock RTX 3080", url: "https://pikabu.ru/story/videokarta_s_samorezami_veselyiy_remont_gamerock_rtx_3080_12172869", img: IMG.board },
]

const FAQ_FALLBACK = [
  { q: "Можно просто приехать и забрать?", a: "Да. В Новокосино собираем и продаём, в Беляево чиним. Оба адреса открыты каждый день с 11 до 21." },
  { q: "А если железо не выдержит тест?", a: "Тогда оно к вам не поедет. Меняем, гоняем заново и в отчёте пишем, что именно пошло не так." },
  { q: "Можно прийти со своим списком?", a: "Конечно. Прогоним через нашу базу: сокеты, длина карты, питание. Если что-то не встанет — скажем сразу, а не после оплаты." },
  { q: "Откуда вы знаете, что ставить?", a: "Своя база: тирлисты, совместимость, живые ремонты. Конфиг не с потолка — из того, что сами гоняли и чинили." },
  { q: "Какая гарантия?", a: "На комплектующие — как у поставщика, на сборку и на ремонт — наша, по документам." },
]

const CONTACTS = [
  { k: "сборка и продажа", t: "Новокосино", tel: "+7 910 307-04-99", img: IMG.goldRig, pos: "object-top" },
  { k: "ремонт", t: "Беляево", tel: "+7 960 029-69-98", img: IMG.solder },
]

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loaded<T> = { items: T[]; done: boolean }
const empty = <T,>(): Loaded<T> => ({ items: [], done: false })

function parseTs(v: unknown) {
  const s = String(v || "").trim()
  if (!s) return 0
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z")
  return Number.isFinite(t) ? t : 0
}
function byNewest(a: any, b: any) {
  const d = parseTs(b.created_at) - parseTs(a.created_at)
  return d || (Number(b.id) || 0) - (Number(a.id) || 0)
}

function SectionHead({ n, kicker, title, lead }: { n: number; kicker: string; title: ReactNode; lead?: string }) {
  return (
    <Reveal>
      <div className="mb-8 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em]">
        <span className="text-red-400">{String(n).padStart(2, "0")}</span>
        <span className="h-px w-8 bg-red-500/60" />
        <span className="text-white/50">{kicker}</span>
      </div>
      <h2 className="max-w-3xl text-[2rem] font-light leading-[1.05] tracking-tight sm:text-6xl">{title}</h2>
      {lead && <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/55 sm:text-base">{lead}</p>}
    </Reveal>
  )
}

function Section({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`relative scroll-mt-16 px-5 py-20 sm:px-8 sm:py-28 ${className}`}>
      <div className="relative mx-auto max-w-6xl">{children}</div>
    </section>
  )
}

function Btn({ to, children, ghost, white, href }: { to?: string; children: ReactNode; ghost?: boolean; white?: boolean; href?: string }) {
  const navigate = useNavigate()
  const cls = white
    ? "inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-sm font-semibold text-black transition hover:bg-white/85 active:scale-[0.98]"
    : ghost
      ? "inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/[0.03] px-6 py-4 text-sm font-medium text-white backdrop-blur transition hover:border-white/40 hover:bg-white/10"
      : "inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 py-4 text-sm font-semibold text-white transition hover:bg-red-500 active:scale-[0.98]"
  const inner = (
    <>
      {children}
      <span aria-hidden className="transition-transform group-hover:translate-x-1">
        →
      </span>
    </>
  )
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`group ${cls}`}>
      {inner}
    </a>
  ) : (
    <button onClick={() => to && navigate(to)} style={{ cursor: "pointer" }} className={`group ${cls}`}>
      {inner}
    </button>
  )
}

function Rail({ children, cols = "sm:grid-cols-3" }: { children: ReactNode; cols?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:gap-4 ${cols}`}>{children}</div>
  )
}

function PhotoCard({ img, onClick, href, className = "", aspect = "aspect-[4/5]", children, badge }: { img?: string; onClick?: () => void; href?: string; className?: string; aspect?: string; children: ReactNode; badge?: ReactNode }) {
  const body = (
    <div className={`relative ${aspect} overflow-hidden bg-white/5`}>
      {img && <img src={img} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-110" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
      {badge && <div className="absolute left-3 top-3 z-[3]">{badge}</div>}
      <div className="absolute inset-x-0 bottom-0 z-[3] p-4">{children}</div>
    </div>
  )
  const cls = `wl-spot group block w-full shrink-0 snap-start overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 text-left transition duration-300 hover:-translate-y-1 hover:border-white/25 ${className}`
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" onPointerMove={spot} className={cls}>
      {body}
    </a>
  ) : (
    <button onClick={onClick} onPointerMove={spot} style={{ cursor: "pointer" }} className={cls}>
      {body}
    </button>
  )
}

function LoadBar({ k, v, delay }: { k: string; v: number; delay: number }) {
  const { ref, seen } = useSeen(0.4)
  return (
    <div ref={ref}>
      <div className="mb-1.5 flex justify-between font-mono text-[11px] text-white/55">
        <span>{k}</span>
        <span>{seen ? v : 0}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-red-600 via-orange-500 to-amber-300 transition-[width] duration-[1600ms] ease-out"
          style={{ width: seen ? `${v}%` : "0%", transitionDelay: `${delay}ms` }}
        />
      </div>
    </div>
  )
}

type FeedItem = { id: number; name: string; img: string }

function PhoneFeed({ items, fallback, onOpen }: { items: FeedItem[]; fallback: string; onOpen: () => void }) {
  const { ref, seen } = useSeen<HTMLButtonElement>(0.35)
  const [idx, setIdx] = useState(0)
  const total = Math.max(items.length, 1)
  useEffect(() => {
    if (!seen || items.length < 2 || reducedMotion()) return
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 3200)
    return () => clearInterval(t)
  }, [seen, items.length])
  const list = items.length ? items : [{ id: 0, name: "Лента сборок", img: fallback }]
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-10 rounded-full bg-red-600/25 blur-3xl wl-blob" />
      <button
        ref={ref}
        onClick={onOpen}
        style={{ cursor: "pointer" }}
        className="relative aspect-[9/16] w-[min(20rem,78vw)] overflow-hidden rounded-[2.2rem] border-[5px] border-neutral-800 bg-black text-left shadow-2xl sm:w-80"
      >
        <div className="absolute inset-0 overflow-hidden">
          {list.map((it, i) => (
            <div key={it.id} className="absolute inset-0 transition-transform duration-700 ease-[cubic-bezier(.22,1,.36,1)]" style={{ transform: `translateY(${(i - idx) * 100}%)` }}>
              <img src={it.img} alt="" loading="lazy" className="h-full w-full object-contain object-center" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/80 to-transparent" />
              <div className="absolute inset-x-4 bottom-5">
                <p className="line-clamp-2 text-sm font-medium">{it.name}</p>
                <p className="mt-1 font-mono text-[10px] text-white/55">последние со стола</p>
              </div>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute left-1/2 top-2 h-5 w-20 -translate-x-1/2 rounded-full bg-black" />
        {list.length > 1 && (
          <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2 py-0.5 font-mono text-[10px] text-white/70 backdrop-blur">
            {idx + 1} / {total}
          </span>
        )}
      </button>
    </div>
  )
}

function RunTimer() {
  const { ref, seen } = useSeen<HTMLSpanElement>(0.4)
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!seen) return
    const t = setInterval(() => setS((x) => (x >= 3000 ? 0 : x + 7)), 50)
    return () => clearInterval(t)
  }, [seen])
  const mm = String(Math.floor(s / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return (
    <span ref={ref} className="tabular-nums">
      {mm}:{ss}
    </span>
  )
}

export default function Welcome1() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const heroImg = useRef<HTMLImageElement>(null)
  const heroText = useRef<HTMLDivElement>(null)
  const progress = useRef<HTMLDivElement>(null)
  useParallax(heroImg, heroText, progress)
  const active = useActiveSection(NAV_IDS)

  const [builds, setBuilds] = useState<Loaded<any>>(empty)
  const [articles, setArticles] = useState<Loaded<any>>(empty)
  const [tiers, setTiers] = useState<Loaded<any>>(empty)
  const [faq, setFaq] = useState<any[]>([])
  const [open, setOpen] = useState<number | null>(0)

  useEffect(() => {
    api.builds
      .getAll({ status: "catalog" })
      .then((d: any) => {
        const list = (Array.isArray(d) ? d : d.builds || [])
          .filter((b: any) => !b.parent_id)
          .filter((b: any) => (b.short_video_url || "").trim() || (b.image_urls || []).some(Boolean))
          .sort(byNewest)
          .slice(0, 8)
        setBuilds({ items: list, done: true })
      })
      .catch(() => setBuilds({ items: [], done: true }))
    api.articles
      .getAll({ published: "true", limit: "4" })
      .then((d: any) => setArticles({ items: d.articles || [], done: true }))
      .catch(() => setArticles({ items: [], done: true }))
    api.tier
      .getAll()
      .then((d: any) => {
        const rank = (r: string) => "SABCDF".indexOf(r || "Z")
        const withImg = (d.items || []).filter((x: any) => x.image_url)
        const pick = (r: string) =>
          withImg
            .filter((x: any) => x.tier_rank === r)
            .sort((a: any, b: any) => rank(a.tier_rank) - rank(b.tier_rank))
            .slice(0, 8)
        setTiers({ items: [...pick("S"), ...pick("A"), ...pick("B")], done: true })
      })
      .catch(() => setTiers({ items: [], done: true }))
    api.faq
      .getPublic()
      .then((d: any) => {
        const items = (d.categories || []).flatMap((c: any) => c.items || []).filter((x: any) => x.question)
        setFaq(items.slice(0, 5))
      })
      .catch(() => {})
  }, [])

  const faqList = faq.length ? faq : FAQ_FALLBACK.map((f, i) => ({ id: i, question: f.q, answer: f.a }))

  const feed = useMemo<FeedItem[]>(
    () =>
      builds.items
        .map((b: any) => ({ id: b.id, name: b.name, img: b.image_urls?.[0] ? b.image_urls[0] : "" }))
        .filter((x: FeedItem) => x.img),
    [builds.items],
  )

  const articleCards = articles.items.length
    ? articles.items.map((a: any, i: number) => ({
        key: `a${a.id}`,
        title: a.title,
        img: a.image_url ? a.image_url : ARTICLE_FALLBACK_IMGS[i + 2],
        to: `/articles/${a.id}` as string | undefined,
        href: undefined as string | undefined,
      }))
    : PIKABU.map((p) => ({ key: p.url, title: p.title, img: p.img, to: undefined as string | undefined, href: p.url as string | undefined }))

  return (
    <div className="min-h-dvh overflow-x-clip bg-black text-white selection:bg-red-500/40">
      <style>{CSS}</style>
      <Seo title="BeGraphics — сборка, ремонт и комплектующие для ПК" path="/" />

      <div ref={progress} className="fixed inset-x-0 top-0 z-[70] h-[2px] origin-left scale-x-0 bg-gradient-to-r from-red-600 via-orange-400 to-amber-200" />

      <Link
        to="/home"
        className="fixed right-4 top-4 z-[60] inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/50 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition hover:border-red-500/60 hover:bg-red-600/80 sm:right-6 sm:top-5"
      >
        Перейти на сайт
        <span aria-hidden className="transition group-hover:translate-x-0.5">→</span>
      </Link>

      <nav className="fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-2 lg:flex">
        {NAV.map((n) => (
          <a key={n.id} href={`#${n.id}`} className="group flex items-center gap-2">
            <span className={`text-[10px] transition ${active === n.id ? "text-white" : "text-white/0 group-hover:text-white/60"}`}>{n.t}</span>
            <span className={`h-1.5 rounded-full transition-all ${active === n.id ? "w-6 bg-red-500" : "w-1.5 bg-white/30 group-hover:bg-white/60"}`} />
          </a>
        ))}
      </nav>

      <section id="hero" className="relative min-h-dvh overflow-hidden">
        <picture>
          <source media="(max-width: 639px)" srcSet={IMG.benchMobile} />
          <img ref={heroImg} src={IMG.bench} alt="Стенд сборки BeGraphics" className="absolute inset-0 h-full w-full scale-[1.08] object-cover will-change-transform" />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20" />
        <div
          ref={heroText}
          className="relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col justify-end px-5 pb-28 pt-16 will-change-transform sm:justify-center sm:px-8 sm:pb-20 sm:pt-24"
        >
          <h1 className="max-w-3xl text-[2.75rem] font-light leading-[1.02] tracking-tight sm:text-7xl">
            Чиним. Собираем.
            <br />
            <span className="text-white/45">Знаем, что ставить.</span>
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/60 sm:text-lg">Только надёжное железо — из своей базы.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Btn to="/quiz" white>
              Собрать ПК
            </Btn>
            <Btn to="/service" ghost>
              Ремонты
            </Btn>
          </div>
        </div>
      </section>

      <div className="relative z-10 -mt-px border-y border-white/10 bg-gradient-to-r from-red-950/40 via-black to-red-950/40 py-3.5">
        <Marquee
          speed={32}
          items={TICKER.map((t) => (
            <span className="mx-2 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-white/75 sm:px-5 sm:text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              {t}
            </span>
          ))}
        />
      </div>

      <div className="border-b border-white/10 px-5 py-12 sm:px-8">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6">
          {[
            { v: 2, s: "", t: "мастерские в Москве" },
            { v: 50, s: " мин", t: "минимум держим на стенде" },
          ].map((st, i) => (
            <Reveal key={st.t} delay={i * 90}>
              <p className="bg-gradient-to-b from-white to-white/50 bg-clip-text text-4xl font-light tracking-tight text-transparent sm:text-5xl">
                <CountUp to={st.v} suffix={st.s} />
              </p>
              <p className="mt-1 text-xs text-white/45 sm:text-sm">{st.t}</p>
            </Reveal>
          ))}
        </div>
      </div>

      <Section id="who">
        <div className="pointer-events-none absolute -left-40 top-10 h-80 w-80 rounded-full bg-red-600/20 blur-[100px] wl-blob" />
        <SectionHead
          n={1}
          kicker="кто мы"
          title={
            <>
              Сервис, сборка <span className="text-white/40">и своя база</span>
            </>
          }
          lead="Чиним, собираем, ведём базу. Конфиг берём из неё."
        />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {WHO.map((w, i) => (
            <Reveal key={w.t} delay={i * 80}>
              <button onClick={() => navigate(w.to)} style={{ cursor: "pointer" }} className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-white/25">
                <p className="font-mono text-[11px] text-red-400">0{i + 1}</p>
                <p className="mt-2 text-lg font-medium">{w.t}</p>
                <p className="mt-1 text-sm text-white/55">{w.d}</p>
              </button>
            </Reveal>
          ))}
        </div>
        <div className="mt-10">
          <Rail>
            {REPAIRS.map((r, i) => (
              <Reveal key={r.t} delay={i * 80}>
                <PhotoCard
                  img={r.img}
                  aspect="aspect-[4/3]"
                  onClick={() => navigate(r.to)}
                  badge={<span className="rounded-full border border-white/20 bg-black/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider backdrop-blur">ремонт</span>}
                >
                  <p className="text-[15px] font-medium sm:text-lg">{r.t}</p>
                  <p className="mt-1 text-sm text-white/60">{r.d}</p>
                </PhotoCard>
              </Reveal>
            ))}
          </Rail>
        </div>
        <Reveal className="mt-8">
          <Btn to="/service" ghost>
            Все ремонты
          </Btn>
        </Reveal>
      </Section>

      <Section id="shop" className="border-t border-white/10 bg-gradient-to-b from-neutral-950 to-black">
        <div className="grid items-end gap-8 lg:grid-cols-[1.1fr_1fr]">
          <SectionHead
            n={2}
            kicker="магазин"
            title={
              <>
                Железо с полки <span className="text-white/40">и под заказ</span>
              </>
            }
            lead="Что есть сейчас и что привезём. Берём то, чему сами доверяем."
          />
          <Reveal from="right" className="hidden lg:block">
            <div className="wl-ring relative overflow-hidden rounded-3xl">
              <img src={IMG.rig} alt="" className="h-56 w-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent" />
            </div>
          </Reveal>
        </div>
        <div className="mt-10 flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {SHOP_CARDS.map((s) => (
              <button key={s.t} onClick={() => navigate(s.to)} style={{ cursor: "pointer" }} className="group w-full overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 text-left">
                <div className="relative aspect-[4/3] overflow-hidden sm:aspect-[16/11]">
                  <img src={s.img} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
                  <p className="absolute inset-x-0 bottom-0 p-4 text-[15px] font-medium sm:text-lg">{s.t}</p>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => navigate("/shop")} style={{ cursor: "pointer" }} className="self-start text-sm text-white/40 transition hover:text-white/70 lg:mb-3 lg:shrink-0 lg:self-end">
            и многое другое
          </button>
        </div>
        <Reveal className="mt-8">
          <Btn to="/shop">Открыть каталог</Btn>
        </Reveal>
      </Section>

      <Section id="config" className="border-t border-white/10">
        <div className="wl-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,#000,transparent_70%)]" />
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHead
              n={3}
              kicker="конфигуратор"
              title={
                <>
                  Конфиг из базы — <span className="text-white/40">не с потолка</span>
                </>
              }
              lead="Сокет, длина, питание — из той же базы. Не встанет — видно сразу."
            />
            <Reveal className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Btn to="/configurator">Открыть конфигуратор</Btn>
              <Btn to="/quiz" ghost>
                Соберите за меня
              </Btn>
            </Reveal>
          </div>
          <Reveal from="zoom">
            <div className="wl-ring relative overflow-hidden rounded-[2rem] border border-white/10 bg-neutral-950">
              <img src={IMG.rig} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-50" />
              <div className="relative space-y-2 p-5 sm:p-7">
                {CONFIG_ROWS.map((r, i) => (
                  <Reveal key={r.k} delay={200 + i * 140} from="left">
                    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/60 px-4 py-3 backdrop-blur">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-white/40">{r.k}</p>
                        <p className="text-sm font-medium">{r.v}</p>
                      </div>
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-sm text-emerald-400">✓</span>
                    </div>
                  </Reveal>
                ))}
                <Reveal delay={950}>
                  <div className="mt-3 flex items-center justify-between rounded-2xl bg-emerald-500/10 px-4 py-3 font-mono text-xs text-emerald-300">
                    <span>всё встаёт</span>
                    <span>запас блока 28%</span>
                  </div>
                </Reveal>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      <Section id="stress" className="overflow-hidden border-t border-white/10 bg-[radial-gradient(ellipse_at_80%_20%,rgba(255,60,30,.16),transparent_55%)]">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <SectionHead
              n={4}
              kicker="прогон"
              title={
                <>
                  Гоняем до предела — <span className="text-white/40">у себя на стенде</span>
                </>
              }
              lead="Сначала стенд. Тот же тестер можно скачать домой."
            />
            <Reveal className="mt-8 space-y-4">
              <LoadBar k="GPU" v={98} delay={0} />
              <LoadBar k="CPU" v={92} delay={150} />
              <LoadBar k="VRAM" v={81} delay={300} />
            </Reveal>
            <Reveal className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Btn to="/stresstester">Скачать тестер</Btn>
              <Btn to="/feed" ghost>
                Последние прогоны
              </Btn>
            </Reveal>
          </div>
          <Reveal from="right">
            <div className="relative">
              <div className="wl-ring overflow-hidden rounded-[2rem] border border-white/10 shadow-[0_30px_80px_-20px_rgba(255,50,30,.35)]">
                <img src={IMG.hud} alt="Отчёт стресс-теста" loading="lazy" className="w-full object-cover" />
              </div>
              <div className="wl-float absolute -bottom-5 left-4 rounded-2xl border border-white/15 bg-black/80 px-4 py-3 font-mono backdrop-blur sm:-left-6">
                <p className="text-[10px] uppercase tracking-wider text-white/45">прогон</p>
                <p className="text-2xl text-white">
                  <RunTimer />
                </p>
              </div>
              <div className="wl-float absolute -top-4 right-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 font-mono text-xs text-emerald-300 backdrop-blur [animation-delay:1.2s]">
                ● всё живое, держит
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      <Section id="service">
        <SectionHead
          n={5}
          kicker="услуги"
          title={
            <>
              Соберём, починим, <span className="text-white/40">прокачаем</span>
            </>
          }
          lead="Сборка, пайка, апгрейд. Одно место."
        />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 sm:gap-4">
          {SERVICES.map((s, i) => (
            <Reveal key={s.t} delay={(i % 2) * 120}>
              <button
                onClick={() => navigate(s.to)}
                onPointerMove={spot}
                style={{ cursor: "pointer" }}
                className="wl-spot group relative block h-56 w-full overflow-hidden rounded-3xl border border-white/10 text-left sm:h-64"
              >
                <img src={s.img} alt="" loading="lazy" className={`absolute inset-0 h-full w-full object-cover ${"pos" in s ? s.pos : ""} origin-top transition duration-700 group-hover:scale-110`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/10" />
                <div className="absolute inset-x-0 bottom-0 z-[3] p-5">
                  <p className="font-mono text-[11px] text-red-400">0{i + 1}</p>
                  <p className="mt-1 text-xl font-medium">{s.t}</p>
                  <p className="mt-1 max-w-sm text-sm text-white/65">{s.d}</p>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-8">
          <Btn to="/service" ghost>
            Посмотреть ремонты
          </Btn>
        </Reveal>
      </Section>

      <Section id="tiers" className="border-t border-white/10 bg-gradient-to-b from-neutral-950 to-black">
        <div className="pointer-events-none absolute -right-32 top-0 h-80 w-80 rounded-full bg-orange-500/15 blur-[100px] wl-blob" />
        <SectionHead
          n={6}
          kicker="база знаний"
          title={
            <>
              Что брать — <span className="text-white/40">а что обойти</span>
            </>
          }
          lead="Железо по полкам. Из этой базы собираем конфиг."
        />
        <div className="mt-10">
          {tiers.items.length ? (
            <Reveal from="zoom">
              <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950/80 shadow-[0_40px_120px_-40px_rgba(255,60,30,.35)]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                    <span className="ml-3 font-mono text-[11px] text-white/40">begraphics / тирлист</span>
                  </div>
                  <span className="hidden font-mono text-[11px] text-white/30 sm:inline">обновляем по ходу</span>
                </div>
                {["S", "A", "B"].map((rank, ri) => {
                  const row = tiers.items.filter((x: any) => x.tier_rank === rank)
                  if (!row.length) return null
                  const t = TIERS[rank]
                  return (
                    <div key={rank} className="flex border-b border-white/5 last:border-b-0">
                      <div
                        className="relative flex w-16 shrink-0 flex-col items-center justify-center gap-1 px-1 text-center sm:w-36"
                        style={{ background: `linear-gradient(135deg, ${t.color}, ${t.color}bb)` }}
                      >
                        <span className="text-3xl font-black leading-none text-white drop-shadow sm:text-5xl">{rank}</span>
                        <span className="hidden text-[11px] font-medium leading-tight text-white/90 sm:block">{t.title}</span>
                        <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-r from-transparent to-black/20" />
                      </div>
                      <div className="wl-noscroll flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto p-2.5 sm:gap-3 sm:p-3">
                        {row.map((it: any, ii: number) => (
                          <Reveal key={it.id} delay={ri * 120 + ii * 50} className="shrink-0 snap-start">
                            <button
                              onClick={() => navigate("/tier-lists")}
                              style={{ cursor: "pointer" }}
                              title={it.name}
                              className="group relative block w-28 overflow-hidden rounded-2xl bg-white text-left ring-1 ring-black/5 transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,.8)] sm:w-36"
                            >
                              <div className="aspect-square p-2.5">
                                <img src={it.image_url} alt="" loading="lazy" className="h-full w-full object-contain transition duration-500 group-hover:scale-110" />
                              </div>
                              <div className="absolute inset-x-0 bottom-0 translate-y-full bg-black/85 px-2.5 py-2 backdrop-blur transition-transform duration-300 group-hover:translate-y-0">
                                <p className="line-clamp-2 text-[11px] leading-snug text-white">{it.name}</p>
                              </div>
                              <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/80">
                                {it.category?.name}
                              </span>
                            </button>
                          </Reveal>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Reveal>
          ) : (
            <div className="space-y-2">
              {Object.entries(TIERS).map(([rank, t], i) => (
                <Reveal key={rank} delay={i * 70} from="left">
                  <button
                    onClick={() => navigate("/tier-lists")}
                    style={{ cursor: "pointer" }}
                    className="group flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] pr-4 text-left transition hover:border-white/25"
                  >
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center text-xl font-bold text-white" style={{ background: t.color }}>
                      {rank}
                    </span>
                    <span className="flex-1 text-sm sm:text-base">{t.title}</span>
                    <span className="h-1.5 rounded-full opacity-60 transition-all group-hover:opacity-100" style={{ background: t.color, width: `${(6 - i) * 14}px` }} />
                  </button>
                </Reveal>
              ))}
            </div>
          )}
        </div>
        <Reveal className="mt-8">
          <Btn to="/tier-lists">Все тирлисты</Btn>
        </Reveal>
      </Section>

      <Section id="articles" className="border-t border-white/10">
        <SectionHead
          n={7}
          kicker="статьи"
          title={
            <>
              Разборы <span className="text-white/40">с нашего стола</span>
            </>
          }
          lead="Что сами паяли и гоняли. Не чужие обзоры."
        />
        <div className="mt-10">
          {articles.done ? (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              {articleCards.map((a, i) => (
                <Reveal key={a.key} delay={(i % 2) * 120} className={i === 0 ? "sm:row-span-2" : ""}>
                  <PhotoCard
                    img={a.img}
                    href={a.href}
                    onClick={a.to ? () => navigate(a.to!) : undefined}
                    className="w-full"
                    aspect={i === 0 ? "aspect-[4/3] sm:aspect-auto sm:h-full sm:min-h-[26rem]" : "aspect-[4/3] sm:aspect-[16/8]"}
                    badge={
                      <span className="rounded-full border border-white/20 bg-black/50 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider backdrop-blur">{a.href ? "пикабу" : "статья"}</span>
                    }
                  >
                    <p className={`line-clamp-3 font-medium leading-snug ${i === 0 ? "text-xl sm:text-2xl" : "text-base"}`}>{a.title}</p>
                  </PhotoCard>
                </Reveal>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((k) => (
                <div key={k} className="h-64 animate-pulse rounded-3xl border border-white/5 bg-white/[0.04]" />
              ))}
            </div>
          )}
        </div>
        <Reveal className="mt-8">
          <Btn to="/articles" ghost>
            Все статьи
          </Btn>
        </Reveal>
      </Section>

      <Section id="feed" className="overflow-hidden border-t border-white/10 bg-gradient-to-br from-red-950/30 via-black to-black">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHead
              n={8}
              kicker="лента"
              title={
                <>
                  Что сейчас <span className="text-white/40">на столе</span>
                </>
              }
              lead="Последние сборки. Та же лента, что в шортсах."
            />
            <Reveal className="mt-8">
              <Btn to="/feed">Открыть ленту</Btn>
            </Reveal>
          </div>
          <Reveal from="zoom" className="flex justify-center">
            <PhoneFeed items={feed} fallback={IMG.work} onOpen={() => navigate("/feed")} />
          </Reveal>
        </div>
      </Section>

      <Section id="faq" className="border-t border-white/10">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <SectionHead
              n={9}
              kicker="вопрос-ответ"
              title={
                <>
                  Спрашивают <span className="text-white/40">чаще всего</span>
                </>
              }
            />
            <Reveal className="mt-8 hidden overflow-hidden rounded-3xl border border-white/10 lg:block">
              <img src={IMG.bay} alt="" loading="lazy" className="h-64 w-full object-cover" />
            </Reveal>
          </div>
          <div className="space-y-2">
            {faqList.map((f: any, i: number) => {
              const isOpen = open === i
              return (
                <Reveal key={f.id} delay={i * 60}>
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    style={{ cursor: "pointer" }}
                    className={`block w-full rounded-2xl border px-5 py-4 text-left transition ${isOpen ? "border-red-500/40 bg-red-500/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-[15px] font-medium">{f.question}</p>
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-sm transition-transform duration-300 ${isOpen ? "rotate-45 bg-red-500 text-white" : ""}`}>+</span>
                    </div>
                    <div className={`grid transition-[grid-template-rows] duration-500 ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                      <div className="overflow-hidden">
                        <p className="pt-3 text-sm leading-relaxed text-white/60">{f.answer}</p>
                      </div>
                    </div>
                  </button>
                </Reveal>
              )
            })}
            <Reveal className="pt-6">
              <Btn to="/faq" ghost>
                Все вопросы
              </Btn>
            </Reveal>
          </div>
        </div>
      </Section>

      <Section id="contacts" className="border-t border-white/10 pb-32 sm:pb-28">
        <SectionHead
          n={10}
          kicker="контакты"
          title={
            <>
              Две мастерские <span className="text-white/40">в Москве</span>
            </>
          }
          lead="С 11 до 21. Можно просто заехать и забрать."
        />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 sm:gap-4">
          {CONTACTS.map((c, i) => (
            <Reveal key={c.t} delay={i * 120}>
              <div onPointerMove={spot} className="wl-spot group relative h-60 overflow-hidden rounded-3xl border border-white/10">
                <img src={c.img} alt="" loading="lazy" className={`absolute inset-0 h-full w-full object-cover ${"pos" in c ? c.pos : ""} origin-top opacity-60 transition duration-700 group-hover:scale-110`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" />
                <div className="absolute inset-x-0 bottom-0 z-[3] p-5">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-red-400">{c.k}</p>
                  <p className="mt-1 text-2xl font-medium">{c.t}</p>
                  <a href={`tel:${c.tel.replace(/[^\d+]/g, "")}`} className="mt-2 inline-block font-mono text-sm text-white/75 underline-offset-4 hover:underline">
                    {c.tel}
                  </a>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal from="zoom" className="mt-14">
          <div className="wl-ring relative overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-red-600/25 via-neutral-950 to-black px-6 py-12 text-center sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-red-500/30 blur-3xl wl-blob" />
            <p className="relative text-3xl font-light tracking-tight sm:text-5xl">
              Напишите, что нужно —
              <br />
              <span className="font-semibold">соберём и прогоним</span>
            </p>
            <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Btn to="/quiz">Оставить задачу</Btn>
              <Btn to="/contacts" ghost>
                Как доехать
              </Btn>
            </div>
          </div>
        </Reveal>
      </Section>
    </div>
  )
}