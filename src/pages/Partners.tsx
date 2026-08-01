import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"

export default function Partners() {
  const navigate = useNavigate()
  const { user, sessionId, updateUser, logout } = useAuth()
  const [loading, setLoading] = useState(true)

  // Подтягиваем свежий профиль (partner_access/company) при заходе
  useEffect(() => {
    if (!sessionId) { setLoading(false); return }
    api.auth.me(sessionId)
      .then(d => { if (d.user) updateUser(d.user) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [sessionId, updateUser])

  const company = user?.partner_company
  const access = user?.partner_access
  const hasB2B = !!(sessionId && access?.b2b)
  const hasLk = !!(sessionId && access?.lk)

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics · Кабинет партнёра</span>
          </button>
          <div className="flex items-center gap-2">
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
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
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

  // Плитка сервиса
  const Tile = ({ icon, iconColor, title, text, available, cta, onGo, lockedText }: {
    icon: string; iconColor: string; title: string; text: string
    available: boolean; cta: string; onGo: () => void; lockedText: string
  }) => (
    <button
      onClick={available ? onGo : undefined}
      disabled={!available}
      className={`group relative flex flex-col items-start rounded-2xl border p-6 text-left transition-all ${
        available
          ? "border-border bg-card hover:border-primary hover:shadow-lg"
          : "border-border bg-card/40 opacity-70"
      }`}
      style={{ cursor: available ? "pointer" : "not-allowed" }}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl" style={{ backgroundColor: `${iconColor}1a` }}>
        <Icon name={icon} size={28} style={{ color: iconColor }} />
      </div>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {!available && <Icon name="Lock" size={14} className="text-foreground/40" />}
      </div>
      <p className="mb-5 text-sm text-foreground/50">{text}</p>
      {available ? (
        <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary">
          {cta} <Icon name="ArrowRight" size={15} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      ) : (
        <span className="mt-auto text-xs text-foreground/40">{lockedText}</span>
      )}
    </button>
  )

  // Плиточный хаб — выбор сервиса
  return shell(
    <>
      <div className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <Icon name="Building2" size={18} className="text-primary" />
          <span className="text-xl font-semibold text-foreground">{company?.name || "Ваша компания"}</span>
          {company?.trial_active && <span className="rounded-full bg-yellow-400/15 border border-yellow-400/30 px-2 py-0.5 text-xs text-yellow-400">Пробный период</span>}
        </div>
        <p className="text-sm text-foreground/50">Выберите сервис партнёрского кабинета</p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Tile
          icon="Tags"
          iconColor="#6366f1"
          title="B2B-каталог"
          text="Оптовые цены, наличие и характеристики товаров для партнёров."
          available={hasB2B}
          cta="Перейти в каталог"
          onGo={() => navigate("/b2b")}
          lockedText="Нет доступа — свяжитесь с менеджером"
        />
        <Tile
          icon="Activity"
          iconColor="#a855f7"
          title="StressTester"
          text="Отчёты стресс-тестов вашей компании, папки прогонов и токен для программы."
          available={hasLk}
          cta="Открыть стресс-тесты"
          onGo={() => navigate("/partners/стресстестер")}
          lockedText="Нет доступа — свяжитесь с менеджером"
        />
      </div>

      {!hasB2B && !hasLk && (
        <div className="mt-6 rounded-xl border border-border bg-card p-4 text-center text-sm text-foreground/50">
          У вашей компании пока нет активных сервисов.{" "}
          <a href="https://t.me/begraphics" target="_blank" rel="noreferrer" className="text-primary hover:underline">Написать менеджеру</a>
        </div>
      )}
    </>
  )
}
