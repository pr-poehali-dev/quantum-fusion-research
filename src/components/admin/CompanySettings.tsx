import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { getAdminKey } from "@/pages/admin/constants"

interface Entity {
  id: number
  title: string
  supplier_name: string
  supplier_person: string
  sign_name: string
  rs: string
  bank: string
  ks: string
  bik: string
  inn: string
  ogrnip: string
  city: string
  delivery_days: number | string
  is_default: boolean
}

const FIELDS: { key: keyof Entity; label: string; hint?: string; wide?: boolean }[] = [
  { key: "title", label: "Название (для выбора)", hint: "ИП Колодяжный / ООО ...", wide: true },
  { key: "supplier_name", label: "Поставщик (в договоре)", hint: "ИП Колодяжный Михаил Георгиевич", wide: true },
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
  const [entities, setEntities] = useState<Entity[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = (selectId?: number) => {
    api.companySettings.list().then(d => {
      const list: Entity[] = d.entities || []
      setEntities(list)
      setActiveId(selectId ?? (list.find(e => e.is_default)?.id ?? list[0]?.id ?? null))
      setLoading(false)
    }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const active = entities.find(e => e.id === activeId) || null
  const set = (k: keyof Entity, v: string) => {
    setEntities(es => es.map(e => e.id === activeId ? { ...e, [k]: v } : e))
    setSaved(false)
  }

  const save = async () => {
    if (!active) return
    setSaving(true)
    const payload: Record<string, unknown> = { id: active.id }
    FIELDS.forEach(f => { payload[f.key] = f.key === "delivery_days" ? (Number(active.delivery_days) || 0) : active[f.key] })
    const res = await api.companySettings.update(payload, getAdminKey())
    setSaving(false)
    if (res?.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    else alert(res?.error || "Не удалось сохранить")
  }

  const addEntity = async () => {
    const title = prompt("Название нового юрлица:", "Новое юрлицо")
    if (!title) return
    const res = await api.companySettings.create(title, getAdminKey())
    if (res?.entity) load(res.entity.id)
    else alert(res?.error || "Ошибка")
  }

  const removeEntity = async () => {
    if (!active) return
    if (!confirm(`Удалить юрлицо «${active.title}»?`)) return
    const res = await api.companySettings.remove(active.id, getAdminKey())
    if (res?.ok) load()
    else alert(res?.error || "Ошибка")
  }

  const makeDefault = async () => {
    if (!active) return
    const res = await api.companySettings.setDefault(active.id, getAdminKey())
    if (res?.ok) load(active.id)
  }

  if (loading) return <p className="py-10 text-center text-sm text-foreground/40">Загрузка...</p>

  return (
    <div className="max-w-2xl">
      <h2 className="mb-1 text-xl font-light text-foreground">Реквизиты для договора поставки</h2>
      <p className="mb-5 text-sm text-foreground/50">Несколько юрлиц. При создании договора выбирается нужное.</p>

      {/* Список юрлиц */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {entities.map(e => (
          <button key={e.id} onClick={() => setActiveId(e.id)} style={{ cursor: "pointer" }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              e.id === activeId ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary"}`}>
            {e.title || "Без названия"}
            {e.is_default && <Icon name="Star" size={12} className="text-yellow-500" />}
          </button>
        ))}
        <button onClick={addEntity} style={{ cursor: "pointer" }}
          className="flex items-center gap-1 rounded-lg border border-dashed border-primary/50 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 transition-colors">
          <Icon name="Plus" size={14} />Добавить юрлицо
        </button>
      </div>

      {active && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map(f => (
              <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                <label className="mb-1 block text-xs text-foreground/60">{f.label}</label>
                <Input value={String(active[f.key] ?? "")} onChange={e => set(f.key, e.target.value)} placeholder={f.hint || ""} />
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={saving}>
              <Icon name={saving ? "Loader" : "Save"} size={15} className={`mr-1.5 ${saving ? "animate-spin" : ""}`} />
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
            {!active.is_default && (
              <button onClick={makeDefault} style={{ cursor: "pointer" }}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground/70 hover:border-primary transition-colors">
                <Icon name="Star" size={14} />Сделать по умолчанию
              </button>
            )}
            <button onClick={removeEntity} style={{ cursor: "pointer" }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:border-red-400/40 transition-colors">
              <Icon name="Trash2" size={14} />Удалить
            </button>
            {saved && <span className="flex items-center gap-1 text-sm text-green-500"><Icon name="Check" size={15} />Сохранено</span>}
          </div>
        </>
      )}
    </div>
  )
}