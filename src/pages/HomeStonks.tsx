import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import OptimizedImage from "@/components/ui/optimized-image"
import { api } from "@/lib/api"
import CatalogTabs from "@/components/CatalogTabs"
import SiteHeader from "@/components/SiteHeader"
import Footer from "@/components/Footer"
import Seo from "@/components/Seo"

interface CommunityBuild {
  id: number
  name: string
  username?: string
  total_price?: number
  share_token?: string
  short_code?: string
  created_at: string
}
interface Article {
  id: number
  title: string
  created_at: string
  category?: string
  slug?: string
  image_url?: string | null
}
interface HomePromo {
  id: number
  code: string
  title: string | null
  description: string | null
  scope: string
  discount_type: string
  discount_value: number
  min_order_amount: number
  expires_at: string | null
}
interface CatalogBuild {
  id: number
  name: string
  total_price?: number
  assembly_fee?: number
  image_urls?: string[]
  parent_id?: number | null
  components?: Array<{ price?: number; current_price?: number; qty?: number }>
  created_at?: string
  in_stock?: boolean
  reserved?: boolean
  sell_with_vat?: boolean
}

const CDN = "https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/optimized"
// Каждый баннер — лёгкий WebP в 3 размерах. Браузер сам выбирает нужный по srcset.
const makeBanner = (slug: string) => ({
  src: `${CDN}/${slug}-768.webp`,
  srcSet: `${CDN}/${slug}-480.webp 480w, ${CDN}/${slug}-768.webp 768w, ${CDN}/${slug}-1024.webp 1024w`,
})
const BANNER_PODBOR = makeBanner("banner-podbor")
const BANNER_SBORKA = makeBanner("banner-sborka")
const BANNER_RAZGON = makeBanner("banner-razgon")

const fmtPrice = (n?: number) => (n ? Math.round(n).toLocaleString("ru-RU") + " ₽" : "—")
const fmtDate = (s: string) => {
  if (!s) return ""
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z")
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}


