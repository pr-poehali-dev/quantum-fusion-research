import { useEffect, useState, useCallback } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { PartnerCompany } from "@/pages/admin/types"
import { getAdminKey } from "@/pages/admin/constants"

const TIERS: { id: string; label: string; hint: string }[] = [
  { id: "basic", label: "Базовый", hint: "Только B2B-цены без пароля" },
  { id: "close", label: "Близкий партнёр", hint: "B2B + личный кабинет" },
  { id: "paid", label: "Платный", hint: "B2B + личный кабинет" },
]

function tierBadge(tier: string) {
  if (tier === "paid") return "bg-green-400/15 border-green-400/30 text-green-400"
  if (tier === "close") return "bg-primary/15 border-primary/30 text-primary"
  return "bg-foreground/10 border-border text-foreground/50"
}
function tierLabel(tier: string) { return TIERS.find(t => t.id === tier)?.label || tier }

function fmtTrial(c: PartnerCompany): string {
  if (!c.trial_ends_at) return ""
  const d = new Date(c.trial_ends_at)
  const s = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })
  return c.trial_active ? `триал до ${s}` : `триал истёк (${s})`
}

export default function PartnerCompaniesTab() {
  const adminKey = getAdminKey()
  const [companies, setCompanies] = useState<PartnerCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<number | "new" | null>(null)
  const [busy, setBusy] = useState(false)

  // draft-поля формы
  const [dName, setDName] = useState("")
  const [dTier, setDTier] = useState("basic")
  const [dStatus, setDStatus] = useState("active")
  const [dToken, setDToken] = useState("")
  const [dContact, setDContact] = useState("")
  const [dPhone, setDPhone] = useState("")
  const [dNote, setDNote] = useState("")
  const [dTrialDays, setDTrialDays] = useState("")

  const load = useCallback(() => {
    setLoading(true)
    api.auth.adminGetCompanies(adminKey).then(d => setCompanies(d.companies || [])).finally(() => setLoading(false))
  }, [adminKey])

  useEffect(() => { load() }, [load])

  const startNew = () => {
    setEditId("new")
    setDName(""); setDTier("basic"); setDStatus("active"); setDToken("")
    setDContact(""); setDPhone(""); setDNote(""); setDTrialDays("")
  }
  const startEdit = (c: PartnerCompany) => {
    setEditId(c.id)
    setDName(c.name); setDTier(c.tier); setDStatus(c.status); setDToken(c.stress_ingest_token)
    setDContact(c.contact_name); setDPhone(c.contact_phone); setDNote(c.note); setDTrialDays("")
  }

  const save = async () => {
    if (!dName.trim()) { alert("Введите название компании"); return }
    setBusy(true)
    const payload: Record<string, unknown> = {
      name: dName.trim(), tier: dTier, status: dStatus,
      stress_ingest_token: dToken.trim(), contact_name: dContact,
      contact_phone: dPhone, note: dNote,
    }
    if (editId !== "new") payload.id = editId
    if (dTrialDays.trim() !== "") payload.trial_days = Number(dTrialDays)
    const res = await api.auth.adminSaveCompany(payload, adminKey)
    setBusy(false)
    if (res.error) { alert(res.error); return }
    setEditId(null)
    load()
  }

  const stopTrial = async (c: PartnerCompany) => {
    setBusy(true)
    await api.auth.adminSaveCompany({ id: c.id, name: c.name, tier: c.tier, status: c.status, stress_ingest_token: c.stress_ingest_token, contact_name: c.contact_name, contact_phone: c.contact_phone, note: c.note, clear_trial: true }, adminKey)
    setBusy(false)
    load()
  }

  const remove = async (c: PartnerCompany) => {
    if (!confirm(`Удалить компанию «${c.name}»?\nПривязанные юзеры и прогоны просто отвяжутся.`)) return
    setBusy(true)
    await api.auth.adminDeleteCompany(c.id, adminKey)
    setBusy(false)
    load()
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-light text-foreground">Партнёрские компании ({companies.length})</h2>
        <button onClick={startNew} className="flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90" style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={15} /> Новая компания
        </button>
      </div>

      {/* Форма создания/редактирования */}
      {editId !== null && (
        <div className="mb-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">{editId === "new" ? "Новая компания" : "Редактирование"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-foreground/50">Название</label>
              <input value={dName} onChange={e => setDName(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Статус доступа</label>
              <select value={dTier} onChange={e => setDTier(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                {TIERS.map(t => <option key={t.id} value={t.id}>{t.label} — {t.hint}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Активность</label>
              <select value={dStatus} onChange={e => setDStatus(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "pointer" }}>
                <option value="active">Активна</option>
                <option value="suspended">Приостановлена</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-foreground/50">Ingest-токен для стресс-тестера (вводится в EXE)</label>
              <input value={dToken} onChange={e => setDToken(e.target.value)} placeholder="например: partner-acme-7f3k9..." className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Триал: полный доступ на N дней</label>
              <input value={dTrialDays} onChange={e => setDTrialDays(e.target.value.replace(/\D/g, ""))} placeholder="напр. 14 (пусто — не менять)" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground/50">Контакт</label>
              <input value={dContact} onChange={e => setDContact(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-foreground/50">Заметка</label>
              <input value={dNote} onChange={e => setDNote(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none" style={{ cursor: "text" }} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50" style={{ cursor: "pointer" }}>Сохранить</button>
            <button onClick={() => setEditId(null)} className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>Отмена</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-card animate-pulse" />)}</div>
      ) : companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <Icon name="Building2" size={32} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-sm text-foreground/40">Компаний пока нет</p>
        </div>
      ) : (
        <div className="space-y-2">
          {companies.map(c => (
            <div key={c.id} className={`rounded-xl border bg-card p-4 ${c.status === "suspended" ? "border-red-400/40 bg-red-400/5" : "border-border"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-foreground">{c.name || "Без названия"}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${tierBadge(c.tier)}`}>{tierLabel(c.tier)}</span>
                    {c.trial_active && <span className="rounded-full bg-yellow-400/15 border border-yellow-400/30 px-2 py-0.5 text-xs text-yellow-400">Триал</span>}
                    {c.status === "suspended" && <span className="rounded-full bg-red-400/15 border border-red-400/30 px-2 py-0.5 text-xs text-red-400">Приостановлена</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-foreground/40">
                    <span><Icon name="Users" size={11} className="mr-1 inline" />{c.users_count} польз.</span>
                    {c.stress_ingest_token && <span className="font-mono"><Icon name="Key" size={11} className="mr-1 inline" />{c.stress_ingest_token}</span>}
                    {fmtTrial(c) && <span className={c.trial_active ? "text-yellow-500" : "text-red-400"}>{fmtTrial(c)}</span>}
                    {c.contact_name && <span>{c.contact_name}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {c.trial_ends_at && (
                    <button onClick={() => stopTrial(c)} disabled={busy} title="Остановить триал"
                      className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:border-yellow-400/40 hover:text-yellow-400" style={{ cursor: "pointer" }}>
                      <Icon name="TimerOff" size={13} />
                    </button>
                  )}
                  <button onClick={() => startEdit(c)} title="Редактировать"
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/50 hover:border-primary hover:text-foreground" style={{ cursor: "pointer" }}>
                    <Icon name="Pencil" size={13} />
                  </button>
                  <button onClick={() => remove(c)} title="Удалить"
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground/40 hover:border-red-400 hover:text-red-400" style={{ cursor: "pointer" }}>
                    <Icon name="Trash2" size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
