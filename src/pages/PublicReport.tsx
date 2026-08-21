import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import Seo from "@/components/Seo"
import Footer from "@/components/Footer"
import { ThemeSwitcher } from "@/components/theme-switcher"
import PublicRunCard, { PublicRun } from "@/components/PublicRunCard"

// Публичная ссылка на отчёт: /tests/<код>. Код короткий, его можно
// переслать в чат или продиктовать. Авторизация не нужна.

export default function PublicReport() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<PublicRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!code) { setLoading(false); return }
    api.stress.publicReport(code)
      .then(d => setRun(d?.found ? d.run : null))
      .catch(() => setRun(null))
      .finally(() => setLoading(false))
  }, [code])

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo
        title="Отчёт стресс-теста компьютера"
        description="Результат проверки компьютера под полной нагрузкой: процессор, память и видеокарта."
        path={`/tests/${code || ""}`}
      />

      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">B</div>
            <span className="text-lg font-semibold">BeGraphics</span>
          </button>
          <ThemeSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : !run ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center">
            <Icon name="SearchX" size={30} className="mx-auto mb-3 text-foreground/30" />
            <p className="mb-1 font-medium">Отчёт не найден</p>
            <p className="text-sm text-foreground/50">
              Проверьте ссылку — возможно, в коде опечатка.
            </p>
            <button onClick={() => navigate("/stresstester")} style={{ cursor: "pointer" }}
              className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              О программе
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-light sm:text-3xl">Отчёт о тестировании</h1>
              <button onClick={copyLink} style={{ cursor: "pointer" }}
                className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:border-primary hover:text-foreground">
                <Icon name={copied ? "Check" : "Link"} size={13} />
                {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
              </button>
            </div>

            <PublicRunCard run={run} />

            <div className="mt-6 rounded-2xl border border-border bg-card p-6 text-center">
              <p className="mb-1 font-medium">Проверьте свой компьютер</p>
              <p className="mb-4 text-sm text-foreground/50">
                Программа бесплатная, установка не нужна — работает сразу после запуска.
              </p>
              <button onClick={() => navigate("/stresstester")} style={{ cursor: "pointer" }}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                <Icon name="Download" size={17} />Скачать программу
              </button>
            </div>
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}