export default function HomeStonks() {
  const navigate = useNavigate()
  const [builds, setBuilds] = useState<CommunityBuild[]>([])
  const [catalogBuilds, setCatalogBuilds] = useState<CatalogBuild[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [articles, setArticles] = useState<Article[]>([])
  const [artIdx, setArtIdx] = useState(0)
  const artPaused = useRef(false)
  const [quizInProgress, setQuizInProgress] = useState(false)
  const [promos, setPromos] = useState<HomePromo[]>([])
  const [copiedPromo, setCopiedPromo] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("begraphics_quiz_progress") || "{}")
      const has = (saved.answers && Object.keys(saved.answers).length) || saved.phone || saved.name || (saved.step ?? 0) > 0
      setQuizInProgress(!!has)
    } catch { /* ignore */ }
  }, [])

  const goArticle = (dir: 1 | -1) => setArtIdx(i => (i + dir + articles.length) % articles.length)

  useEffect(() => { setArtIdx(0) }, [articles.length])

  useEffect(() => {
    if (articles.length < 2) return
    const id = setInterval(() => {
      if (!artPaused.current) setArtIdx(i => (i + 1) % articles.length)
    }, 5000)
    return () => clearInterval(id)
  }, [articles.length])

  const activeDot = artIdx

  useEffect(() => {
    api.auth.getCommunityBuilds()
      .then(d => {
        const list: CommunityBuild[] = d.builds || []
        list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        setBuilds(list.slice(0, 4))
      }).catch(() => {})
    api.articles.getAll({ published: "true", limit: "10" })
      .then(d => {
        const list: Article[] = d.articles || []
        list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        setArticles(list.slice(0, 5))
      }).catch(() => {})
    api.builds.getAll({ status: "catalog" })
      .then(data => {
        const all: CatalogBuild[] = Array.isArray(data) ? data : (data.builds || [])
        const roots = all.filter(b => !b.parent_id)
        roots.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        setCatalogBuilds(roots.slice(0, 3))
      }).catch(() => {})
      .finally(() => setCatalogLoading(false))
    api.promos.getPublic()
      .then(d => setPromos((d.promos || []).slice(0, 4)))
      .catch(() => {})
  }, [])

  const copyPromo = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopiedPromo(code)
    setTimeout(() => setCopiedPromo(c => (c === code ? null : c)), 1800)
  }
  const promoDiscount = (p: HomePromo) =>
    p.discount_type === "percent" ? `−${p.discount_value}%` : `−${fmtPrice(p.discount_value)}`

  const buildPrice = (b: CatalogBuild) => {
    // current_price подставлен бэкендом с учётом lock_prices; учитываем qty и НДС
    const parts = (b.components || []).reduce((s, c) => s + ((c.current_price ?? c.price) || 0) * (c.qty || 1), 0)
    const base = parts + (b.assembly_fee || 0)
    return b.sell_with_vat ? Math.ceil(base * 1.22 / 250) * 250 : base
  }

  const Banner = ({ img, title, to, imgPos, priority }: { img: { src: string; srcSet: string }; title: string; to: string; imgPos?: string; priority?: boolean }) => (
    <button onClick={() => navigate(to)} style={{ cursor: "pointer" }}
      className="group relative h-[280px] overflow-hidden rounded-2xl border border-border sm:h-48">
      <img src={img.src} srcSet={img.srcSet} sizes="(max-width: 640px) 100vw, 33vw"
        alt={title} style={{ objectPosition: imgPos }} width={768} height={280}
        loading={priority ? "eager" : "lazy"}
        // @ts-expect-error fetchpriority — валидный HTML-атрибут, ускоряет загрузку LCP-картинки
        fetchpriority={priority ? "high" : "low"}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      <span className="absolute inset-0 flex items-center justify-center px-4 py-3 text-center text-2xl font-extrabold leading-tight text-white [text-shadow:_0_2px_8px_rgb(0_0_0_/_90%)] sm:text-3xl">
        {title}
      </span>
    </button>
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo
        title="BeGraphics — сборка, ремонт и комплектующие для ПК"
        description="Профессиональная сборка ПК, ремонт и диагностика, продажа комплектующих. Готовые сборки под любой бюджет и каталог железа."
        path="/"
      />
      {/* Базовая шапка сайта (единый вид, как в /shop) */}
      <SiteHeader />

      {/* Навигационные табы */}
      <CatalogTabs />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Три баннера */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Banner img={BANNER_PODBOR} title="Покупка комплектующих" to="/shop" priority />
          <Banner img={BANNER_SBORKA} title="Заказать сборку ПК" to="/builds" />
          <Banner img={BANNER_RAZGON} title="Ремонт и обслуживание" to="/service" imgPos="center 80%" />
        </div>

        {/* Основной грид: контент слева + сайдбар справа */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Левая колонка — CTA */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-card to-accent/10 p-6 sm:p-8">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Icon name="Cpu" size={24} />
              </span>
              <h2 className="text-2xl font-bold leading-tight sm:text-3xl">
                Подобрать конфигурацию ПК под ваши задачи можно тут
              </h2>
              <p className="text-foreground/60">
                Игры, работа, монтаж или сервер — соберём оптимальную конфигурацию по вашему бюджету.
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button onClick={() => navigate("/quiz")} style={{ cursor: "pointer" }}
                  className="btn-tilt flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                  {quizInProgress ? "Продолжить подбор" : "Подобрать ПК"} <Icon name="ArrowRight" size={16} />
                </button>
                {quizInProgress && (
                  <button onClick={() => navigate("/quiz")} style={{ cursor: "pointer" }}
                    className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                    <Icon name="History" size={15} />
                    Вы начали заполнять анкету — можно продолжить
                  </button>
                )}
              </div>
            </div>

            {/* Резерв места пока грузятся сборки — чтобы контент не «прыгал» (CLS) */}
            {catalogLoading && catalogBuilds.length === 0 && (
              <div>
                <div className="mb-3 h-7 w-44 animate-pulse rounded bg-muted" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-[280px] animate-pulse rounded-2xl border border-border bg-muted sm:h-64" />
                  ))}
                </div>
              </div>
            )}

            {/* Последние сборки из «Наши ПК» */}
            {catalogBuilds.length > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xl font-bold">Последние сборки</h3>
                  <button onClick={() => navigate("/builds")} style={{ cursor: "pointer" }}
                    className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    Все ПК <Icon name="ArrowRight" size={15} />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {catalogBuilds.map(b => {
                    const img = b.image_urls?.[0]
                    return (
                      <button key={b.id} onClick={() => navigate(`/build-preview/${b.id}`)} style={{ cursor: "pointer" }}
                        className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left hover:border-primary/50 transition-colors">
                        <div className="relative aspect-video w-full overflow-hidden">
                          {img ? (
                            <OptimizedImage src={img} alt={b.name} sizes="(max-width: 640px) 100vw, 33vw" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted/80 to-card">
                              <Icon name="Monitor" size={28} className="text-foreground/30" />
                            </div>
                          )}
                          {b.reserved ? (
                            <div
                              className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg cursor-help"
                              title="Другой клиент оформляет покупку этого ПК. Напишите нашим менеджерам, если нужен именно он.">
                              <Icon name="Clock" size={10} />
                              В резерве
                            </div>
                          ) : b.in_stock && (
                            <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full bg-green-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg">
                              <Icon name="CheckCircle" size={10} />
                              В наличии
                            </div>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col p-3">
                          <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary transition-colors">{b.name}</p>
                          <p className="mt-2 text-base font-bold">{fmtPrice(buildPrice(b))}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Акции и промокоды */}
            {promos.length > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xl font-bold">Акции и промокоды</h3>
                  <button onClick={() => navigate("/promo")} style={{ cursor: "pointer" }}
                    className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    Все акции <Icon name="ArrowRight" size={15} />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {promos.map(p => (
                    <div key={p.id} className="flex flex-col rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="flex h-12 min-w-12 items-center justify-center rounded-xl bg-primary/15 px-3 text-lg font-bold text-primary">
                          {promoDiscount(p)}
                        </div>
                        {p.scope === "first" && (
                          <span className="rounded-full bg-green-500/15 px-2.5 py-1 text-[11px] font-medium text-green-500">Новичкам</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold leading-snug">{p.title || "Промокод"}</p>
                      {p.description && (
                        <div className="rich-content mt-1 line-clamp-2 text-xs leading-relaxed text-foreground/55"
                          dangerouslySetInnerHTML={{ __html: p.description }} />
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-foreground/45">
                        {p.min_order_amount > 0 && <span>от {fmtPrice(p.min_order_amount)}</span>}
                        {p.expires_at && <span>до {new Date(p.expires_at).toLocaleDateString("ru-RU")}</span>}
                      </div>
                      <button onClick={() => copyPromo(p.code)} style={{ cursor: "pointer" }}
                        className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-dashed border-primary/40 bg-background/40 px-3 py-2 text-left transition-colors hover:border-primary">
                        <span className="font-mono text-sm font-semibold tracking-wider">{p.code}</span>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                          <Icon name={copiedPromo === p.code ? "Check" : "Copy"} size={13} />
                          {copiedPromo === p.code ? "Скопировано" : "Копировать"}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Сайдбар */}
          <div className="space-y-6">
            {/* Сборки пользователей */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <h3 className="mb-3 text-base font-bold">Сборки пользователей</h3>
              <div className="space-y-2.5">
                {builds.length === 0 ? (
                  <p className="py-4 text-center text-sm text-foreground/40">Пока нет сборок</p>
                ) : builds.map(b => (
                  <button key={b.id} onClick={() => navigate(b.short_code ? `/s/${b.short_code}` : `/configurator?build=${b.share_token}`)} style={{ cursor: "pointer" }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border-b border-border/60 pb-2.5 text-left last:border-0 last:pb-0 hover:text-primary transition-colors">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{b.name || b.username || "Сборка"}</p>
                      <p className="text-xs text-foreground/40">{fmtDate(b.created_at)}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtPrice(b.total_price)}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => navigate("/community-builds")} style={{ cursor: "pointer" }}
                className="mt-3 w-full rounded-lg border border-border py-2 text-sm font-medium text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
                Посмотреть все
              </button>
            </div>

            {/* Последние статьи */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-bold">Последние статьи</h3>
                <button onClick={() => navigate("/articles")} style={{ cursor: "pointer" }}
                  className="text-sm font-medium text-foreground/60 hover:text-primary transition-colors">
                  Все статьи
                </button>
              </div>
              {articles.length === 0 ? (
                <p className="py-4 text-center text-sm text-foreground/40">Пока нет статей</p>
              ) : (
                <div className="group/car relative"
                  onMouseEnter={() => { artPaused.current = true }}
                  onMouseLeave={() => { artPaused.current = false }}>
                  <div className="relative h-[280px] w-full overflow-hidden rounded-xl border border-border bg-muted sm:h-56">
                    {articles.map((a, i) => (
                      <button key={i} onClick={() => navigate(`/articles/${a.id}`)} style={{ cursor: "pointer", opacity: i === artIdx ? 1 : 0 }}
                        className={`group absolute inset-0 block w-full text-left transition-opacity duration-700 ${i === artIdx ? "" : "pointer-events-none"}`}
                        tabIndex={i === artIdx ? 0 : -1}>
                        {a.image_url ? (
                          <OptimizedImage src={a.image_url} alt={a.title} sizes="(max-width: 1024px) 100vw, 340px"
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Icon name="FileText" size={36} className="text-foreground/15" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-8">
                          <p className="text-xs text-white/60">{fmtDate(a.created_at)}</p>
                          <p className="line-clamp-2 text-sm font-medium text-white">{a.title}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  {articles.length > 1 && (
                    <>
                      <button onClick={() => goArticle(-1)} style={{ cursor: "pointer" }} aria-label="Назад"
                        className="absolute left-1 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/80 text-foreground shadow-md opacity-0 backdrop-blur transition-opacity group-hover/car:opacity-100 hover:bg-background">
                        <Icon name="ChevronLeft" size={18} />
                      </button>
                      <button onClick={() => goArticle(1)} style={{ cursor: "pointer" }} aria-label="Вперёд"
                        className="absolute right-1 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/80 text-foreground shadow-md opacity-0 backdrop-blur transition-opacity group-hover/car:opacity-100 hover:bg-background">
                        <Icon name="ChevronRight" size={18} />
                      </button>
                      <div className="mt-3 flex justify-center gap-1.5">
                        {articles.map((_, i) => (
                          <button key={i} onClick={() => setArtIdx(i)} style={{ cursor: "pointer" }} aria-label={`Статья ${i + 1}`}
                            className={`h-1.5 rounded-full transition-all ${i === activeDot ? "w-4 bg-primary" : "w-1.5 bg-foreground/20"}`} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}