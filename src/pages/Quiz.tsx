import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"

interface Question {
  id: number
  sort_order: number
  title: string
  field_type: string // multi | single | budget | contacts | text
  options: string[]
}

const BUDGET_MIN = 30000
const BUDGET_MAX = 500000
const BUDGET_STEP = 5000

const CONTACT_METHODS = [
  { value: "telegram", label: "Telegram", icon: "Send" },
  { value: "whatsapp", label: "WhatsApp", icon: "MessageCircle" },
  { value: "call", label: "Звонок", icon: "Phone" },
]

const fmtRub = (n: number) => n.toLocaleString("ru-RU") + " ₽"

function MultiDropdown({ options, value, onChange, single }: {
  options: string[]; value: string[]; onChange: (v: string[]) => void; single?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const toggle = (opt: string) => {
    if (single) { onChange([opt]); setOpen(false); return }
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} style={{ cursor: "pointer" }}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-4 py-3 text-left text-sm transition-colors hover:border-primary">
        <span className={value.length ? "text-foreground" : "text-foreground/40"}>
          {value.length ? value.join(", ") : "Выберите вариант"}
        </span>
        <Icon name="ChevronDown" size={18} className={`shrink-0 text-foreground/50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xl">
          {options.map(opt => {
            const active = value.includes(opt)
            return (
              <button key={opt} type="button" onClick={() => toggle(opt)} style={{ cursor: "pointer" }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${active ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${single ? "rounded-full" : ""} border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                  {active && <Icon name="Check" size={12} />}
                </span>
                {opt}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BudgetSlider({ min, max, onChange }: { min: number; max: number; onChange: (mn: number, mx: number) => void }) {
  const pct = (v: number) => ((v - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)) * 100
  return (
    <div className="pt-2">
      <div className="mb-4 flex items-center justify-between text-sm font-semibold">
        <span className="rounded-lg bg-muted px-3 py-1.5">{fmtRub(min)}</span>
        <span className="text-foreground/40">—</span>
        <span className="rounded-lg bg-muted px-3 py-1.5">{fmtRub(max)}</span>
      </div>
      <div className="relative h-6">
        <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-muted" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${pct(min)}%`, right: `${100 - pct(max)}%` }} />
        <input type="range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP} value={min}
          onChange={e => onChange(Math.min(Number(e.target.value), max - BUDGET_STEP), max)}
          className="pointer-events-none absolute top-0 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow" />
        <input type="range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP} value={max}
          onChange={e => onChange(min, Math.max(Number(e.target.value), min + BUDGET_STEP))}
          className="pointer-events-none absolute top-0 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow" />
      </div>
    </div>
  )
}

export default function Quiz() {
  const navigate = useNavigate()
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<number, string[]>>({})
  const [budget, setBudget] = useState({ min: 80000, max: 200000 })
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [contact, setContact] = useState("telegram")
  const [extra, setExtra] = useState("")
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    api.quiz.getQuestions().then(d => setQuestions(d.questions || [])).catch(() => {})
  }, [])

  const setAns = (qid: number, v: string[]) => setAnswers(a => ({ ...a, [qid]: v }))

  const submit = async () => {
    if (!phone.trim()) { alert("Укажите телефон для связи"); return }
    setSending(true)
    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      contact_method: contact,
      budget_min: budget.min,
      budget_max: budget.max,
      answers,
      extra_wishes: extra.trim(),
    }
    const res = await api.quiz.submit(payload).catch(() => null)
    setSending(false)
    if (res?.ok) setDone(true)
    else alert("Не удалось отправить заявку, попробуйте ещё раз")
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
        <div className="max-w-md">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon name="CheckCircle2" size={36} />
          </div>
          <h1 className="mb-2 text-2xl font-bold">Заявка отправлена!</h1>
          <p className="mb-6 text-foreground/60">Менеджер свяжется с вами в ближайшее время и подберёт оптимальную сборку под ваши задачи.</p>
          <button onClick={() => navigate("/")} style={{ cursor: "pointer" }}
            className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            На главную
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={18} />
            <span className="text-sm font-medium">На главную</span>
          </button>
          <span className="text-sm text-foreground/50">Анкета подбора ПК</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-3xl font-extrabold">Подберём идеальный компьютер</h1>
        <p className="mt-2 text-foreground/60">Ответьте на пару вопросов — менеджер соберёт конфигурацию под ваши задачи и бюджет.</p>

        <div className="mt-8 space-y-5">
          {questions.map((q, i) => (
            <div key={q.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-3 flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{i + 1}</span>
                <h3 className="pt-0.5 text-base font-semibold">{q.title}</h3>
              </div>
              <div className="pl-10">
                {q.field_type === "budget" ? (
                  <BudgetSlider min={budget.min} max={budget.max} onChange={(mn, mx) => setBudget({ min: mn, max: mx })} />
                ) : q.field_type === "contacts" ? (
                  <div className="space-y-3">
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя"
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон *" inputMode="tel"
                      className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
                    <div className="flex flex-wrap gap-2">
                      {CONTACT_METHODS.map(m => (
                        <button key={m.value} type="button" onClick={() => setContact(m.value)} style={{ cursor: "pointer" }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${contact === m.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary"}`}>
                          <Icon name={m.icon} size={16} /> {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : q.field_type === "text" ? (
                  <textarea value={answers[q.id]?.[0] || ""} onChange={e => setAns(q.id, [e.target.value])} rows={3}
                    placeholder="Опишите пожелания"
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
                ) : (
                  <MultiDropdown options={q.options} value={answers[q.id] || []}
                    onChange={v => setAns(q.id, v)} single={q.field_type === "single"} />
                )}
              </div>
            </div>
          ))}

          {/* Дополнительные пожелания */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon name="MessageSquarePlus" size={15} /></span>
              <h3 className="pt-0.5 text-base font-semibold">Дополнительные пожелания</h3>
            </div>
            <div className="pl-10">
              <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={3}
                placeholder="Что ещё важно учесть? (необязательно)"
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary" />
            </div>
          </div>
        </div>

        <button onClick={submit} disabled={sending} style={{ cursor: sending ? "default" : "pointer" }}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60">
          {sending ? <Icon name="Loader2" size={18} className="animate-spin" /> : <Icon name="Send" size={18} />}
          {sending ? "Отправляем..." : "Отправить заявку"}
        </button>
      </div>
    </div>
  )
}
