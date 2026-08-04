import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

type Verified = {
  found: boolean
  partner_name?: string
  machine?: string
  profile?: string
  started_at?: string
  finished_at?: string
  total?: number
  passed?: number
  failed?: number
  links?: { label: string; url: string }[]
}

export default function VerifyReport() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Verified | null>(null)

  useEffect(() => {
    if (!code) { setLoading(false); return }
    api.stress.verifyReport(code)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [code])

  const fmt = (iso?: string) => {
    if (!iso) return "—"
    const d = new Date(iso)
    return isNaN(d.getTime()) ? "—" : d.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-lg px-6 py-14">
        <button onClick={() => navigate("/")} className="mx-auto mb-8 flex items-center gap-2" style={{ cursor: "pointer" }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
          <span className="text-lg font-semibold">Проверка отчёта</span>
        </button>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : !data ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <Icon name="TriangleAlert" size={32} className="mx-auto mb-3 text-foreground/30" />
            <h1 className="mb-2 text-lg font-semibold">Не удалось проверить</h1>
            <p className="text-sm text-foreground/50">Попробуйте открыть ссылку ещё раз.</p>
          </div>
        ) : data.found ? (
          <div className="rounded-2xl border border-green-500/30 bg-card p-8">
            <div className="mb-5 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
                <Icon name="ShieldCheck" size={28} className="text-green-500" />
              </div>
              <h1 className="text-xl font-semibold text-foreground">Отчёт проверен</h1>
              {data.partner_name && (
                <p className="mt-1 text-sm text-foreground/60">Выдан: <b className="text-foreground">{data.partner_name}</b></p>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-border bg-background p-4 text-sm">
              {data.machine && (
                <div className="flex justify-between gap-3">
                  <span className="text-foreground/50">Компьютер</span>
                  <span className="text-right font-medium">{data.machine}</span>
                </div>
              )}
              {data.profile && (
                <div className="flex justify-between gap-3">
                  <span className="text-foreground/50">Программа тестов</span>
                  <span className="text-right font-medium">{data.profile}</span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-foreground/50">Дата проверки</span>
                <span className="text-right font-medium">{fmt(data.finished_at || data.started_at)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-foreground/50">Результат</span>
                <span className="text-right font-medium">
                  {data.failed ? (
                    <span className="text-yellow-400">{data.passed} из {data.total} успешно</span>
                  ) : (
                    <span className="text-green-500">Все тесты пройдены ({data.total})</span>
                  )}
                </span>
              </div>
            </div>

            {!!data.links?.length && (
              <div className="mt-5">
                <p className="mb-2 text-xs text-foreground/40">Связаться{data.partner_name ? ` с ${data.partner_name}` : ""}</p>
                <div className="flex flex-wrap gap-2">
                  {data.links.map((l, i) => (
                    <a key={i} href={l.url} target="_blank" rel="noreferrer" style={{ cursor: "pointer" }}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:border-primary hover:text-foreground">
                      {l.label || l.url}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Icon name="Clock" size={26} className="text-foreground/40" />
            </div>
            <h1 className="mb-2 text-lg font-semibold">Отчёт пока не загружен</h1>
            <p className="text-sm text-foreground/50">
              Код есть на отчёте, но данные ещё не поступили на сервер — так бывает,
              если тест делали без интернета. Попробуйте позже.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
