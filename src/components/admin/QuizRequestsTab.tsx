import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

type TaskOption = { label: string; group: "games" | "work" }

interface Question {
  id: number
  sort_order: number
  title: string
  field_type: string
  options: Array<string | TaskOption>
  is_active: boolean
}

interface QuizRequest {
  id: number
  name: string | null
  phone: string | null
  contact_method: string | null
  budget_min: number | null
  budget_max: number | null
  answers: Record<string, string[]>
  extra_wishes: string | null
  status: string
  created_at: string
}

const STATUS_OPTS = [
  { value: "new", label: "Новая", cls: "bg-primary/15 text-primary" },
  { value: "in_progress", label: "В работе", cls: "bg-orange-400/15 text-orange-400" },
  { value: "done", label: "Обработана", cls: "bg-green-400/15 text-green-400" },
  { value: "rejected", label: "Отклонена", cls: "bg-red-400/15 text-red-400" },
]

const FIELD_TYPES = [
  { value: "multi", label: "Множественный выбор" },
  { value: "single", label: "Один вариант" },
  { value: "tasks", label: "Задачи (Игры/Работа)" },
  { value: "budget", label: "Бюджет (слайдер)" },
  { value: "contacts", label: "Контакты" },
  { value: "text", label: "Свободный текст" },
]

const TASK_GROUP_OPTS = [
  { value: "games", label: "Игры" },
  { value: "work", label: "Работа" },
]

