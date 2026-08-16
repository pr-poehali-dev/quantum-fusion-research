import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import StressTesterLink from "@/components/StressTesterLink"
import NotificationBell from "@/components/NotificationBell"
import Footer from "@/components/Footer"
import YandexMap from "@/components/YandexMap"
import { useAuth } from "@/store/auth"

interface Office {
  title: string
  subtitle: string
  icon: string
  address: string
  /** Координаты "широта,долгота" для точной метки на карте. */
  coords?: string
  mapsUrl: string
  phone: string
  phoneTel: string
  telegram: string
  telegramUrl: string
  hours: string
}

const OFFICES: Office[] = [
  {
    title: "Офис Новокосино",
    subtitle: "Сборка и продажа ПК и комплектующих",
    icon: "Cpu",
    address: "г. Москва, Новокосино",
    // Координаты взяты из фирменной ссылки Яндекс.Карт (карточка организации).
    coords: "55.740471,37.859300",
    mapsUrl: "https://yandex.ru/maps/org/begraphics/125515077401/",
    phone: "+7 (910) 307-04-99",
    phoneTel: "+79103070499",
    telegram: "@BeGraphicsPC",
    telegramUrl: "https://t.me/BeGraphicsPC",
    hours: "Ежедневно с 11:00 до 21:00",
  },
  {
    title: "Офис Беляево",
    subtitle: "Ремонт и обслуживание",
    icon: "Wrench",
    address: "г. Москва, Беляево",
    coords: "55.645473,37.525418",
    mapsUrl: "https://yandex.ru/maps/org/begraphics/76615498407/",
    phone: "+7 (960) 029-69-98",
    phoneTel: "+79600296998",
    telegram: "@BeGraphicsCard",
    telegramUrl: "https://t.me/BeGraphicsCard",
    hours: "Ежедневно с 11:00 до 21:00",
  },
]

export default function Contacts() {
  const navigate = useNavigate()
  const { isAuthed } = useAuth()

  useEffect(() => {
    document.title = "Контакты — BeGraphics"
  }, [])

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
            <StressTesterLink />
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

      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {/* Заголовок + пояснение */}
        <h1 className="text-3xl font-bold sm:text-4xl">Контакты</h1>
        <p className="mt-3 max-w-3xl text-foreground/60">
          У нас два офиса. <span className="font-medium text-foreground">Новокосино</span> — сборка и продажа
          ПК и комплектующих. <span className="font-medium text-foreground">Беляево</span> — ремонт и
          обслуживание техники.
        </p>

        {/* Два бокса офисов */}
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          {OFFICES.map((o, i) => (
            <div key={i} className="flex flex-col rounded-2xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon name={o.icon as "Cpu"} size={24} />
                </span>
                <div>
                  <h2 className="text-lg font-bold">{o.title}</h2>
                  <p className="text-sm text-foreground/55">{o.subtitle}</p>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <Icon name="MapPin" size={18} className="mt-0.5 shrink-0 text-primary" />
                  <span>{o.address}</span>
                </div>
                <a href={`tel:${o.phoneTel}`} className="flex items-center gap-3 hover:text-primary transition-colors">
                  <Icon name="Phone" size={18} className="shrink-0 text-primary" />
                  {o.phone}
                </a>
                <a href={o.telegramUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:text-primary transition-colors">
                  <Icon name="Send" size={18} className="shrink-0 text-primary" />
                  {o.telegram}
                </a>
                <div className="flex items-start gap-3">
                  <Icon name="Clock" size={18} className="mt-0.5 shrink-0 text-primary" />
                  <span>{o.hours}</span>
                </div>
              </div>

              {/* Карта — снизу карточки, растягивается на остаток высоты */}
              <div className="mt-5">
                <p className="mb-2 text-sm font-medium text-foreground/70">Как добраться</p>
                <YandexMap address={o.address} coords={o.coords} mapsUrl={o.mapsUrl} height={240} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <Footer />
    </div>
  )
}