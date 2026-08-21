import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import Seo from "@/components/Seo"
import Footer from "@/components/Footer"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { Release, fmtSize, fmtDate, groupReleases, editionOf } from "@/components/admin/StressReleasesTab"

// Куда клиент присылает отчёт на разбор.
const HELP_TG = "https://t.me/BeGraphicsPC"

// Профили названы так же, как в самой программе.
const PROFILES = [
  { name: "Экспресс, 30 минут", who: "Быстро убедиться, что с ПК всё в порядке", icon: "Zap" },
  { name: "Основной, 50 минут", who: "Проверка процессора, памяти и видеокарты", icon: "Gauge" },
  { name: "Только видеокарта, 2 часа", who: "Вылеты и артефакты в играх", icon: "Monitor" },
  { name: "Ночной, 12 часов", who: "Редкие сбои, которые ловятся не сразу", icon: "Moon" },
]

const STEPS = [
  { n: 1, title: "Скачайте и запустите", text: "Установка не нужна — программа работает сразу после запуска." },
  { n: 2, title: "Выберите профиль", text: "От быстрой получасовой проверки до ночного прогона — под вашу задачу." },
  { n: 3, title: "Дождитесь результата", text: "Компьютер отработает под полной нагрузкой, вы увидите вердикт и отчёт." },
  { n: 4, title: "Пришлите отчёт нам", text: "Если тест нашёл проблему — разберём отчёт и подскажем, что делать." },
]

