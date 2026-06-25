import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import NotificationBell from "@/components/NotificationBell"
import Footer from "@/components/Footer"
import { useAuth } from "@/store/auth"

// Фото наших работ
const REPAIR_PHOTOS = [
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/808b8b3c-9619-472f-a9a3-097decedec20.jpeg",
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/67eef1e4-07a9-4cff-b1da-ff045a75b61f.jpg",
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/5d4da50e-c287-4b2b-98d3-732c0e5fa7b9.jpg",
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/2ecd28b0-5720-465d-9e1a-1e15239f2b34.jpg",
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/cd91f011-25b9-4aa9-9de5-5741a2511beb.jpg",
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/50b13ef2-6dd4-4d41-8bb1-2d0f862dbe20.jpg",
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/93c263ee-3512-4c6f-b42d-86c8240c169a.jpg",
  "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/1aabcdb0-f5d7-4b3a-ae8a-5995c0323881.png",
]

const PIKABU_URL = "https://pikabu.ru/@vladimag"

// Статьи с нашего Пикабу
const PIKABU_ARTICLES = [
  { title: "Правильное отключение фаз питания видеокарты — ремонт Thunderobot Zero на RTX 4080", url: "https://pikabu.ru/story/pravilnoe_otklyuchenie_faz_pitaniya_videokartyi_remont_thunderobot_zero_na_grafike_rtx_4080_13452933" },
  { title: "RTX 4090 48 ГБ — возможно, первая модификация из RTX 4090 24 в 48 ГБ в РФ", url: "https://pikabu.ru/story/rtx_4090_48_gb_vozmozhno_pervaya_modifikatsiya_iz_rtx_4090_24_v_48_gb_v_rf_12934738" },
  { title: "Типовая неисправность ноутбуков ASUS Strix G15/G17 — ремонт платформы G513/G533/G713/G733", url: "https://pikabu.ru/story/tipovaya_neispravnost_noutbukov_asus_strix_g15__g17_ili_ryadovoy_remont_platformyi_g513g533g713g733_12593328" },
  { title: "Сложный ремонт Lenovo Legion — почему не стоит нести ноутбуки в ремонт «у дома»", url: "https://pikabu.ru/story/slozhnyiy_remont_lenovo_legion_pochemu_ne_stoit_nesti_noutbuki_v_remont_u_doma_12403955" },
  { title: "Lenovo Legion в ремонте — почему никто не любит ремонтировать ноутбуки Lenovo", url: "https://pikabu.ru/story/lenovo_legion_v_remonte_pochemu_nikto_ne_lyubit_remontirovat_noutbuki_lenovo_12364250" },
  { title: "Ремонт первых RTX, или ошибка производства", url: "https://pikabu.ru/story/remont_pervyikh_rtx_ili_oshibka_proizvodstva_12295440" },
  { title: "Видеокарта с саморезами — весёлый ремонт Gamerock RTX 3080", url: "https://pikabu.ru/story/videokarta_s_samorezami_veselyiy_remont_gamerock_rtx_3080_12172869" },
  { title: "Можно ли собрать видеокарту с нуля? Самая быстрая RTX 4090 в мире", url: "https://pikabu.ru/story/mozhno_li_sobrat_videokartu_s_nulya_samaya_byistraya_rtx_4090_v_mire_12006408" },
  { title: "Интересный апгрейд игрового ноутбука — из 3060 в 3080, всё ли так просто", url: "https://pikabu.ru/story/chto_mozhno_sdelat_iz_igrovogo_noutbuka_interesnyiy_apgreyd_iz_noutbuchnoy_3060_v_3080_vsyo_li_tak_prosto_11806888" },
  { title: "Ozon со стороны продавца — кто важнее: покупатель или продавец", url: "https://pikabu.ru/story/ozon_so_storonyi_prodavtsa_kto_vazhnee__pokupatel_ili_prodavets_11672863" },
  { title: "Ремонт ноутбука MSI Pulse и вторая жизнь — можно ли впихнуть невпихуемое", url: "https://pikabu.ru/story/remont_noutbuka_msi_pulse_i_vtoraya_zhizn_mozhno_li_vpikhnut_nevpikhuemoe_11653121" },
  { title: "Японская красавица Sakura RTX 3070 и что такое китайские видеокарты", url: "https://pikabu.ru/story/yaponskaya_krasavitsa_sakura_rtx_3070_i_chto_takoe_kitayskie_videokartyi_11424847" },
  { title: "Брак охлаждения видеокарт Palit", url: "https://pikabu.ru/story/brak_okhlazhdeniya_videokart_palit_11311821" },
]

const YANDEX_MAPS_URL = "https://yandex.ru/maps/-/CTApvRnd"
const TELEGRAM_URL = "https://t.me/BeGraphicsCard"
const PHONE = "+7 (960) 029-69-98"
const PHONE_TEL = "+79600296998"

const SERVICES = [
  { icon: "Cpu", title: "Ремонт ПК и ноутбуков", desc: "Диагностика, замена компонентов, восстановление после залития." },
  { icon: "Fan", title: "Обслуживание видеокарт и ноутбуков", desc: "Любой сложности. В нашем вооружении жидкий металл, фазовый переход, топовые термопрокладки и золотые руки мастеров. Гарантия на хорошие температуры — 1 год." },
  { icon: "HardDrive", title: "Апгрейд и сборка", desc: "Подбор и установка комплектующих, перенос данных." },
  { icon: "ShieldCheck", title: "Гарантия на работы", desc: "Официальная и честная гарантия. Диагностика оплачивается только в случае отказа от ремонта." },
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
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* Левая часть — текст + кнопки */}
            <div className="lg:col-span-2">
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

            {/* Правая часть — контакты */}
            <div className="rounded-2xl border border-border bg-card/70 p-5 backdrop-blur">
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
            <div className="relative h-80 sm:h-[40rem]">
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

        {/* Статьи с Пикабу */}
        <div className="mt-10">
          <h2 className="mb-4 text-2xl font-bold">Истории ремонтов на Пикабу</h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {PIKABU_ARTICLES.map((a, i) => (
              <a key={i} href={a.url} target="_blank" rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary transition-colors">
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon name="BookOpen" size={18} />
                  </span>
                  <span className="font-medium leading-snug">{a.title}</span>
                </span>
                <Icon name="ExternalLink" size={16} className="shrink-0 text-foreground/40" />
              </a>
            ))}
          </div>
          <a href={PIKABU_URL} target="_blank" rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
            Все статьи на нашем Пикабу <Icon name="ArrowRight" size={15} />
          </a>
        </div>
      </div>
      <Footer />
    </div>
  )
}