import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { getAdminKey } from "@/pages/admin/types"

// Поля реквизитов поставщика для договора поставки
const FIELDS: { key: string; label: string; hint?: string; wide?: boolean }[] = [
  { key: "supplier_name", label: "Поставщик (название)", hint: "ИП Колодяжный Михаил Георгиевич", wide: true },
  { key: "supplier_person", label: "В лице (род. падеж)", hint: "Колодяжного Михаила Георгиевича", wide: true },
  { key: "sign_name", label: "ФИО для подписи", hint: "Колодяжный М. Г." },
  { key: "city", label: "Город" },
  { key: "rs", label: "Р/С" },
  { key: "bank", label: "Банк" },
  { key: "ks", label: "Корр. счёт" },
  { key: "bik", label: "БИК" },
  { key: "inn", label: "ИНН" },
  { key: "ogrnip", label: "ОГРНИП" },
  { key: "delivery_days", label: "Срок поставки (дней)" },
]

export default function CompanySettings() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.companySettings.get().then(d => {
      const s = d.settings || {}
      const m: Record<string, string> = {}
      FIELDS.forEach(f => { m[f.key] = s[f.key] != null ? String(s[f.key]) : "" })
      setForm(m)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const set = (k: string, v: string) => { setForm(p => ({ ...p, [k]: v })); setSaved(false) }

  const save = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = { ...form }
    payload.delivery_days = Number(form.delivery_days) || 0
    const res = await api.companySettings.save(payload, getAdminKey())
    setSaving(false)
    if (res?.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    else alert(res?.error || "Не удалось сохранить")
  }

  if (loading) return <p className="py-10 text-center text-sm text-foreground/40">Загрузка...</p>

  return (
    <div className="max-w-2xl">
      <h2 className="mb-1 text-xl font-light text-foreground">Реквизиты для договора поставки</h2>
      <p className="mb-5 text-sm text-foreground/50">Подставляются автоматически в договор и спецификацию.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(f => (
          <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
            <label className="mb-1 block text-xs text-foreground/60">{f.label}</label>
            <Input value={form[f.key] || ""} onChange={e => set(f.key, e.target.value)} placeholder={f.hint || ""} />
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          <Icon name={saving ? "Loader" : "Save"} size={15} className={`mr-1.5 ${saving ? "animate-spin" : ""}`} />
          {saving ? "Сохранение..." : "Сохранить"}
        </Button>
        {saved && <span className="flex items-center gap-1 text-sm text-green-500"><Icon name="Check" size={15} />Сохранено</span>}
      </div>
    </div>
  )
}