export default function StressTesterDownload() {
  const navigate = useNavigate()
  const [releases, setReleases] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)
  const [showArchive, setShowArchive] = useState(false)

  useEffect(() => {
    api.stressReleases.list()
      .then(d => setReleases(d?.releases || []))
      .catch(() => setReleases([]))
      .finally(() => setLoading(false))
  }, [])

  // Ссылку на файл выдаёт сервер в момент скачивания: для нашего хранилища
  // она временная и подставляет нормальное имя файла, для Яндекс.Диска —
  // страница файла. Открываем в новой вкладке, чтобы сайт не закрывался.
  const [busyId, setBusyId] = useState<number | null>(null)
  const download = async (r: Release) => {
    setBusyId(r.id)
    const res = await api.stressReleases.countDownload(r.id).catch(() => null)
    setBusyId(null)
    const url = res?.file_url || r.file_url
    if (!url) { alert("Версия сейчас недоступна, попробуйте позже"); return }
    setReleases(rs => rs.map(x => x.id === r.id ? { ...x, download_count: x.download_count + 1 } : x))
    window.open(url, "_blank", "noopener,noreferrer")
  }

  // Полная и Lite — одна версия: показываем их вместе, одной карточкой.
  const groups = groupReleases(releases)
  const latestGroup = groups[0]
  const olderGroups = groups.slice(1)
  const pickMain = (items: Release[]) =>
    items.find(x => editionOf(x) === "full") || items[0]
  const latest = latestGroup ? pickMain(latestGroup.items) : undefined

  const scrollToVersions = () => {
    document.getElementById("versions")?.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo
        title="Стресс-тест ПК — проверить стабильность компьютера"
        description="Бесплатная программа для проверки стабильности компьютера: процессор, память и видеокарта под полной нагрузкой. Покажет, стабилен ли ваш ПК, а с отчётом помогут специалисты BeGraphics."
        path="/stresstester"
      />

      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground text-lg font-bold">B</div>
            <span className="text-lg font-semibold">BeGraphics</span>
          </button>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            {latest && (
              <button onClick={() => download(latest)} style={{ cursor: "pointer" }}
                className="hidden items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors sm:flex">
                <Icon name="Download" size={15} />Скачать
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Первый экран: слева текст, справа скриншот программы ── */}
      <section className="mx-auto max-w-6xl px-6 pb-14 pt-12 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Icon name="Gift" size={13} />Бесплатно, без регистрации
            </span>
            <h1 className="mb-4 text-3xl font-light leading-tight sm:text-5xl">
              Ваш компьютер <span className="font-semibold text-primary">стабилен</span>?
              <br />Проверьте за 30 минут
            </h1>
            <p className="mb-6 text-base text-foreground/60 sm:text-lg">
              Игра вылетает, синий экран, зависания без причины — почти всегда виновато железо
              под нагрузкой. Запустите тест: программа доведёт процессор, память и видеокарту
              до предела и покажет честный ответ — стабильно или нет.
            </p>

            {loading ? (
              <p className="text-sm text-foreground/40">Загрузка…</p>
            ) : latest ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button onClick={() => download(latest)} disabled={busyId === latest.id} style={{ cursor: "pointer" }}
                    className="flex items-center justify-center gap-2.5 rounded-xl bg-primary px-7 py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-70">
                    <Icon name="Download" size={20} />
                    {busyId === latest.id ? "Готовим файл…" : "Скачать бесплатно"}
                  </button>
                  <button onClick={scrollToVersions} style={{ cursor: "pointer" }}
                    className="flex items-center justify-center gap-2 rounded-xl border border-border px-6 py-4 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
                    Все версии
                  </button>
                </div>
                <p className="mt-3 text-xs text-foreground/40">
                  Версия {latest.version} · {fmtSize(latest.file_size)} · Windows ·
                  скачали {latest.download_count} раз
                </p>
              </>
            ) : (
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="text-sm text-foreground/60">Программа скоро появится здесь</p>
              </div>
            )}
          </div>

          {/* ФОТО 1 — сборка на стенде (AMD Ryzen), которую прогоняем стресс-тестом */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <img src="https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/3475919d-6b88-451a-8a17-e6e8bfb5793c.jpg"
              alt="Сборка на базе AMD Ryzen на тестовом стенде BeGraphics"
              className="w-full" width={1200} height={800} loading="eager" />
          </div>
        </div>
      </section>

      {/* ── Зачем это нужно ── */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="mb-3 text-2xl font-light sm:text-3xl">Когда стоит проверить компьютер</h2>
          <p className="mb-8 max-w-2xl text-foreground/60">
            Нестабильность почти никогда не приходит с предупреждением. Обычно это выглядит так:
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: "MonitorX", t: "Вылеты из игр", d: "Игра закрывается сама или выкидывает на рабочий стол" },
              { icon: "AlertTriangle", t: "Синий экран", d: "Компьютер перезагружается на ровном месте" },
              { icon: "Snowflake", t: "Зависания", d: "Картинка замирает, помогает только кнопка питания" },
              { icon: "ShoppingCart", t: "Новая покупка", d: "Собрали ПК или взяли с рук — надо убедиться, что всё исправно" },
            ].map(c => (
              <div key={c.t} className="rounded-xl border border-border bg-background p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon name={c.icon} size={19} />
                </div>
                <h3 className="mb-1.5 font-medium">{c.t}</h3>
                <p className="text-sm text-foreground/50">{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Как это работает ── */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="mb-3 text-2xl font-light sm:text-3xl">Как это работает</h2>
        <p className="mb-8 max-w-2xl text-foreground/60">
          Разбираться в тестах не нужно — достаточно выбрать профиль и нажать «Старт».
        </p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(s => (
            <div key={s.n} className="relative rounded-xl border border-border bg-card p-5">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {s.n}
              </span>
              <h3 className="mb-1.5 font-medium">{s.title}</h3>
              <p className="text-sm text-foreground/50">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Профили ── */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="mb-3 text-2xl font-light sm:text-3xl">Выберите профиль под свою задачу</h2>
          <p className="mb-8 max-w-2xl text-foreground/60">
            Чем дольше прогон, тем больше шансов поймать редкий сбой. Для первой проверки
            хватит получаса.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {PROFILES.map(p => (
              <div key={p.name} className="flex items-start gap-4 rounded-xl border border-border bg-background p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon name={p.icon} size={19} />
                </div>
                <div>
                  <h3 className="mb-1 font-medium">{p.name}</h3>
                  <p className="text-sm text-foreground/50">{p.who}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Отчёт: слева скриншот, справа текст ── */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          {/* ФОТО 2 — реальный отчёт программы: вердикт, конфигурация ПК, итоги */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl lg:order-1">
            <img src="https://cdn.poehali.dev/projects/63b26282-df0d-46e2-bce8-199a865a9659/bucket/0d7ce192-1a95-4853-9d77-2c6780517402.png"
              alt="Отчёт стресс-теста: вердикт «Всё в порядке», конфигурация ПК и итоги тестов"
              className="w-full" width={696} height={599} loading="lazy" />
          </div>
          <div className="lg:order-2">
            <h2 className="mb-4 text-2xl font-light sm:text-3xl">Понятный отчёт вместо цифр</h2>
            <p className="mb-6 text-foreground/60">
              В конце вы получаете вердикт простым языком и подробный отчёт: как менялись
              температуры, была ли просадка частот, на каком тесте что-то пошло не так.
            </p>
            <div className="space-y-3">
              {[
                "Стабилен компьютер или нет — коротким ответом",
                "Температуры процессора и видеокарты на всём прогоне",
                "Момент и причина сбоя, если он случился",
                "Файл отчёта, который можно переслать специалисту",
              ].map(t => (
                <div key={t} className="flex items-start gap-2.5">
                  <Icon name="Check" size={17} className="mt-0.5 shrink-0 text-primary" />
                  <span className="text-sm text-foreground/70">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Помощь с результатом ── */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <h2 className="mb-4 text-2xl font-light sm:text-3xl">
                Тест нашёл проблему? Дальше — наша работа
              </h2>
              <p className="mb-4 text-foreground/60">
                Отчёт показывает, <em>что</em> сбоит, но не говорит, <em>почему</em>. Причина
                может быть в перегреве, настройках памяти, нехватке питания или бракованной
                детали — и лечится это по-разному.
              </p>
              <p className="mb-6 text-foreground/60">
                Пришлите нам отчёт — посмотрим и скажем, в чём дело и что с этим делать.
                Разбор бесплатный, мы собираем и обслуживаем компьютеры каждый день
                и такие отчёты читаем постоянно.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <a href={HELP_TG} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2.5 rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                  <Icon name="Send" size={17} />
                  Отправить отчёт на разбор
                </a>
                <button onClick={() => navigate("/contacts")} style={{ cursor: "pointer" }}
                  className="flex items-center justify-center gap-2 rounded-xl border border-border px-6 py-3.5 text-sm text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
                  Контакты и адреса
                </button>
              </div>
            </div>

            {/* ФОТО 3 — мастерская/сборки. Заменить: public/stresstester/shop.png */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
              <img src="/stresstester/shop.png" alt="Мастерская BeGraphics"
                className="w-full" width={1200} height={900} loading="lazy" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Версии ── */}
      <section id="versions" className="mx-auto max-w-3xl px-6 py-14">
        <h2 className="mb-6 text-2xl font-light sm:text-3xl">Скачать программу</h2>

        {loading ? (
          <p className="text-foreground/40">Загрузка…</p>
        ) : !latest ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <Icon name="PackageOpen" size={28} className="mx-auto mb-3 text-foreground/30" />
            <p className="text-foreground/60">Программа скоро появится здесь</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-primary/30 bg-card p-6 shadow-lg sm:p-8">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
                  Актуальная версия
                </span>
                <span className="text-sm text-foreground/50">от {fmtDate(latest.created_at)}</span>
              </div>

              <h3 className="mb-1 text-2xl font-semibold">Версия {latestGroup!.version}</h3>
              <p className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground/50">
                <span className="flex items-center gap-1.5"><Icon name="Download" size={14} />
                  {latestGroup!.items.reduce((n, x) => n + x.download_count, 0)} скачиваний</span>
                <span className="flex items-center gap-1.5"><Icon name="Monitor" size={14} />Windows</span>
              </p>

              {latestGroup!.items.find(x => x.changelog) && (
                <div className="mb-6 rounded-xl border border-border bg-background/50 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/40">Что нового</p>
                  <p className="whitespace-pre-line text-sm text-foreground/70">
                    {latestGroup!.items.find(x => x.changelog)!.changelog}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {latestGroup!.items.map((r, i) => (
                  <button key={r.id} onClick={() => download(r)} disabled={busyId === r.id}
                    style={{ cursor: "pointer" }}
                    className={`flex w-full items-center justify-center gap-2.5 rounded-xl py-4 text-base font-semibold transition-colors disabled:opacity-70 ${i === 0 ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border text-foreground/80 hover:border-primary hover:text-foreground"}`}>
                    <Icon name="Download" size={i === 0 ? 20 : 17} />
                    {busyId === r.id ? "Готовим файл…" : (
                      latestGroup!.items.length > 1
                        ? `${editionOf(r) === "lite" ? "Облегчённая версия" : "Полная версия"} (${fmtSize(r.file_size)})`
                        : `Скачать (${fmtSize(r.file_size)})`
                    )}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-center text-xs text-foreground/40">
                {latestGroup!.items.length > 1
                  ? "Облегчённая версия весит меньше: часть тестов в ней недоступна"
                  : "Файл большой — на медленном интернете загрузка займёт время"}
              </p>
            </div>

            {olderGroups.length > 0 && (
              <div className="mt-6">
                <button onClick={() => setShowArchive(v => !v)} style={{ cursor: "pointer" }}
                  className="flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors">
                  <Icon name={showArchive ? "ChevronUp" : "ChevronDown"} size={15} />
                  Другие версии ({olderGroups.length})
                </button>

                {showArchive && (
                  <div className="mt-3 space-y-2">
                    {olderGroups.map(g => (
                      <div key={g.version} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-medium">Версия {g.version}</span>
                          <span className="text-xs text-foreground/40">{fmtDate(g.items[0].created_at)}</span>
                          <span className="flex items-center gap-1 text-xs text-foreground/40">
                            <Icon name="Download" size={11} />
                            {g.items.reduce((n, x) => n + x.download_count, 0)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {g.items.map(r => (
                            <button key={r.id} onClick={() => download(r)} disabled={busyId === r.id}
                              style={{ cursor: "pointer" }}
                              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors disabled:opacity-60">
                              <Icon name="Download" size={12} />
                              {busyId === r.id ? "Готовим…" : (
                                g.items.length > 1
                                  ? `${editionOf(r) === "lite" ? "Lite" : "Полная"} · ${fmtSize(r.file_size)}`
                                  : `Скачать · ${fmtSize(r.file_size)}`
                              )}
                            </button>
                          ))}
                        </div>
                        {g.items.find(x => x.changelog) && (
                          <p className="mt-2 whitespace-pre-line text-xs text-foreground/50">
                            {g.items.find(x => x.changelog)!.changelog}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <Footer />
    </div>
  )
}