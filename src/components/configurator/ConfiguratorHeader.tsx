import { useNavigate } from "react-router-dom"
import { useCart } from "@/store/cart"
import { useAuth } from "@/store/auth"
import Icon from "@/components/ui/icon"
import { ThemeSwitcher } from "@/components/theme-switcher"

export default function ConfiguratorHeader() {
  const navigate = useNavigate()
  const { count } = useCart()
  const { isAuthed } = useAuth()

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
          <span className="font-semibold text-lg text-foreground">BeGraphics</span>
        </button>
        <nav className="hidden items-center gap-6 md:flex">
          <button onClick={() => navigate("/shop")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Каталог</button>
          <button className="text-sm font-medium text-primary" style={{ cursor: "pointer" }}>Конфигуратор</button>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          {isAuthed()
            ? <button onClick={() => navigate("/profile")} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-sm text-foreground/70 hover:border-primary transition-colors" style={{ cursor: "pointer" }}><Icon name="User" size={15} /></button>
            : <button onClick={() => navigate("/auth")} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-sm text-foreground/70 hover:border-primary transition-colors" style={{ cursor: "pointer" }}><Icon name="LogIn" size={15} /><span>Войти</span></button>
          }
          <button onClick={() => navigate("/cart")} className="relative flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
            <Icon name="ShoppingCart" size={16} />
            <span>Корзина</span>
            {count() > 0 && <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">{count()}</span>}
          </button>
        </div>
      </div>
    </header>
  )
}
