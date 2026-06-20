import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import NotificationBell from "@/components/NotificationBell"
import { useAuth } from "@/store/auth"

// Фото ремонтов (заменишь на реальные)
const REPAIR_PHOTOS = [
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/6f6d5f6b-e34b-4eee-b98a-be7c03da36da.jpg",
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/e63067a5-d1e7-4a55-ba00-6fa851e8f345.jpg",
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/files/8e5b5e70-a7a7-4da1-859c-ac60472f1e07.jpg",
]

const PIKABU_URL = "https://pikabu.ru/@vladimag"
const YANDEX_MAPS_URL = "https://yandex.ru/maps/-/CTApvRnd"
const TELEGRAM_URL = "https://t.me/BeGraphicsCard"
const PHONE = "+7 (960) 029-69-98"
const PHONE_TEL = "+79600296998"

const SERVICES = [
  { icon: "Cpu", title: "Ремонт ПК и ноутбуков", desc: "Диагностика, замена компонентов, восстановление после залития." },
  { icon: "Fan", title: "Чистка и обслуживание", desc: "Чистка от пыли, замена термопасты, профилактика перегрева." },
  { icon: "HardDrive", title: "Апгрейд и сборка", desc: "Подбор и установка комплектующих, перенос данных." },
  { icon: "ShieldCheck", title: "Гарантия на работы", desc: "Официальная гарантия и честная диагностика бесплатно." },
]

export default function Service() {
  const navigate = useNavigate()
  const { isAuthed } = useAuth()
  const [idx, setIdx] = useState(0)
  const paused = useRef(false)

  useEffect(() => {
    document.title = "Сервисный центр BeGraphics — ремонт ПК и ноутбуков"
  }, [])

  useEffect(() => {
    if (REPAIR_PHOTOS.length < 2) return
    const id = setInterval(() => {
      if (!paused.current) setIdx(i => (i + 1) % REPAIR_PHOTOS.length)
    }, 4000)
    return () => clearInterval(id)
  }, [])

  const move = (dir: 1 | -1) => setIdx(i => (i + dir + REPAIR_PHOTOS.length) % REPAIR_PHOTOS.length)

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Шапка */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <NotificationBell />
            {isAuthed() ? (
              <button onClick={() => navigate("/profile")} className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="User" size={16} />
              </button>
            ) : (
              <button onClick={() => navigate("/auth")} className="rounded-full border border-border px-4 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
                Войти
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/15 via-card to-accent/10 p-6 sm:p-10">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Icon name="Wrench" size={28} />
          </span>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">Сервисный центр BeGraphics</h1>
          <p className="mt-3 max-w-2xl text-foreground/60">
            Ремонт и обслуживание компьютеров и ноутбуков любой сложности. Честная диагностика,
            прозрачные цены и гарантия на все работы. Чиним то, от чего отказались другие.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={`tel:${PHONE_TEL}`} className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
              <Icon name="Phone" size={16} /> Позвонить
            </a>
            <a href={TELEGRAM_URL} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border px-6 py-3 text-sm font-semibold hover:border-primary transition-colors">
              <Icon name="Send" size={16} /> Telegram
            </a>
          </div>
        </div>

        {/* Услуги */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((s, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5">
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon name={s.icon as "Cpu"} size={22} />
              </span>
              <h3 className="text-base font-bold">{s.title}</h3>
              <p className="mt-1 text-sm text-foreground/55">{s.desc}</p>
            </div>
          ))}
        </div>

        {/* Карусель фото ремонтов */}
        <div className="mt-10">
          <h2 className="mb-4 text-2xl font-bold">Наши работы</h2>
          <div className="relative overflow-hidden rounded-3xl border border-border"
            onMouseEnter={() => { paused.current = true }} onMouseLeave={() => { paused.current = false }}>
            <div className="relative h-64 sm:h-[28rem]">
              {REPAIR_PHOTOS.map((src, i) => (
                <img key={i} src={src} alt={`Ремонт ${i + 1}`}
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${i === idx ? "opacity-100" : "opacity-0"}`} />
              ))}
            </div>
            <button onClick={() => move(-1)} style={{ cursor: "pointer" }}
              className="absolute left-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors">
              <Icon name="ChevronLeft" size={20} />
            </button>
            <button onClick={() => move(1)} style={{ cursor: "pointer" }}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors">
              <Icon name="ChevronRight" size={20} />
            </button>
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2">
              {REPAIR_PHOTOS.map((_, i) => (
                <button key={i} onClick={() => setIdx(i)} style={{ cursor: "pointer" }}
                  className={`h-2 rounded-full transition-all ${i === idx ? "w-6 bg-white" : "w-2 bg-white/50"}`} />
              ))}
            </div>
          </div>
        </div>

        {/* Статьи с Пикабу + Контакты */}
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Статьи */}
          <div className="lg:col-span-2">
            <h2 className="mb-4 text-2xl font-bold">Истории ремонтов на Пикабу</h2>
            <a href={PIKABU_URL} target="_blank" rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 hover:border-primary transition-colors">
              <span className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon name="BookOpen" size={22} />
                </span>
                <span>
                  <span className="block font-semibold">Все наши истории ремонтов</span>
                  <span className="block text-sm text-foreground/55">Читайте подробные разборы на нашем профиле Пикабу</span>
                </span>
              </span>
              <Icon name="ExternalLink" size={18} className="shrink-0 text-foreground/40" />
            </a>
          </div>

          {/* Контакты и адрес */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-4 text-xl font-bold">Контакты</h2>
            <div className="space-y-3 text-sm">
              <a href={YANDEX_MAPS_URL} target="_blank" rel="noreferrer" className="flex items-start gap-3 hover:text-primary transition-colors">
                <Icon name="MapPin" size={18} className="mt-0.5 shrink-0 text-primary" />
                <span>Мы на Яндекс.Картах — открыть маршрут</span>
              </a>
              <a href={`tel:${PHONE_TEL}`} className="flex items-center gap-3 hover:text-primary transition-colors">
                <Icon name="Phone" size={18} className="shrink-0 text-primary" />
                {PHONE}
              </a>
              <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:text-primary transition-colors">
                <Icon name="Send" size={18} className="shrink-0 text-primary" />
                @BeGraphicsCard
              </a>
              <div className="flex items-start gap-3">
                <Icon name="Clock" size={18} className="mt-0.5 shrink-0 text-primary" />
                <span>Ежедневно с 11:00 до 21:00</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}