import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ADMIN_PASSWORD } from "@/pages/admin/types"

const SESSION_KEY = "begraphics_admin"

export function isAdminAuthed() {
  return sessionStorage.getItem(SESSION_KEY) === "1"
}

/**
 * Обёртка для защищённых страниц админки.
 * Без авторизации в сессии показывает экран ввода пароля,
 * не давая загрузить дочерний контент (страницу).
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const [authed, setAuthed] = useState(isAdminAuthed)
  const [password, setPassword] = useState("")

  const login = () => {
    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "1")
      setAuthed(true)
    } else {
      alert("Неверный пароль")
    }
  }

  if (authed) return <>{children}</>

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">B</div>
          <div>
            <p className="font-semibold text-foreground">BeGraphics Admin</p>
            <p className="text-xs text-foreground/40">Панель управления</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-foreground/60">Пароль</label>
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && login()}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
              placeholder="Введите пароль" style={{ cursor: "text" }}
            />
          </div>
          <button onClick={login} className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
            Войти
          </button>
          <button onClick={() => navigate("/")} className="w-full text-center text-xs text-foreground/40 hover:text-foreground/60 transition-colors" style={{ cursor: "pointer" }}>
            ← На сайт
          </button>
        </div>
      </div>
    </div>
  )
}
