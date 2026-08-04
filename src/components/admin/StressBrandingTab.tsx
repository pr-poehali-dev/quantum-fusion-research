import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import StressBrandSettings from "@/components/partners/StressBrandSettings"
import StressNotifySettings from "@/components/partners/StressNotifySettings"

type Company = {
  id: number
  name: string
  tier: string
  status: string
  stress_ingest_token?: string
}

/**
 * Админская вкладка: тот же функционал, что в кабинете партнёра
 * (брендинг PDF + Telegram-уведомления), но с выбором компании.
 */
export default function StressBrandingTab({ adminKey }: { adminKey: string }) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [tokenShown, setTokenShown] = useState(false)

  useEffect(() => {
    api.auth.adminGetCompanies(adminKey)
      .then(d => {
        const list: Company[] = d.companies || []
        setCompanies(list)
        setCompanyId(prev => prev ?? (list[0]?.id ?? null))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [adminKey])

  const company = companies.find(c => c.id === companyId)

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!companies.length) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <Icon name="Building2" size={28} className="mx-auto mb-3 text-foreground/30" />
        <h2 className="mb-1 font-semibold text-foreground">Нет партнёрских компаний</h2>
        <p className="text-sm text-foreground/50">
          Создайте компанию в разделе «Партнёры», чтобы настроить брендинг и уведомления.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Выбор компании */}
      <div className="mb-5 rounded-2xl border border-border bg-card p-4">
        <p className="mb-2 text-xs font-medium text-foreground/50">Компания-партнёр</p>
        <div className="flex flex-wrap gap-1.5">
          {companies.map(c => (
            <button key={c.id} onClick={() => { setCompanyId(c.id); setTokenShown(false) }}
              style={{ cursor: "pointer" }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                companyId === c.id
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-foreground/60 hover:text-foreground"}`}>
              {c.name || `Компания #${c.id}`}
              {c.status === "suspended" && (
                <span className={companyId === c.id ? "opacity-80" : "text-red-400"}>· пауза</span>
              )}
            </button>
          ))}
        </div>

        {/* Токен выбранной компании — как в кабинете партнёра */}
        {company?.stress_ingest_token && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="flex items-center gap-1.5 text-xs text-foreground/50">
              <Icon name="Key" size={12} /> Токен для программы
            </span>
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
              {tokenShown
                ? company.stress_ingest_token
                : "•".repeat(Math.min(company.stress_ingest_token.length, 20))}
            </code>
            <button onClick={() => setTokenShown(v => !v)} style={{ cursor: "pointer" }}
              className="text-foreground/40 hover:text-foreground" title={tokenShown ? "Скрыть" : "Показать"}>
              <Icon name={tokenShown ? "EyeOff" : "Eye"} size={14} />
            </button>
            <button onClick={() => navigator.clipboard.writeText(company.stress_ingest_token || "")}
              style={{ cursor: "pointer" }} className="text-foreground/40 hover:text-foreground" title="Скопировать">
              <Icon name="Copy" size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Те же блоки, что и в кабинете партнёра */}
      {companyId && (
        <div className="space-y-5">
          <StressBrandSettings adminKey={adminKey} companyId={companyId} defaultOpen />
          <StressNotifySettings adminKey={adminKey} companyId={companyId} defaultOpen />
        </div>
      )}
    </div>
  )
}
