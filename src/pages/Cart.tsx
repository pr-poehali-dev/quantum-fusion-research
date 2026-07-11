import { useState, useMemo } from "react"
import { useCart } from "@/store/cart"
import { useAuth } from "@/store/auth"
import { api } from "@/lib/api"
import { getUtm } from "@/lib/utm"
import Icon from "@/components/ui/icon"
import { useNavigate } from "react-router-dom"

export default function Cart() {
  const { items, removeItem, updateQty, clearCart, total, count } = useCart()
  const { sessionId, user } = useAuth()
  const navigate = useNavigate()

  const prefilled = useMemo(() => {
    if (!user) return { name: "", phone: "", contact_type: "tg" as const, contact_value: "" }
    let contact_type: "tg" | "vk" | "max" = "max"
    let contact_value = ""
    if (user.telegram_username) { contact_type = "tg"; contact_value = `https://t.me/${user.telegram_username}` }
    else if (user.vk_url) { contact_type = "vk"; contact_value = user.vk_url }
    return { name: user.username || "", phone: user.phone || "", contact_type, contact_value }
  }, [user])

  const [form, setForm] = useState(() => ({ ...prefilled, comment: "" }))
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [viewMode, setViewMode] = useState<"detailed" | "compact">("detailed")

  const fmt = (n: number) => n.toLocaleString("ru-RU") + " ₽"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.phone) return
    setSubmitting(true)
    const hasBuildWithAssembly = items.some(i => i.type === "config" && i.assembly !== false)
    const hasOnlyParts = items.every(i => i.type === "product" || (i.type === "config" && i.assembly === false))
    const orderType = hasBuildWithAssembly ? "pc_build" : hasOnlyParts ? "parts" : "cart"
    const preorderNames = items.filter(i => i.preorder).map(i => i.name)
    const preorderNote = preorderNames.length
      ? `⚠️ Товары под заказ (нет в наличии, связаться с клиентом): ${preorderNames.join(", ")}`
      : ""
    const comment = [form.comment, preorderNote].filter(Boolean).join("\n\n") || undefined
    await api.orders.createWithSession({
      customer_name: form.name,
      customer_phone: form.phone,
      customer_email: form.contact_value ? `${form.contact_type}:${form.contact_value}` : undefined,
      order_type: orderType,
      items: items.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, item_type: i.type, assembly: i.assembly, components: i.components, preorder: i.preorder })),
      total: total(),
      comment,
      ...getUtm(),
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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
          <button onClick={() => navigate("/")} className="flex shrink-0 items-center gap-2" style={{ cursor: "pointer" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">B</div>
            <span className="font-semibold text-lg text-foreground">BeGraphics</span>
          </button>
          <nav className="hidden items-center gap-6 md:flex">
            <button onClick={() => navigate("/shop")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Каталог</button>
            <button onClick={() => navigate("/configurator")} className="text-sm text-foreground/70 hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>Конфигуратор</button>
          </nav>
          <div className="flex shrink-0 items-center gap-2 text-sm text-foreground/60">
            <Icon name="ShoppingCart" size={16} />
            <span><span className="hidden sm:inline">Корзина · </span>{count()}<span className="hidden sm:inline"> товар(а)</span></span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
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
              {/* Переключатель вида: подробный (с превью и описанием) / компактный */}
              <div className="flex items-center justify-end gap-1.5">
                <span className="mr-1 text-xs text-foreground/40">Вид:</span>
                <button onClick={() => setViewMode("detailed")} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "detailed" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:text-foreground hover:border-primary/40"}`} style={{ cursor: "pointer" }}>
                  <Icon name="LayoutList" size={14} />Подробный
                </button>
                <button onClick={() => setViewMode("compact")} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "compact" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:text-foreground hover:border-primary/40"}`} style={{ cursor: "pointer" }}>
                  <Icon name="Menu" size={14} />Компактный
                </button>
              </div>
              {items.map(item => {
                const isProduct = item.type === "product"
                const Photo = (
                  <>
                    {item.image_url
                      ? <img src={item.image_url} alt={item.name} className="h-full w-full object-contain" />
                      : <Icon name={item.type === "config" ? "Cpu" : "Package"} size={viewMode === "detailed" ? 56 : 24} className="text-foreground/40" />}
                  </>
                )
                const photoClass = `flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ${viewMode === "detailed" ? "h-28 w-28 sm:h-40 sm:w-40" : "h-14 w-14"}`
                return (
                <div key={item.id} className={`rounded-xl border border-border bg-card p-4 transition-all duration-200`}>
                  <div className={`flex flex-col gap-3 sm:flex-row sm:items-center`}>
                   <div className="flex min-w-0 flex-1 items-center gap-3">
                    {/* Превью-фото — кликабельно на товар (в новой вкладке) */}
                    {viewMode === "detailed" && isProduct ? (
                      <a href={`/product/${item.id}`} target="_blank" rel="noopener noreferrer"
                        title="Открыть товар в новой вкладке"
                        className={`${photoClass} transition-opacity hover:opacity-90`} style={{ cursor: "pointer" }}>
                        {Photo}
                      </a>
                    ) : (
                      <div className={photoClass}>{Photo}</div>
                    )}

                    {/* Название + тип + описание */}
                    <div className={`min-w-0 flex-1 ${viewMode === "detailed" ? "sm:text-center" : ""}`}>
                      <p className={`text-sm font-medium text-foreground leading-tight ${viewMode === "detailed" ? "" : "truncate"}`}>{item.name}</p>
                      <p className="mt-0.5 text-xs text-foreground/40">{item.type === "config" ? "Кастомная сборка" : "Комплектующее"}</p>
                      {viewMode === "detailed" && item.description && (
                        <p className="mt-1 text-xs leading-snug text-foreground/50 line-clamp-3">
                          {item.description.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()}
                        </p>
                      )}
                      {item.preorder && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          <Icon name="Clock" size={11} />
                          Под заказ — с вами свяжется менеджер
                        </span>
                      )}
                    </div>
                   </div>

                    {/* Цена / кол-во / итог / удаление — 1в1 как в конфигураторе */}
                    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 pt-3 sm:justify-start sm:border-0 sm:pt-0">
                      <span className="text-xs text-foreground/50">{fmt(item.price)}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateQty(item.id, item.quantity - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                          <Icon name="Minus" size={11} />
                        </button>
                        <input type="number" min={1} max={99} value={item.quantity}
                          onChange={e => updateQty(item.id, Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-11 rounded-lg border border-border bg-background px-1 py-1 text-center text-xs font-medium text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
                        <button onClick={() => updateQty(item.id, item.quantity + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-foreground/60 hover:border-primary hover:text-foreground transition-colors" style={{ cursor: "pointer" }}>
                          <Icon name="Plus" size={11} />
                        </button>
                      </div>
                      <span className="w-24 text-right text-sm font-bold text-primary">{fmt(item.price * item.quantity)}</span>
                      <button onClick={() => removeItem(item.id)} className="text-foreground/25 hover:text-red-400 transition-colors" style={{ cursor: "pointer" }}>
                        <Icon name="X" size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                )
              })}
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
              {user && (
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-primary/8 border border-primary/20 px-3 py-2">
                  <Icon name="UserCheck" size={14} className="text-primary shrink-0" />
                  <span className="text-xs text-primary/80">Данные подтянуты из профиля — проверь и отправляй</span>
                </div>
              )}
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
                  <label className="mb-1 block text-xs text-foreground/60">Как с вами связаться?</label>
                  <div className="flex gap-1.5 mb-2">
                    {([
                      { key: "tg", label: "Telegram" },
                      { key: "vk", label: "ВКонтакте" },
                      { key: "max", label: "Макс" },
                    ] as const).map(s => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setForm(f => {
                          let val = ""
                          if (s.key === "tg" && user?.telegram_username) val = `https://t.me/${user.telegram_username}`
                          else if (s.key === "vk" && user?.vk_url) val = user.vk_url
                          return { ...f, contact_type: s.key, contact_value: val }
                        })}
                        className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${form.contact_type === s.key ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/50 hover:border-primary hover:text-foreground"}`}
                        style={{ cursor: "pointer" }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {form.contact_type !== "max" && <input
                    type="text"
                    value={form.contact_value}
                    onChange={e => setForm(f => ({ ...f, contact_value: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none"
                    placeholder={form.contact_type === "tg" ? "https://t.me/username" : "https://vk.com/username"}
                    style={{ cursor: "text" }}
                  />}
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
                  className="btn-tilt w-full rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
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