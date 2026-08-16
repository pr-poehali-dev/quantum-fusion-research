import { useState, useEffect } from "react"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"

export type ContractEntity = {
  id: number
  title: string
  is_default?: boolean
  delivery_days?: number | null
}

export type ContractParams = {
  entityId?: number
  prepay: string
  deliveryDays: string
  custName: string
  custPhone: string
  passport: string
}

// Диалог печати договора поставки: выбор юрлица + условия сделки.
// Значения предзаполняются из заказа, менеджер правит их перед печатью.
// Ничего не сохраняет в заказ — только влияет на текст PDF.
export function ContractDialog({ open, onClose, onPrint, defaultName, defaultPhone, defaultPrepay, loading }: {
  open: boolean
  onClose: () => void
  onPrint: (p: ContractParams) => void
  defaultName?: string
  defaultPhone?: string
  defaultPrepay?: number | null
  loading?: boolean
}) {
  const [entities, setEntities] = useState<ContractEntity[]>([])
  const [entityId, setEntityId] = useState<number | undefined>()
  const [prepay, setPrepay] = useState("")
  const [deliveryDays, setDeliveryDays] = useState("")
  const [custName, setCustName] = useState("")
  const [custPhone, setCustPhone] = useState("")
  const [passport, setPassport] = useState("")
  const [showPassport, setShowPassport] = useState(false)

  // При открытии подтягиваем юрлица и заполняем поля данными заказа.
  useEffect(() => {
    if (!open) return
    setCustName(defaultName || "")
    setCustPhone(defaultPhone || "")
    setPrepay(defaultPrepay ? String(Math.round(defaultPrepay)) : "")
    setPassport("")
    setShowPassport(false)
    api.companySettings.list().then(d => {
      const list: ContractEntity[] = d?.entities || []
      setEntities(list)
      const def = list.find(e => e.is_default) || list[0]
      setEntityId(def?.id)
      setDeliveryDays(def?.delivery_days ? String(def.delivery_days) : "")
    }).catch(() => setEntities([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Смена юрлица подставляет его типовой срок поставки.
  const pickEntity = (e: ContractEntity) => {
    setEntityId(e.id)
    if (e.delivery_days) setDeliveryDays(String(e.delivery_days))
  }

  if (!open) return null

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
  const labelCls = "mb-1 block text-xs text-foreground/60"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
            <Icon name="FileSignature" size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Договор поставки</h3>
            <p className="text-xs text-foreground/50">Проверьте данные перед печатью</p>
          </div>
        </div>

        {entities.length > 1 && (
          <div className="mb-4">
            <label className={labelCls}>Юрлицо</label>
            <div className="space-y-2">
              {entities.map(e => (
                <button key={e.id} type="button" onClick={() => pickEntity(e)} style={{ cursor: "pointer" }}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors ${
                    entityId === e.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-foreground/70 hover:border-primary/50"}`}>
                  <span className="font-medium">{e.title}</span>
                  {entityId === e.id && <Icon name="Check" size={15} className="shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Предоплата, ₽</label>
            <input value={prepay} onChange={e => setPrepay(e.target.value)} inputMode="numeric"
              placeholder="30% от суммы" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Срок поставки, дней</label>
            <input value={deliveryDays} onChange={e => setDeliveryDays(e.target.value)} inputMode="numeric"
              placeholder="из юрлица" className={inputCls} />
          </div>
        </div>

        <div className="mb-3">
          <label className={labelCls}>ФИО клиента</label>
          <input value={custName} onChange={e => setCustName(e.target.value)} className={inputCls} />
        </div>

        <div className="mb-3">
          <label className={labelCls}>Телефон</label>
          <input value={custPhone} onChange={e => setCustPhone(e.target.value)} className={inputCls} />
        </div>

        {showPassport ? (
          <div className="mb-3">
            <label className={labelCls}>Паспортные данные</label>
            <textarea value={passport} onChange={e => setPassport(e.target.value)} rows={2}
              placeholder="серия, номер, кем и когда выдан"
              className={`${inputCls} resize-none`} />
          </div>
        ) : (
          <button type="button" onClick={() => setShowPassport(true)} style={{ cursor: "pointer" }}
            className="mb-3 flex items-center gap-1.5 text-xs text-foreground/50 hover:text-foreground transition-colors">
            <Icon name="Plus" size={13} />Добавить паспортные данные
          </button>
        )}

        <div className="mt-5 flex gap-3">
          <button type="button" disabled={loading} style={{ cursor: "pointer" }}
            onClick={() => onPrint({ entityId, prepay, deliveryDays, custName, custPhone, passport })}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            <Icon name={loading ? "Loader" : "Printer"} size={15} className={loading ? "animate-spin" : ""} />
            {loading ? "Готовим..." : "Печать договора"}
          </button>
          <button type="button" onClick={onClose} style={{ cursor: "pointer" }}
            className="rounded-lg border border-border px-5 py-2.5 text-sm text-foreground/60 hover:text-foreground transition-colors">
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

// Собирает query-строку переопределений для generate-contract.
// Пустые поля не отправляем — бэкенд возьмёт значения из заказа/юрлица.
export function contractQuery(p: ContractParams): string {
  const qs = new URLSearchParams()
  if (p.entityId) qs.set("entity_id", String(p.entityId))
  if (p.prepay.trim()) qs.set("prepay", p.prepay.trim())
  if (p.deliveryDays.trim()) qs.set("delivery_days", p.deliveryDays.trim())
  if (p.custName.trim()) qs.set("cust_name", p.custName.trim())
  if (p.custPhone.trim()) qs.set("cust_phone", p.custPhone.trim())
  if (p.passport.trim()) qs.set("passport", p.passport.trim())
  const s = qs.toString()
  return s ? `&${s}` : ""
}

export default ContractDialog
