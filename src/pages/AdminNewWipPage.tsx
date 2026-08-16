import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { WipBuild } from "@/pages/admin/types"
import { EMPTY_WIP, WIP_STAGES, DELIVERY_OPTIONS } from "@/pages/admin/constants"

// Пошаговый мастер создания новой сборки в процессе (в стиле /quiz).
// Заменяет режим «Новая сборка» прежней модалки во вкладке «Сборки в процессе».
// Поля 1:1 со старой формой: основное, комплектующие, даты/комментарий.
export default function AdminNewWipPage() {
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const [form, setForm] = useState<WipBuild>({ ...EMPTY_WIP })
  const set = <K extends keyof WipBuild>(k: K, v: WipBuild[K]) => setForm(f => ({ ...f, [k]: v }))

  // Этапы: берём из БД, если есть, иначе — дефолтный справочник
  const [stages, setStages] = useState<string[]>(WIP_STAGES)
  useEffect(() => {
    api.wipBuilds.getAll().then(d => { if (Array.isArray(d?.stages) && d.stages.length) setStages(d.stages) }).catch(() => {})
  }, [])

  // Источники лидов (marketing) — управляются в «Аналитика → Источники»
  const [leadSources, setLeadSources] = useState<{ id: number; name: string; group_name: string | null }[]>([])
  useEffect(() => {
    api.marketing.getSources(true).then(d => setLeadSources(d.sources || d || [])).catch(() => {})
  }, [])

  // Шага «Комплектующие» здесь НЕТ намеренно: железо заводится позже, в самой
  // сборке (WIP), а не в опроснике создания — иначе менеджер вбивает названия
  // дважды. Шага два: основное + сроки/комментарий.
  const totalSteps = 2
  const progress = Math.round(((step + 1) / totalSteps) * 100)

  // Источник обязателен, только если сборка НЕ в свободную продажу (как в модалке)
  const canNext = () => {
    if (step === 0) return !!form.for_sale || !!form.source_id
    return true
  }

  const goBack = () => {
    if (step === 0) { navigate("/admin/wip_builds"); return }
    setStep(s => s - 1)
  }

  const save = async () => {
    setSaving(true)
    const res = await api.wipBuilds.create(form).catch(() => null)
    if (res?.id) {
      // Источник лида хранится в заказе — если он создался и источник выбран
      if (form.source_id && res.order_id) {
        await api.orders.setSource(res.order_id, Number(form.source_id)).catch(() => {})
      }
      setSaving(false)
      setDone(true)
    } else {
      setSaving(false)
      alert(res?.error || "Не удалось создать сборку, попробуйте ещё раз")
    }
  }

  const goNext = () => {
    if (step === totalSteps - 1) { save(); return }
    setStep(s => s + 1)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
        <div className="max-w-md">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon name="CheckCircle2" size={36} />
          </div>
          <h1 className="mb-2 text-2xl font-bold">Сборка создана</h1>
          <p className="mb-6 text-foreground/60">Сборка добавлена в раздел «Сборки в процессе».</p>
          <button onClick={() => navigate("/admin/wip_builds")} style={{ cursor: "pointer" }}
            className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            К списку сборок
          </button>
        </div>
      </div>
    )
  }

  const inputCls = "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary"
  const labelCls = "mb-1.5 block text-sm font-medium text-foreground/70"

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/admin/wip_builds")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={18} />
            <span className="text-sm font-medium">К сборкам</span>
          </button>
          <span className="text-sm text-foreground/50">Новая сборка</span>
        </div>
        <div className="h-1 w-full bg-muted">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
        <p className="mb-2 text-sm font-medium text-primary">Шаг {step + 1} из {totalSteps}</p>

        <div key={step} className="flex-1 animate-fade-in">
          {step === 0 && (
            <>
              <h2 className="text-2xl font-extrabold sm:text-3xl">Основное</h2>
              <div className="mt-7 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Номер заказа</label>
                    <input value={form.order_number} onChange={e => set("order_number", e.target.value)}
                      placeholder="присвоится автоматически" className={inputCls} style={{ cursor: "text" }} />
                  </div>
                  <div>
                    <label className={labelCls}>Этап</label>
                    <select value={form.stage} onChange={e => set("stage", e.target.value)} className={inputCls} style={{ cursor: "pointer" }}>
                      {stages.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm hover:border-primary/50 transition-colors" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.for_sale} onChange={e => set("for_sale", e.target.checked)}
                    className="h-4 w-4 accent-primary" style={{ cursor: "pointer" }} />
                  <Icon name="Tag" size={14} className="text-primary" />
                  В свободную продажу
                  <span className="ml-auto text-xs text-foreground/40">публикует в «Наши ПК» с тегом «в наличии»</span>
                </label>
                <div>
                  <label className={labelCls}>
                    Откуда лид {form.for_sale
                      ? <span className="text-foreground/40">(для свободной продажи спросим перед выдачей)</span>
                      : <span className="text-red-400">*</span>}
                  </label>
                  <select value={form.source_id ? String(form.source_id) : ""}
                    onChange={e => set("source_id", e.target.value ? Number(e.target.value) : null)}
                    className={`w-full rounded-xl border bg-card px-4 py-3 text-sm outline-none focus:border-primary ${!form.for_sale && !form.source_id ? "border-red-400/60" : "border-border"}`}
                    style={{ cursor: "pointer" }}>
                    <option value="">— не указан —</option>
                    {leadSources.map(s => (
                      <option key={s.id} value={s.id}>{s.group_name ? `${s.group_name} · ${s.name}` : s.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-foreground/40">Список источников — в «Аналитика → Источники»</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Контакт клиента</label>
                    <input value={form.contact} onChange={e => set("contact", e.target.value)}
                      placeholder="@username или телефон" className={inputCls} style={{ cursor: "text" }} />
                  </div>
                  <div>
                    <label className={labelCls}>Способ получения</label>
                    <select value={form.delivery_type} onChange={e => set("delivery_type", e.target.value)} className={inputCls} style={{ cursor: "pointer" }}>
                      <option value="">Не выбрано</option>
                      {DELIVERY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-2xl font-extrabold sm:text-3xl">Сроки и комментарий</h2>
              <div className="mt-7 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Дата получения железа</label>
                    <input type="date" value={form.received_at} onChange={e => set("received_at", e.target.value)}
                      className={inputCls} style={{ cursor: "pointer" }} />
                  </div>
                  <div>
                    <label className={labelCls}>Планируемая выдача</label>
                    <input type="date" value={form.issued_at} onChange={e => set("issued_at", e.target.value)}
                      className={inputCls} style={{ cursor: "pointer" }} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Комментарий</label>
                  <textarea value={form.comment} onChange={e => set("comment", e.target.value)} rows={3}
                    className={`${inputCls} resize-none`} style={{ cursor: "text" }} />
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
                     : <><Icon name="Check" size={18} />Создать сборку</>
            ) : (
              <>Далее <Icon name="ArrowRight" size={18} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}