import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"

type TaskOption = { label: string; group: "games" | "work" }
type OptObj = { label: string; image_url?: string }

interface Question {
  id: number
  sort_order: number
  title: string
  field_type: string // multi | single | budget | contacts | text | tasks
  options: Array<string | TaskOption | OptObj>
  description?: string
}

const QUIZ_STORAGE_KEY = "begraphics_quiz_progress"

const TASK_GROUPS = [
  { key: "games" as const, label: "Игры", icon: "Gamepad2" },
  { key: "work" as const, label: "Работа", icon: "Briefcase" },
]

const BUDGET_MIN = 30000
const BUDGET_MAX = 500000
const BUDGET_STEP = 5000

const CONTACT_METHODS = [
  { value: "telegram", label: "Telegram", icon: "Send" },
  { value: "max", label: "Max", icon: "MessageCircle" },
  { value: "call", label: "Звонок", icon: "Phone" },
]

const fmtRub = (n: number) => n.toLocaleString("ru-RU") + " ₽"

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
        <div className="absolute top-1/2 h-2 w-full -translate-y-1/2 rounded-full bg-border" />
        <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${pct(min)}%`, right: `${100 - pct(max)}%` }} />
        <input type="range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP} value={min}
          onChange={e => onChange(Math.min(Number(e.target.value), max - BUDGET_STEP), max)}
          className="pointer-events-none absolute top-0 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:ring-1 [&::-webkit-slider-thumb]:ring-primary [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-lg" />
        <input type="range" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP} value={max}
          onChange={e => onChange(min, Math.max(Number(e.target.value), min + BUDGET_STEP))}
          className="pointer-events-none absolute top-0 h-6 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:ring-1 [&::-webkit-slider-thumb]:ring-primary [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-lg" />
      </div>
    </div>
  )
}

function TasksField({ options, value, onChange }: {
  options: TaskOption[]; value: string[]; onChange: (v: string[]) => void
}) {
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({})
  const toggle = (label: string) =>
    onChange(value.includes(label) ? value.filter(v => v !== label) : [...value, label])

  return (
    <div className="grid grid-cols-2 items-start gap-3">
      {TASK_GROUPS.map(g => {
        const items = options.filter(o => o.group === g.key)
        const selectedCount = items.filter(o => value.includes(o.label)).length
        // блок открыт, если выбран хотя бы один подтип ИЛИ открыт вручную
        const open = selectedCount > 0 || manualOpen[g.key]
        return (
          <div key={g.key} className="flex flex-col">
            <button type="button" onClick={() => setManualOpen(m => ({ ...m, [g.key]: !open }))} style={{ cursor: "pointer" }}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-5 transition-colors ${open || selectedCount ? "border-primary bg-primary/10" : "border-border hover:border-primary"}`}>
              <Icon name={g.icon} size={32} className={open || selectedCount ? "text-primary" : "text-foreground/60"} />
              <span className="text-lg font-bold">{g.label}</span>
              {selectedCount > 0 && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                  Выбрано: {selectedCount}
                </span>
              )}
              <Icon name="ChevronDown" size={16} className={`text-foreground/40 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="mt-2 flex flex-col gap-2 animate-fade-in">
                {items.map(o => {
                  const active = value.includes(o.label)
                  return (
                    <button key={o.label} type="button" onClick={() => toggle(o.label)} style={{ cursor: "pointer" }}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary"}`}>
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                        {active && <Icon name="Check" size={11} />}
                      </span>
                      <span className="min-w-0 break-words">{o.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
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
  const [tgTag, setTgTag] = useState("")
  const [extra, setExtra] = useState("")
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [step, setStep] = useState(0)
  const [resumeAvailable, setResumeAvailable] = useState(false)
  const [restored, setRestored] = useState(false)
  const loadedRef = useRef(false)

  useEffect(() => {
    api.quiz.getQuestions().then(d => { setQuestions(d.questions || []); loadedRef.current = true }).catch(() => {})
    // есть ли незаконченный прогресс?
    try {
      const raw = localStorage.getItem(QUIZ_STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        const hasData = (saved.answers && Object.keys(saved.answers).length) || saved.phone || saved.name || (saved.step ?? 0) > 0
        if (hasData) setResumeAvailable(true)
      }
    } catch { /* ignore */ }
  }, [])

  // автосохранение прогресса
  useEffect(() => {
    if (!loadedRef.current || done) return
    const data = { step, answers, budget, name, phone, contact, tgTag, extra, ts: Date.now() }
    try { localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
  }, [step, answers, budget, name, phone, contact, tgTag, extra, done])

  const resumeQuiz = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(QUIZ_STORAGE_KEY) || "{}")
      if (saved.answers) setAnswers(saved.answers)
      if (saved.budget) setBudget(saved.budget)
      if (saved.name) setName(saved.name)
      if (saved.phone) setPhone(saved.phone)
      if (saved.contact) setContact(saved.contact)
      if (saved.tgTag) setTgTag(saved.tgTag)
      if (saved.extra) setExtra(saved.extra)
      if (typeof saved.step === "number") setStep(saved.step)
    } catch { /* ignore */ }
    setResumeAvailable(false)
    setRestored(true)
  }

  const startOver = () => {
    try { localStorage.removeItem(QUIZ_STORAGE_KEY) } catch { /* ignore */ }
    setResumeAvailable(false)
  }

  const setAns = (qid: number, v: string[]) => setAnswers(a => ({ ...a, [qid]: v }))

  // шаги: каждый вопрос + финальный шаг «доп. пожелания»
  const totalSteps = questions.length + 1
  const isExtraStep = step === questions.length
  const current = questions[step]
  const progress = totalSteps > 0 ? Math.round(((step + 1) / totalSteps) * 100) : 0

  const canNext = () => {
    if (isExtraStep || !current) return true
    if (current.field_type === "contacts") return phone.trim().length > 0
    if (current.field_type === "budget" || current.field_type === "text") return true
    return (answers[current.id] || []).length > 0
  }

  const goNext = () => {
    if (isExtraStep) { submit(); return }
    setStep(s => Math.min(s + 1, totalSteps - 1))
  }
  const goBack = () => setStep(s => Math.max(s - 1, 0))

  const submit = async () => {
    if (!phone.trim()) { alert("Укажите телефон для связи"); return }
    setSending(true)
    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      contact_method: contact,
      telegram_tag: contact === "telegram" ? tgTag.trim().replace(/^@/, "") : "",
      budget_min: budget.min,
      budget_max: budget.max,
      answers,
      extra_wishes: extra.trim(),
    }
    const res = await api.quiz.submit(payload).catch(() => null)
    setSending(false)
    if (res?.ok) {
      try { localStorage.removeItem(QUIZ_STORAGE_KEY) } catch { /* ignore */ }
      setDone(true)
    }
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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <Icon name="ArrowLeft" size={18} />
            <span className="text-sm font-medium">На главную</span>
          </button>
          <span className="text-sm text-foreground/50">Анкета подбора ПК</span>
        </div>
        {/* Прогресс-бар */}
        <div className="h-1 w-full bg-muted">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
        {questions.length === 0 ? (
          <p className="py-20 text-center text-sm text-foreground/40">Загрузка...</p>
        ) : (
          <>
            {resumeAvailable && (
              <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 animate-fade-in">
                <Icon name="History" size={20} className="text-primary" />
                <p className="flex-1 text-sm">У вас есть незаконченная анкета. Продолжить с того же места?</p>
                <button onClick={resumeQuiz} style={{ cursor: "pointer" }}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                  Продолжить
                </button>
                <button onClick={startOver} style={{ cursor: "pointer" }}
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">
                  Начать заново
                </button>
              </div>
            )}
            {restored && (
              <p className="mb-3 text-xs text-foreground/40">Прогресс восстановлен</p>
            )}
            <p className="mb-2 text-sm font-medium text-primary">Шаг {step + 1} из {totalSteps}</p>

            <div key={step} className="flex-1 animate-fade-in">
              <h2 className="text-2xl font-extrabold sm:text-3xl">
                {isExtraStep ? "Дополнительные пожелания" : current.title}
              </h2>

              <div className="mt-7">
                {isExtraStep ? (
                  <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={5} autoFocus
                    placeholder="Что ещё важно учесть? (необязательно)"
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary" />
                ) : current.field_type === "budget" ? (
                  <BudgetSlider min={budget.min} max={budget.max} onChange={(mn, mx) => setBudget({ min: mn, max: mx })} />
                ) : current.field_type === "contacts" ? (
                  <div className="space-y-3">
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary" />
                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон *" inputMode="tel"
                      className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary" />
                    <p className="pt-1 text-xs font-medium text-foreground/50">Как удобнее связаться?</p>
                    <div className="flex flex-wrap gap-2">
                      {CONTACT_METHODS.map(m => (
                        <button key={m.value} type="button" onClick={() => setContact(m.value)} style={{ cursor: "pointer" }}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${contact === m.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary"}`}>
                          <Icon name={m.icon} size={16} /> {m.label}
                        </button>
                      ))}
                    </div>
                    {contact === "telegram" && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center rounded-xl border border-border bg-card px-4 focus-within:border-primary">
                          <span className="text-foreground/40">@</span>
                          <input value={tgTag.replace(/^@/, "")} onChange={e => setTgTag(e.target.value.replace(/^@/, ""))}
                            placeholder="ваш_тег_в_telegram"
                            className="w-full bg-transparent py-3 pl-1 text-sm outline-none" />
                        </div>
                        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                          <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
                          <span>Без тега мы сможем найти вас по номеру в Telegram, только если в настройках конфиденциальности у вас разрешён поиск по номеру для всех (не только контактов).</span>
                        </p>
                      </div>
                    )}
                  </div>
                ) : current.field_type === "text" ? (
                  <textarea value={answers[current.id]?.[0] || ""} onChange={e => setAns(current.id, [e.target.value])} rows={4}
                    placeholder="Опишите пожелания"
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary" />
                ) : current.field_type === "tasks" ? (
                  <TasksField
                    options={(current.options as Array<string | TaskOption>).map(o => typeof o === "string" ? { label: o, group: "work" as const } : o)}
                    value={answers[current.id] || []}
                    onChange={v => setAns(current.id, v)} />
                ) : (() => {
                  // Нормализуем варианты к { label, image_url? }
                  const opts = current.options.map(o =>
                    typeof o === "string" ? { label: o } as OptObj : (o as OptObj)
                  )
                  // Плиточный режим: если фото есть более чем у 2 вариантов
                  const withImg = opts.filter(o => o.image_url && o.image_url.trim())
                  const tileMode = withImg.length > 2
                  const vals = answers[current.id] || []
                  const single = current.field_type === "single"
                  const toggle = (label: string, active: boolean) => {
                    if (single) setAns(current.id, [label])
                    else setAns(current.id, active ? vals.filter(v => v !== label) : [...vals, label])
                  }
                  if (tileMode) {
                    // ПК — 2 столбца, телефон — строчки (1 столбец)
                    return (
                      <div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {opts.map(o => {
                            const active = vals.includes(o.label)
                            return (
                              <button key={o.label} type="button" onClick={() => toggle(o.label, active)} style={{ cursor: "pointer" }}
                                className={`group relative flex flex-col overflow-hidden rounded-xl border text-left transition-colors ${active ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary"}`}>
                                {o.image_url ? (
                                  <img src={o.image_url} alt={o.label} className="h-32 w-full object-cover sm:h-36" />
                                ) : (
                                  <div className="flex h-32 w-full items-center justify-center bg-muted sm:h-36">
                                    <Icon name="Image" size={28} className="text-foreground/20" />
                                  </div>
                                )}
                                <div className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium ${active ? "bg-primary/10 text-primary" : "text-foreground"}`}>
                                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center border ${single ? "rounded-full" : "rounded-md"} ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                                    {active && <Icon name="Check" size={13} />}
                                  </span>
                                  {o.label}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                        {current.field_type !== "single" && (
                          <p className="pt-2 text-xs text-foreground/40">Можно выбрать несколько вариантов</p>
                        )}
                      </div>
                    )
                  }
                  // Обычный режим — список строк (с миниатюрой, если фото задано)
                  return (
                    <div className="flex flex-col gap-2.5">
                      {opts.map(o => {
                        const active = vals.includes(o.label)
                        return (
                          <button key={o.label} type="button" onClick={() => toggle(o.label, active)} style={{ cursor: "pointer" }}
                            className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm font-medium transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary"}`}>
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center border ${single ? "rounded-full" : "rounded-md"} ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                              {active && <Icon name="Check" size={13} />}
                            </span>
                            {o.image_url && o.image_url.trim() && (
                              <img src={o.image_url} alt={o.label} className="h-10 w-10 shrink-0 rounded-md object-cover" />
                            )}
                            {o.label}
                          </button>
                        )
                      })}
                      {current.field_type !== "single" && (
                        <p className="pt-1 text-xs text-foreground/40">Можно выбрать несколько вариантов</p>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Пояснение к вопросу (из админки) */}
            {!isExtraStep && current?.description && current.description.replace(/<[^>]*>/g, "").trim() && (
              <div className="mt-6 flex gap-3 rounded-xl border border-border bg-card p-4">
                <Icon name="Info" size={18} className="mt-0.5 shrink-0 text-primary" />
                <div className="quiz-hint prose prose-sm max-w-none text-sm text-foreground/80 prose-headings:text-foreground prose-a:text-primary prose-strong:text-foreground"
                  dangerouslySetInnerHTML={{ __html: current.description }} />
              </div>
            )}

            {/* Навигация */}
            <div className="mt-6 flex items-center gap-3">
              {step > 0 && (
                <button onClick={goBack} style={{ cursor: "pointer" }}
                  className="flex items-center gap-2 rounded-xl border border-border px-5 py-3.5 text-sm font-medium transition-colors hover:bg-muted">
                  <Icon name="ArrowLeft" size={16} />Назад
                </button>
              )}
              <button onClick={goNext} disabled={!canNext() || sending} style={{ cursor: canNext() && !sending ? "pointer" : "default" }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                {isExtraStep ? (
                  sending ? <><Icon name="Loader2" size={18} className="animate-spin" />Отправляем...</>
                          : <><Icon name="Send" size={18} />Отправить заявку</>
                ) : (
                  <>Далее <Icon name="ArrowRight" size={18} /></>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}