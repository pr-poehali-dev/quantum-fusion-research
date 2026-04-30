import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"

export default function AuthPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuth()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [form, setForm] = useState({ email: "", username: "", password: "" })
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = mode === "login"
        ? await api.auth.login({ email: form.email, password: form.password })
        : await api.auth.register({ email: form.email, username: form.username, password: form.password })

      if (res.error) { setError(res.error); setLoading(false); return }
      setAuth(res.user, res.session_id)
      navigate("/profile")
    } catch {
      setError("Ошибка соединения")
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6" style={{ cursor: "auto" }}>
      <div className="w-full max-w-sm">
        <button onClick={() => navigate("/shop")} className="mb-6 flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="ArrowLeft" size={16} />Назад
        </button>

        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">BeGraphics</h1>
              <p className="text-xs text-foreground/40">{mode === "login" ? "Войти в аккаунт" : "Создать аккаунт"}</p>
            </div>
          </div>

          <div className="mb-6 flex overflow-hidden rounded-xl border border-border">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === "login" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              Вход
            </button>
            <button
              onClick={() => setMode("register")}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === "register" ? "bg-primary text-primary-foreground" : "text-foreground/60 hover:text-foreground"}`}
              style={{ cursor: "pointer" }}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Имя пользователя</label>
                <input
                  required
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                  placeholder="gamepro"
                  style={{ cursor: "text" }}
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Email</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder="you@email.com"
                style={{ cursor: "text" }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/60">Пароль {mode === "register" && "(минимум 6 символов)"}</label>
              <input
                required
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder="••••••"
                style={{ cursor: "text" }}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              style={{ cursor: "pointer" }}
            >
              {loading ? "Загрузка..." : mode === "login" ? "Войти" : "Зарегистрироваться"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}