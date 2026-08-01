import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"
import StressTestsTab from "@/components/admin/StressTestsTab"
import PartnerSocial from "@/components/partners/PartnerSocial"

export default function Partners() {
  const navigate = useNavigate()
  const { user, sessionId, updateUser, logout } = useAuth()
  const [loading, setLoading] = useState(true)
  const [tokenShown, setTokenShown] = useState(false)
  const [social, setSocial] = useState("")
  const [logo, setLogo] = useState("")

  // Подтягиваем свежий профиль (partner_access/company) при заходе
  useEffect(() => {
    if (!sessionId) { setLoading(false); return }
    api.auth.me(sessionId)
      .then(d => {
        if (d.user) {
          updateUser(d.user)
          setSocial(d.user.partner_company?.social_links || "")
          setLogo(d.user.partner_company?.report_logo_url || "")
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [sessionId, updateUser])

  const company = user?.partner_company
  const access = user?.partner_access
  const hasLk = !!(sessionId && access?.lk)

  // Экран-обёртка (обычная функция, не компонент — чтобы не ремаунтить шапку)
  const shell = (children: React.ReactNode, extra?: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics · Кабинет партнёра</span>
          </button>
          <div className="flex items-center gap-2">
            {extra}
            <ThemeSwitcher />
            {sessionId && (
              <button onClick={() => { logout(); navigate("/") }}
                className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                <Icon name="LogOut" size={14} /><span className="hidden sm:inline">Выйти</span>
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
    </div>
  )

  const Centered = ({ icon, title, text, action }: { icon: string; title: string; text: string; action?: React.ReactNode }) => (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <Icon name={icon} size={36} className="mx-auto mb-4 text-primary" />
        <h1 className="mb-2 text-xl font-semibold text-foreground">{title}</h1>
        <p className="mb-5 text-sm text-foreground/50">{text}</p>
        {action}
      </div>
    </div>
  )

  if (loading) {
    return shell(<div className="flex justify-center py-20"><div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>)
  }

  // Не залогинен
  if (!sessionId || !user) {
    return shell(
      <Centered icon="LogIn" title="Вход для партнёров" text="Войдите под аккаунтом BeGraphics, привязанным к вашей компании."
        action={<button onClick={() => navigate("/auth")} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90" style={{ cursor: "pointer" }}>Войти в аккаунт</button>} />
    )
  }

  // Залогинен, но нет доступа в ЛК
  if (!hasLk) {
    const suspended = company?.status === "suspended"
    const trialExpired = !!company && !company.trial_active && !!company.trial_ends_at && company.tier === "basic"
    return shell(
      <Centered
        icon={suspended ? "PauseCircle" : "Lock"}
        title={suspended ? "Доступ приостановлен" : company ? "Кабинет недоступен" : "Компания не привязана"}
        text={
          suspended ? "Доступ вашей компании временно приостановлен. Свяжитесь с менеджером BeGraphics."
          : trialExpired ? "Пробный период закончился. Чтобы продолжить пользоваться кабинетом, свяжитесь с менеджером."
          : company ? "У вашей компании нет доступа к личному кабинету. Свяжитесь с менеджером BeGraphics."
          : "Ваш аккаунт пока не привязан к партнёрской компании. Обратитесь к менеджеру BeGraphics."
        }
        action={<a href="https://t.me/begraphics" target="_blank" rel="noreferrer" className="inline-block rounded-lg border border-border px-5 py-2 text-sm text-foreground/70 hover:border-primary hover:text-foreground" style={{ cursor: "pointer" }}>Написать менеджеру</a>}
      />
    )
  }

  // Полный доступ — кабинет со стресс-тестами.
  // Иконка соцсетей — справа вверху в шапке (extra).
  const socialBtn = sessionId ? (
    <PartnerSocial session={sessionId} initial={social} onSaved={setSocial}
      logo={logo} onLogoSaved={setLogo} />
  ) : null

  return shell(
    <>
      {/* Шапка компании */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Icon name="Building2" size={16} className="text-primary" />
            <span className="text-lg font-semibold text-foreground">{company?.name || "Ваша компания"}</span>
            {company?.trial_active && <span className="rounded-full bg-yellow-400/15 border border-yellow-400/30 px-2 py-0.5 text-xs text-yellow-400">Пробный период</span>}
          </div>
          <p className="text-sm text-foreground/50">Личный кабинет · стресс-тесты вашей компании</p>
        </div>

        {/* Ingest-токен */}
        {company?.stress_ingest_token && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-foreground/50">
              <Icon name="Key" size={12} /> Токен для программы стресс-тестов
            </div>
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
                {tokenShown ? company.stress_ingest_token : "•".repeat(Math.min(company.stress_ingest_token.length, 20))}
              </code>
              <button onClick={() => setTokenShown(v => !v)} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }} title={tokenShown ? "Скрыть" : "Показать"}>
                <Icon name={tokenShown ? "EyeOff" : "Eye"} size={14} />
              </button>
              <button onClick={() => { navigator.clipboard.writeText(company.stress_ingest_token) }} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }} title="Скопировать">
                <Icon name="Copy" size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Единый модуль стресс-тестов в режиме партнёра */}
      <StressTestsTab scope="partner" session={sessionId} />
    </>,
    socialBtn
  )
}