import { useState, useEffect, useMemo } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"

// Характеристика категории (из spec_attributes)
interface SpecAttr {
  id: number
  category_id: number
  code: string
  name: string
  field_type: string        // select | multiselect | number | bool | text
  options: string[]
  unit?: string | null
  sort_order: number
  applies_to?: string
}

interface SpecCategory {
  id: number
  product_category_slug?: string | null
}

export type SpecValue = string | string[]

interface Props {
  // slug категории товара (categories.slug) — по нему ищем spec-категорию
  categorySlug: string | null
  // текущие значения характеристик: { attribute_id: value | [..] }
  values: Record<string, SpecValue>
  onChange: (values: Record<string, SpecValue>) => void
}

// Пошаговый мастер заполнения характеристик товара по выбранной категории.
// Поля и их типы тянутся из spec_attributes (data-driven), значения
// автоматически привязываются к характеристикам товара при сохранении.
export default function ProductSpecWizard({ categorySlug, values, onChange }: Props) {
  const [cats, setCats] = useState<SpecCategory[]>([])
  const [attrs, setAttrs] = useState<SpecAttr[]>([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(0)

  useEffect(() => {
    api.warehouse.specSchema().then(d => {
      setCats(d.categories || [])
      setAttrs(d.attributes || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // spec-категория, привязанная к категории товара по slug
  const specCatId = useMemo(() => {
    if (!categorySlug) return null
    const c = cats.find(x => x.product_category_slug === categorySlug)
    return c ? c.id : null
  }, [cats, categorySlug])

  // Характеристики выбранной категории (без служебных/скрытых)
  const steps = useMemo(() =>
    attrs
      .filter(a => a.category_id === specCatId)
      .filter(a => a.applies_to !== "hidden")
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
  [attrs, specCatId])

  useEffect(() => { setStep(0) }, [specCatId])

  if (loading) return <p className="text-sm text-foreground/40">Загрузка характеристик…</p>
  if (!categorySlug) return <p className="text-sm text-foreground/40">Сначала выберите категорию товара.</p>
  if (specCatId === null || steps.length === 0)
    return <p className="text-sm text-foreground/40">Для этой категории характеристики не заданы.</p>

  const safeStep = Math.min(step, steps.length - 1)
  const a = steps[safeStep]
  const cur = values[String(a.id)]

  const setVal = (v: SpecValue) => onChange({ ...values, [String(a.id)]: v })
  const filled = (aid: number) => {
    const v = values[String(aid)]
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== ""
  }
  const filledCount = steps.filter(s => filled(s.id)).length

  const next = () => setStep(s => Math.min(s + 1, steps.length - 1))
  const prev = () => setStep(s => Math.max(s - 1, 0))
  const toggleMulti = (opt: string) => {
    const arr = Array.isArray(cur) ? [...cur] : []
    const i = arr.indexOf(opt)
    if (i >= 0) arr.splice(i, 1); else arr.push(opt)
    setVal(arr)
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Характеристики</span>
        <span className="text-xs text-foreground/40">Заполнено {filledCount} из {steps.length}</span>
      </div>

      {/* Прогресс-точки по шагам */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {steps.map((s, i) => (
          <button key={s.id} type="button" onClick={() => setStep(i)} style={{ cursor: "pointer" }}
            title={s.name}
            className={`h-1.5 flex-1 min-w-[14px] rounded-full transition-colors ${
              i === safeStep ? "bg-primary" : filled(s.id) ? "bg-primary/40" : "bg-muted"}`} />
        ))}
      </div>

      {/* Текущий шаг */}
      <div className="mb-4">
        <p className="mb-2 text-sm font-medium text-foreground">
          {a.name}{a.unit ? <span className="text-foreground/40"> ({a.unit})</span> : ""}
          <span className="ml-2 text-xs font-normal text-foreground/30">шаг {safeStep + 1} / {steps.length}</span>
        </p>

        {/* select — кнопки-варианты */}
        {a.field_type === "select" && (
          a.options.length ? (
            <div className="flex flex-wrap gap-2">
              {a.options.map(opt => (
                <button key={opt} type="button" onClick={() => setVal(cur === opt ? "" : opt)} style={{ cursor: "pointer" }}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    cur === opt ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary"}`}>
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <input value={typeof cur === "string" ? cur : ""} onChange={e => setVal(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
              placeholder="Введите значение" style={{ cursor: "text" }} />
          )
        )}

        {/* multiselect — мультивыбор */}
        {a.field_type === "multiselect" && (
          <div className="flex flex-wrap gap-2">
            {a.options.map(opt => {
              const on = Array.isArray(cur) && cur.includes(opt)
              return (
                <button key={opt} type="button" onClick={() => toggleMulti(opt)} style={{ cursor: "pointer" }}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    on ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary"}`}>
                  {on && <Icon name="Check" size={13} className="mr-1 inline" />}{opt}
                </button>
              )
            })}
          </div>
        )}

        {/* number */}
        {a.field_type === "number" && (
          <input type="text" inputMode="decimal" value={typeof cur === "string" ? cur : ""}
            onChange={e => setVal(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
            placeholder={a.unit ? `Например, 1000 ${a.unit}` : "Число"} style={{ cursor: "text" }} />
        )}

        {/* bool */}
        {a.field_type === "bool" && (
          <div className="flex gap-2">
            {[["Да", "1"], ["Нет", "0"]].map(([label, val]) => (
              <button key={val} type="button" onClick={() => setVal(cur === val ? "" : val)} style={{ cursor: "pointer" }}
                className={`rounded-lg border px-4 py-1.5 text-sm transition-colors ${
                  cur === val ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:border-primary"}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* text */}
        {a.field_type === "text" && (
          <input value={typeof cur === "string" ? cur : ""} onChange={e => setVal(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
            placeholder="Введите значение" style={{ cursor: "text" }} />
        )}
      </div>

      {/* Навигация */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={prev} disabled={safeStep === 0} style={{ cursor: "pointer" }}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground/60 hover:border-primary hover:text-foreground disabled:opacity-40 transition-colors">
          <Icon name="ChevronLeft" size={15} /> Назад
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={next} disabled={safeStep >= steps.length - 1} style={{ cursor: "pointer" }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground/50 hover:text-foreground disabled:opacity-40 transition-colors">
            Пропустить
          </button>
          <button type="button" onClick={next} disabled={safeStep >= steps.length - 1} style={{ cursor: "pointer" }}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
            Далее <Icon name="ChevronRight" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
