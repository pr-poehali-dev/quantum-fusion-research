import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

// Пошаговый мастер создания нового заказа (в стиле /quiz).
// Заменяет прежнюю модалку «Новый заказ» из вкладки «Заказы».
// Шаг 1 — данные клиента, Шаг 2 — детали заказа. Поля 1:1 со старой формой.
export default function AdminNewOrderPage() {
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [createdId, setCreatedId] = useState<number | null>(null)

  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [orderType, setOrderType] = useState<"parts" | "pc_build">("parts")
  const [sourceId, setSourceId] = useState("")
  const [comment, setComment] = useState("")

  // Источники лидов (marketing) — управляются в «Аналитика → Источники»
  const [leadSources, setLeadSources] = useState<{ id: number; name: string; group_name: string | null }[]>([])
  useEffect(() => {
    api.marketing.getSources(true).then(d => setLeadSources(d.sources || d || [])).catch(() => {})
  }, [])

  const totalSteps = 2
  const progress = Math.round(((step + 1) / totalSteps) * 100)

  const canNext = () => {
    if (step === 0) return customerName.trim().length > 0 && customerPhone.trim().length > 0
    return true
  }

  const goBack = () => {
    if (step === 0) { navigate("/admin/orders"); return }
    setStep(s => s - 1)
  }

  const createOrder = async () => {
    if (!customerName.trim() || !customerPhone.trim()) return
    setSaving(true)
    const res = await api.orders.create({
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      customer_email: customerEmail.trim(),
      comment: comment.trim(),
      order_type: orderType,
      source_id: sourceId ? Number(sourceId) : null,
      items: [],
      total: 0,
    }).catch(() => null)
    setSaving(false)
    if (res?.id) { setCreatedId(res.id); setDone(true) }
    else alert(res?.error || "Не удалось создать заказ, попробуйте ещё раз")
  }

  const goNext = () => {
    if (step === totalSteps - 1) { createOrder(); return }
    setStep(s => s + 1)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
        <div className="max-w-md">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon name="CheckCircle2" size={36} />
          </div>
          <h1 className="mb-2 text-2xl font-bold">Заказ создан</h1>
          <p className="mb-6 text-foreground/60">Заказ добавлен в список. Можно открыть его карточку и наполнить позициями.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            {createdId && (
              <button onClick={() => navigate(`/admin/order/${createdId}`)} style={{ cursor: "pointer" }}
                className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                Открыть заказ
              </button>
            )}
            <button onClick={() => navigate("/admin/orders")} style={{ cursor: "pointer" }}
              className="rounded-lg border border-border px-6 py-3 text-sm font-medium hover:bg-muted transition-colors">
              К списку заказов
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/admin/orders")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={18} />
            <span className="text-sm font-medium">К заказам</span>
          </button>
          <span className="text-sm text-foreground/50">Новый заказ</span>
        </div>
        <div className="h-1 w-full bg-muted">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
        <p className="mb-2 text-sm font-medium text-primary">Шаг {step + 1} из {totalSteps}</p>

        <div key={step} className="flex-1 animate-fade-in">
          {step === 0 ? (
            <>
              <h2 className="text-2xl font-extrabold sm:text-3xl">Данные клиента</h2>
              <div className="mt-7 space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/70">Имя клиента *</label>
                  <input value={customerName} onChange={e => setCustomerName(e.target.value)} autoFocus
                    placeholder="Иван"
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/70">Телефон *</label>
                  <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} inputMode="tel"
                    placeholder="+7 999 000-00-00"
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/70">Email</label>
                  <input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} inputMode="email"
                    placeholder="client@example.com"
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary" style={{ cursor: "text" }} />
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-extrabold sm:text-3xl">Детали заказа</h2>
              <div className="mt-7 space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/70">Тип заказа</label>
                  <div className="flex flex-wrap gap-2">
                    {([["parts", "Комплектующие"], ["pc_build", "ПК-сборка"]] as const).map(([val, label]) => (
                      <button key={val} type="button" onClick={() => setOrderType(val)} style={{ cursor: "pointer" }}
                        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${orderType === val ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary"}`}>
                        <Icon name={val === "parts" ? "Package" : "Monitor"} size={16} /> {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/70">Откуда лид</label>
                  <select value={sourceId} onChange={e => setSourceId(e.target.value)}
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary" style={{ cursor: "pointer" }}>
                    <option value="">— не указан —</option>
                    {leadSources.map(s => (
                      <option key={s.id} value={s.id}>{s.group_name ? `${s.group_name} · ${s.name}` : s.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-foreground/40">Список источников настраивается в «Аналитика → Источники»</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/70">Комментарий</label>
                  <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
                    placeholder="Дополнительная информация (необязательно)"
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary resize-none" style={{ cursor: "text" }} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button onClick={goBack} style={{ cursor: "pointer" }}
            className="flex items-center gap-2 rounded-xl border border-border px-5 py-3.5 text-sm font-medium transition-colors hover:bg-muted">
            <Icon name="ArrowLeft" size={16} />Назад
          </button>
          <button onClick={goNext} disabled={!canNext() || saving} style={{ cursor: canNext() && !saving ? "pointer" : "default" }}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
            {step === totalSteps - 1 ? (
              saving ? <><Icon name="Loader2" size={18} className="animate-spin" />Создаём...</>
                     : <><Icon name="Check" size={18} />Создать заказ</>
            ) : (
              <>Далее <Icon name="ArrowRight" size={18} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
