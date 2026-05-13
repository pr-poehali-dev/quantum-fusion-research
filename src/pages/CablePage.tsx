import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { CableConfigurator } from "@/components/cable-configurator"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { useCart } from "@/store/cart"

export default function CablePage() {
  const navigate = useNavigate()
  const { count } = useCart()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm px-6 py-4">
        <button
          onClick={() => navigate("/configurator")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          style={{ cursor: "pointer" }}
        >
          <Icon name="ArrowLeft" size={16} />
          <span className="text-sm">Конфигуратор</span>
        </button>
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <button
            onClick={() => navigate("/cart")}
            className="relative flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:border-primary transition-colors"
            style={{ cursor: "pointer" }}
          >
            <Icon name="ShoppingCart" size={16} />
            <span>Корзина</span>
            {count() > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground font-bold">
                {count()}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-8">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-primary">C-Cables · партнёр</p>
          <h1 className="mb-2 text-3xl font-light text-foreground">Кастомные кабели</h1>
          <p className="text-sm text-foreground/60">
            Выбери тип разъёмов и цвет оплётки. Кабели изготавливаются под заказ нашим партнёром C-Cables.
            Цена согласовывается после оформления.
          </p>
        </div>

        <CableConfigurator standalone />
      </div>
    </div>
  )
}
