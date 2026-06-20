import { useNavigate } from "react-router-dom"

export default function Footer() {
  const navigate = useNavigate()
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-foreground/50 sm:flex-row">
        <span>© {new Date().getFullYear()} BeGraphics</span>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <button onClick={() => navigate("/contacts")} className="hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
            Контакты
          </button>
          <button onClick={() => navigate("/privacy")} className="hover:text-primary transition-colors" style={{ cursor: "pointer" }}>
            Политика конфиденциальности
          </button>
        </div>
      </div>
    </footer>
  )
}