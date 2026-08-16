import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { useCart } from "@/store/cart"
import { useAuth } from "@/store/auth"
import { ThemeSwitcher } from "@/components/theme-switcher"
import StressTesterLink from "@/components/StressTesterLink"
import NotificationBell from "@/components/NotificationBell"

/** Базовая шапка сайта: логотип, тема, уведомления, профиль, корзина.
 *  Единый компонент для всех публичных страниц. */
export default function SiteHeader() {
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
        <div className="flex items-center gap-2">
          <StressTesterLink />
          <ThemeSwitcher />
          <NotificationBell />
          {isAuthed() ? (
            <button onClick={() => navigate("/profile")} className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="User" size={15} />
            </button>
          ) : (
            <button onClick={() => navigate("/auth")} className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm hover:border-primary transition-colors" style={{ cursor: "pointer" }}>
              <Icon name="LogIn" size={15} />
            </button>
          )}
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