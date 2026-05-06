import { useState } from "react"
import { useCart } from "@/store/cart"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { useNavigate } from "react-router-dom"

export default function Cart() {
  const { items, removeItem, updateQty, clearCart, total, count } = useCart()
  const { sessionId } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: "", phone: "", email: "", comment: "" })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.phone) return
    setSubmitting(true)
    const hasBuild = items.some(i => i.type === "config")
    const hasOnlyParts = !hasBuild && items.every(i => i.type === "product")
    const orderType = hasBuild ? "pc_build" : hasOnlyParts ? "parts" : "cart"
    await api.orders.createWithSession({
      customer_name: form.name,
      customer_phone: form.phone,
      customer_email: form.email || undefined,
      order_type: orderType,
      items: items.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, item_type: i.type })),
      total: total(),
      comment: form.comment || undefined,
    }, sessionId)
    clearCart()
    setSuccess(true)
    setSubmitting(false)
  }

  if (success) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground px-6" style={{ cursor: "auto" }}>
        <div className="text-center max-w-md">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mx-auto">
            <Icon name="CheckCircle" size={40} className="text-primary" />
          </div>
          <h1 className="mb-3 text-3xl font-light text-foreground">Заявка принята!</h1>
          <p className="mb-8 text-foreground/60">Наш менеджер свяжется с вами в ближайшее время для уточнения деталей заказа.</p>
          <button
            onClick={() => navigate("/shop")}
            className="rounded-full bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            style={{ cursor: "pointer" }}
          >
            Продолжить покупки
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ cursor: "auto" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <nav className="hidden items-center gap-6 md:flex">
            <button onClick={() => navigate("/shop")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Каталог</button>
            <button onClick={() => navigate("/configurator")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Конфигуратор</button>
          </nav>
          <div className="flex items-center gap-2 text-sm text-foreground/60">
            <Icon name="ShoppingCart" size={16} />
            <span>Корзина · {count()} товар(а)</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-2 text-sm text-foreground/60 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="ArrowLeft" size={16} />
          Назад
        </button>

        <h1 className="mb-8 text-3xl font-light text-foreground">Корзина</h1>

        {items.length === 0 ? (
          <div className="py-24 text-center">
            <Icon name="ShoppingCart" size={48} className="mx-auto mb-4 text-foreground/20" />
            <p className="mb-6 text-foreground/50">Корзина пуста</p>
            <button onClick={() => navigate("/shop")} className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors" style={{ cursor: "pointer" }}>
              Перейти в каталог
            </button>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
            {/* Items */}
            <div className="space-y-3">
              {items.map(item => (
                <div key={item.id} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon name={item.type === "config" ? "Cpu" : "Package"} size={24} className="text-foreground/40" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-foreground/40">{item.type === "config" ? "Кастомная сборка" : "Комплектующее"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 rounded-lg border border-border">
                      <button onClick={() => updateQty(item.id, item.quantity - 1)} className="px-2 py-1 text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>
                        <Icon name="Minus" size={12} />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <button onClick={() => updateQty(item.id, item.quantity + 1)} className="px-2 py-1 text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>
                        <Icon name="Plus" size={12} />
                      </button>
                    </div>
                    <p className="w-24 text-right text-sm font-bold text-foreground">{fmt(item.price * item.quantity)}</p>
                    <button onClick={() => removeItem(item.id)} className="text-foreground/30 hover:text-foreground/70 transition-colors" style={{ cursor: "pointer" }}>
                      <Icon name="Trash2" size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Order form */}
            <div className="h-fit rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 text-lg font-medium text-foreground">Оформить заявку</h2>
              <div className="mb-6 border-t border-border pt-4">
                <div className="flex items-center justify-between text-lg font-bold">
                  <span className="text-foreground/70">Итого:</span>
                  <span className="text-foreground">{fmt(total())}</span>
                </div>
                <p className="mt-1 text-xs text-foreground/40">Менеджер уточнит детали и подтвердит заказ</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Имя *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                    placeholder="Ваше имя"
                    style={{ cursor: "text" }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Телефон *</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                    placeholder="+7 (___) ___-__-__"
                    style={{ cursor: "text" }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                    placeholder="your@email.com"
                    style={{ cursor: "text" }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Комментарий</label>
                  <textarea
                    rows={3}
                    value={form.comment}
                    onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none resize-none"
                    placeholder="Пожелания к заказу..."
                    style={{ cursor: "text" }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  style={{ cursor: "pointer" }}
                >
                  {submitting ? "Отправка..." : "Отправить заявку"}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}