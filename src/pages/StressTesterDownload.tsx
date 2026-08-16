import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import Seo from "@/components/Seo"
import Footer from "@/components/Footer"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { Release, fmtSize, fmtDate } from "@/components/admin/StressReleasesTab"

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

  // Скачивание считаем «в фоне» — счётчик не должен задерживать переход к файлу.
  const download = (r: Release) => {
    api.stressReleases.countDownload(r.id)
    setReleases(rs => rs.map(x => x.id === r.id
      ? { ...x, download_count: x.download_count + 1 } : x))
    window.location.href = r.file_url
  }

  const latest = releases[0]
  const older = releases.slice(1)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo
        title="Стресс-тест ПК — скачать программу"
        description="Бесплатная программа для стресс-теста компьютера от BeGraphics: проверка стабильности процессора, видеокарты и памяти под нагрузкой."
        path="/stresstester"
      />

      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="text-lg font-semibold">BeGraphics</span>
          </button>
          <ThemeSwitcher />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon name="Activity" size={32} />
          </div>
          <h1 className="mb-3 text-3xl font-light sm:text-4xl">Стресс-тест компьютера</h1>
          <p className="mx-auto max-w-xl text-foreground/60">
            Программа проверяет стабильность процессора, видеокарты и памяти под полной нагрузкой
            и показывает температуры. Скачивайте и запускайте — установка не требуется.
          </p>
        </div>

        {loading ? (
          <p className="text-center text-foreground/40">Загрузка…</p>
        ) : !latest ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <Icon name="PackageOpen" size={28} className="mx-auto mb-3 text-foreground/30" />
            <p className="text-foreground/60">Программа скоро появится здесь</p>
          </div>
        ) : (
          <>
            {/* Свежая версия */}
            <div className="rounded-2xl border border-primary/30 bg-card p-6 shadow-lg sm:p-8">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
                  Актуальная версия
                </span>
                <span className="text-sm text-foreground/50">от {fmtDate(latest.created_at)}</span>
              </div>

              <h2 className="mb-1 text-2xl font-semibold">Версия {latest.version}</h2>
              <p className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground/50">
                <span className="flex items-center gap-1.5">
                  <Icon name="HardDrive" size={14} />{fmtSize(latest.file_size)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="Download" size={14} />{latest.download_count} скачиваний
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="Monitor" size={14} />Windows
                </span>
              </p>

              {latest.changelog && (
                <div className="mb-6 rounded-xl border border-border bg-background/50 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/40">
                    Что нового
                  </p>
                  <p className="whitespace-pre-line text-sm text-foreground/70">{latest.changelog}</p>
                </div>
              )}

              <button onClick={() => download(latest)} style={{ cursor: "pointer" }}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                <Icon name="Download" size={20} />
                Скачать ({fmtSize(latest.file_size)})
              </button>
              <p className="mt-3 text-center text-xs text-foreground/40">
                Файл большой — на медленном интернете загрузка займёт время
              </p>
            </div>

            {/* Прошлые версии */}
            {older.length > 0 && (
              <div className="mt-6">
                <button onClick={() => setShowArchive(v => !v)} style={{ cursor: "pointer" }}
                  className="flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors">
                  <Icon name={showArchive ? "ChevronUp" : "ChevronDown"} size={15} />
                  Другие версии ({older.length})
                </button>

                {showArchive && (
                  <div className="mt-3 space-y-2">
                    {older.map(r => (
                      <div key={r.id} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-medium">Версия {r.version}</span>
                          <span className="text-xs text-foreground/40">{fmtDate(r.created_at)}</span>
                          <span className="text-xs text-foreground/40">{fmtSize(r.file_size)}</span>
                          <span className="flex items-center gap-1 text-xs text-foreground/40">
                            <Icon name="Download" size={11} />{r.download_count}
                          </span>
                          <button onClick={() => download(r)} style={{ cursor: "pointer" }}
                            className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground transition-colors">
                            <Icon name="Download" size={12} />Скачать
                          </button>
                        </div>
                        {r.changelog && (
                          <p className="mt-2 whitespace-pre-line text-xs text-foreground/50">{r.changelog}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Footer />
    </div>
  )
}