const CONTACT_LABELS: Record<string, string> = { telegram: "Telegram", whatsapp: "WhatsApp", call: "Звонок" }
const fmtRub = (n: number | null) => (n ? n.toLocaleString("ru-RU") + " ₽" : "—")
const fmtDate = (s: string) => {
  if (!s) return ""
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z")
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function QuizRequestsTab() {
  const [view, setView] = useState<"requests" | "questions">("requests")
  const [requests, setRequests] = useState<QuizRequest[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [editQ, setEditQ] = useState<Question | null>(null)

  const loadRequests = () => {
    setLoading(true)
    api.quiz.getRequests().then(d => { setRequests(d.requests || []); setLoading(false) }).catch(() => setLoading(false))
  }
  const loadQuestions = () => {
    setLoading(true)
    api.quiz.getQuestions(true).then(d => { setQuestions(d.questions || []); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(() => {
    if (view === "requests") loadRequests()
    else loadQuestions()
  }, [view])

  const qTitle = (id: string) => questions.find(q => String(q.id) === id)?.title || `Вопрос #${id}`

  const setStatus = (id: number, status: string) => {
    setRequests(rs => rs.map(r => r.id === id ? { ...r, status } : r))
    api.quiz.setRequestStatus(id, status)
  }
  const delRequest = (id: number) => {
    if (!confirm("Удалить заявку?")) return
    setRequests(rs => rs.filter(r => r.id !== id))
    api.quiz.deleteRequest(id)
  }

  // ─── загрузим вопросы один раз для расшифровки заголовков в заявках ───
  useEffect(() => {
    if (!questions.length) api.quiz.getQuestions(true).then(d => setQuestions(d.questions || [])).catch(() => {})
  }, [])

  const saveQuestion = async () => {
    if (!editQ) return
    if (editQ.id === 0) await api.quiz.createQuestion(editQ)
    else await api.quiz.updateQuestion(editQ)
    setEditQ(null)
    loadQuestions()
  }
  const delQuestion = async (id: number) => {
    if (!confirm("Удалить вопрос?")) return
    await api.quiz.deleteQuestion(id)
    loadQuestions()
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => setView("requests")} style={{ cursor: "pointer" }}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${view === "requests" ? "bg-primary text-primary-foreground" : "border border-border hover:border-primary"}`}>
          <Icon name="Inbox" size={15} className="mr-1.5 inline" />Заявки
        </button>
        <button onClick={() => setView("questions")} style={{ cursor: "pointer" }}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${view === "questions" ? "bg-primary text-primary-foreground" : "border border-border hover:border-primary"}`}>
          <Icon name="ListChecks" size={15} className="mr-1.5 inline" />Вопросы анкеты
        </button>
      </div>

      {loading && <p className="py-10 text-center text-sm text-foreground/40">Загрузка...</p>}

      {/* ─────────── ЗАЯВКИ ─────────── */}
      {!loading && view === "requests" && (
        requests.length === 0 ? (
          <p className="py-16 text-center text-sm text-foreground/40">Пока нет заявок</p>
        ) : (
          <div className="space-y-3">
            {requests.map(r => {
              const open = expanded === r.id
              const st = STATUS_OPTS.find(s => s.value === r.status) || STATUS_OPTS[0]
              return (
                <div key={r.id} className="rounded-xl border border-border bg-card">
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <button onClick={() => setExpanded(open ? null : r.id)} style={{ cursor: "pointer" }}
                      className="flex flex-1 items-center gap-3 text-left">
                      <Icon name={open ? "ChevronDown" : "ChevronRight"} size={18} className="shrink-0 text-foreground/40" />
                      <div className="min-w-0">
                        <p className="font-semibold">{r.name || "Без имени"} <span className="font-normal text-foreground/50">· {r.phone}</span></p>
                        <p className="text-xs text-foreground/40">{fmtDate(r.created_at)} · бюджет {fmtRub(r.budget_min)}–{fmtRub(r.budget_max)}</p>
                      </div>
                    </button>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    <select value={r.status} onChange={e => setStatus(r.id, e.target.value)} style={{ cursor: "pointer" }}
                      className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
                      {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <button onClick={() => delRequest(r.id)} style={{ cursor: "pointer" }}
                      className="rounded-lg p-1.5 text-foreground/40 hover:bg-red-500/10 hover:text-red-400 transition-colors">
                      <Icon name="Trash2" size={16} />
                    </button>
                  </div>
                  {open && (
                    <div className="border-t border-border px-4 py-4 text-sm">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg bg-muted/40 p-3">
                          <p className="mb-1 text-xs font-semibold text-foreground/50">Контакты</p>
                          <p>{r.name || "—"}</p>
                          <p>{r.phone || "—"} · {CONTACT_LABELS[r.contact_method || ""] || r.contact_method || "—"}</p>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-3">
                          <p className="mb-1 text-xs font-semibold text-foreground/50">Бюджет</p>
                          <p>{fmtRub(r.budget_min)} — {fmtRub(r.budget_max)}</p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {Object.entries(r.answers || {}).map(([qid, vals]) => (
                          <div key={qid} className="flex flex-wrap items-start gap-2">
                            <span className="text-xs font-semibold text-foreground/50">{qTitle(qid)}:</span>
                            {(vals || []).map((v, i) => (
                              <span key={i} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">{v}</span>
                            ))}
                          </div>
                        ))}
                      </div>
                      {r.extra_wishes && (
                        <div className="mt-3 rounded-lg bg-muted/40 p-3">
                          <p className="mb-1 text-xs font-semibold text-foreground/50">Доп. пожелания</p>
                          <p className="whitespace-pre-wrap">{r.extra_wishes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ─────────── ВОПРОСЫ ─────────── */}
      {!loading && view === "questions" && (
        <div>
          <button onClick={() => setEditQ({ id: 0, sort_order: questions.length + 1, title: "", field_type: "multi", options: [], is_active: true })}
            style={{ cursor: "pointer" }}
            className="mb-4 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
            <Icon name="Plus" size={16} />Добавить вопрос
          </button>
          <div className="space-y-2">
            {questions.map(q => (
              <div key={q.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{q.sort_order}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{q.title} {!q.is_active && <span className="text-xs text-foreground/30">(скрыт)</span>}</p>
                  <p className="text-xs text-foreground/40">
                    {FIELD_TYPES.find(t => t.value === q.field_type)?.label}
                    {q.options.length > 0 && ` · ${q.options.length} вариантов`}
                  </p>
                </div>
                <button onClick={() => setEditQ({ ...q })} style={{ cursor: "pointer" }}
                  className="rounded-lg p-1.5 text-foreground/50 hover:bg-muted hover:text-foreground transition-colors">
                  <Icon name="Pencil" size={16} />
                </button>
                <button onClick={() => delQuestion(q.id)} style={{ cursor: "pointer" }}
                  className="rounded-lg p-1.5 text-foreground/40 hover:bg-red-500/10 hover:text-red-400 transition-colors">
                  <Icon name="Trash2" size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─────────── МОДАЛКА РЕДАКТИРОВАНИЯ ВОПРОСА ─────────── */}
      {editQ && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditQ(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-bold">{editQ.id === 0 ? "Новый вопрос" : "Редактировать вопрос"}</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-foreground/60">Заголовок</label>
                <input value={editQ.title} onChange={e => setEditQ({ ...editQ, title: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Тип</label>
                  <select value={editQ.field_type} onChange={e => setEditQ({ ...editQ, field_type: e.target.value })} style={{ cursor: "pointer" }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Порядок</label>
                  <input type="number" value={editQ.sort_order} onChange={e => setEditQ({ ...editQ, sort_order: Number(e.target.value) })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                </div>
              </div>
              {(editQ.field_type === "multi" || editQ.field_type === "single") && (
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Варианты ответов</label>
                  <div className="space-y-2">
                    {editQ.options.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={typeof opt === "string" ? opt : opt.label} onChange={e => {
                          const next = [...editQ.options]; next[i] = e.target.value; setEditQ({ ...editQ, options: next })
                        }} className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                        <button onClick={() => setEditQ({ ...editQ, options: editQ.options.filter((_, j) => j !== i) })} style={{ cursor: "pointer" }}
                          className="rounded-lg p-2 text-foreground/40 hover:bg-red-500/10 hover:text-red-400 transition-colors">
                          <Icon name="X" size={15} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setEditQ({ ...editQ, options: [...editQ.options, ""] })} style={{ cursor: "pointer" }}
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-foreground/60 hover:border-primary hover:text-foreground transition-colors">
                      <Icon name="Plus" size={14} />Добавить вариант
                    </button>
                  </div>
                </div>
              )}
              {editQ.field_type === "tasks" && (
                <div>
                  <label className="mb-1 block text-xs text-foreground/60">Подтипы задач и их раздел</label>
                  <div className="space-y-2">
                    {editQ.options.map((opt, i) => {
                      const o: TaskOption = typeof opt === "string" ? { label: opt, group: "work" } : opt
                      const upd = (patch: Partial<TaskOption>) => {
                        const next = [...editQ.options]; next[i] = { ...o, ...patch }; setEditQ({ ...editQ, options: next })
                      }
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <input value={o.label} onChange={e => upd({ label: e.target.value })} placeholder="Название подтипа"
                            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                          <select value={o.group} onChange={e => upd({ group: e.target.value as "games" | "work" })} style={{ cursor: "pointer" }}
                            className="rounded-lg border border-border bg-background px-2 py-2 text-sm">
                            {TASK_GROUP_OPTS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                          </select>
                          <button onClick={() => setEditQ({ ...editQ, options: editQ.options.filter((_, j) => j !== i) })} style={{ cursor: "pointer" }}
                            className="rounded-lg p-2 text-foreground/40 hover:bg-red-500/10 hover:text-red-400 transition-colors">
                            <Icon name="X" size={15} />
                          </button>
                        </div>
                      )
                    })}
                    <button onClick={() => setEditQ({ ...editQ, options: [...editQ.options, { label: "", group: "games" }] })} style={{ cursor: "pointer" }}
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-foreground/60 hover:border-primary hover:text-foreground transition-colors">
                      <Icon name="Plus" size={14} />Добавить подтип
                    </button>
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={editQ.is_active} onChange={e => setEditQ({ ...editQ, is_active: e.target.checked })} style={{ cursor: "pointer" }} />
                Показывать в анкете
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={saveQuestion} disabled={!editQ.title.trim()} style={{ cursor: "pointer" }}
                className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                Сохранить
              </button>
              <button onClick={() => setEditQ(null)} style={{ cursor: "pointer" }}
                className="rounded-lg border border-border px-5 py-2.5 text-sm hover:bg-muted transition-colors">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}