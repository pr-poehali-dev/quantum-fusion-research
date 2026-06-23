import { useState } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import {
  SpecSchema, SpecCategory, SpecAttribute, FieldType,
  FIELD_TYPE_LABELS, CATEGORY_ICONS, CATEGORY_COLORS,
} from "./types"

interface Props {
  schema: SpecSchema
  productCategorySlugs: { slug: string; name: string }[]
  reload: () => void
}

export default function AttributesBuilder({ schema, productCategorySlugs, reload }: Props) {
  const [activeCat, setActiveCat] = useState<number | null>(schema.categories[0]?.id ?? null)
  const [editCat, setEditCat] = useState<SpecCategory | "new" | null>(null)
  const [editAttr, setEditAttr] = useState<SpecAttribute | "new" | null>(null)

  const cat = schema.categories.find(c => c.id === activeCat) || null
  const attrs = schema.attributes.filter(a => a.category_id === activeCat).sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="flex gap-6">
      {/* Список категорий компонентов */}
      <div className="w-64 shrink-0">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-foreground/50">Категории</span>
          <button onClick={() => setEditCat("new")} className="text-primary hover:opacity-80" style={{ cursor: "pointer" }}>
            <Icon name="Plus" size={16} />
          </button>
        </div>
        <div className="space-y-1">
          {schema.categories.map(c => {
            const count = schema.attributes.filter(a => a.category_id === c.id).length
            return (
              <button key={c.id} onClick={() => setActiveCat(c.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${activeCat === c.id ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-muted"}`}
                style={{ cursor: "pointer" }}>
                <span className="flex h-6 w-6 items-center justify-center rounded" style={{ background: (c.color || "#64748b") + "22" }}>
                  <Icon name={(c.icon || "Package") as "Package"} size={14} fallback="Package" />
                </span>
                <span className="flex-1 text-left truncate">{c.name}</span>
                <span className="text-xs text-foreground/30">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Характеристики выбранной категории */}
      <div className="flex-1">
        {!cat ? (
          <div className="py-20 text-center text-foreground/40">Выберите или создайте категорию</div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-foreground">{cat.name}</h3>
                <p className="text-xs text-foreground/40">
                  Привязка к категории товаров: {cat.product_category_slug
                    ? productCategorySlugs.find(p => p.slug === cat.product_category_slug)?.name || cat.product_category_slug
                    : "— не задана"}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditCat(cat)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground/70 hover:text-foreground" style={{ cursor: "pointer" }}>
                  Настроить категорию
                </button>
                <button onClick={() => setEditAttr("new")} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
                  <Icon name="Plus" size={14} /> Характеристика
                </button>
              </div>
            </div>

            {attrs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-foreground/40">
                Нет характеристик. Нажмите «Характеристика», чтобы добавить.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase text-foreground/50">
                      <th className="px-4 py-2.5 font-medium">Название</th>
                      <th className="px-4 py-2.5 font-medium">Тип</th>
                      <th className="px-4 py-2.5 font-medium">Роль</th>
                      <th className="px-4 py-2.5 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {attrs.map(a => (
                      <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground">{a.name}</span>
                          {a.unit && <span className="ml-1 text-foreground/40">, {a.unit}</span>}
                          {a.is_required && <span className="ml-2 text-amber-500" title="Обязательная">*</span>}
                          <span className="ml-1 block text-xs text-foreground/30">{a.code}</span>
                        </td>
                        <td className="px-4 py-3 text-foreground/60">
                          {FIELD_TYPE_LABELS[a.field_type]}
                          {a.options.length > 0 && <span className="ml-1 text-foreground/30">({a.options.length})</span>}
                        </td>
                        <td className="px-4 py-3">
                          {a.affects_compat ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                              <Icon name="Link2" size={11} /> Совместимость
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/50">
                              <Icon name="Eye" size={11} /> Ознакомление
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => setEditAttr(a)} className="text-foreground/40 hover:text-primary" style={{ cursor: "pointer" }}>
                            <Icon name="Pencil" size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {editCat && (
        <CategoryModal cat={editCat === "new" ? null : editCat} slugs={productCategorySlugs}
          onClose={() => setEditCat(null)} onSaved={(id) => { setEditCat(null); if (id) setActiveCat(id); reload() }} />
      )}
      {editAttr && cat && (
        <AttributeModal attr={editAttr === "new" ? null : editAttr} categoryId={cat.id}
          onClose={() => setEditAttr(null)} onSaved={() => { setEditAttr(null); reload() }} />
      )}
    </div>
  )
}

// ── Модалка категории ────────────────────────────────────────────────────────
function CategoryModal({ cat, slugs, onClose, onSaved }:
  { cat: SpecCategory | null; slugs: { slug: string; name: string }[]; onClose: () => void; onSaved: (id?: number) => void }) {
  const [name, setName] = useState(cat?.name || "")
  const [code, setCode] = useState(cat?.code || "")
  const [icon, setIcon] = useState(cat?.icon || "Package")
  const [color, setColor] = useState(cat?.color || "#64748b")
  const [slug, setSlug] = useState(cat?.product_category_slug || "")
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim() || !code.trim()) return
    setSaving(true)
    let res
    if (cat) res = await api.warehouse.specCatUpdate({ id: cat.id, name, icon, color, product_category_slug: slug || null })
    else res = await api.warehouse.specCatCreate({ code: code.trim(), name, icon, color, product_category_slug: slug || null })
    setSaving(false)
    onSaved(res?.id)
  }
  const del = async () => {
    if (!cat || !confirm("Удалить категорию со всеми характеристиками и связями?")) return
    await api.warehouse.specCatDelete(cat.id)
    onSaved()
  }

  return (
    <Modal title={cat ? "Категория компонента" : "Новая категория"} onClose={onClose}>
      <Field label="Название"><input value={name} onChange={e => setName(e.target.value)} className={inp} placeholder="Процессор" /></Field>
      {!cat && <Field label="Код (латиницей, без пробелов)"><input value={code} onChange={e => setCode(e.target.value.replace(/\s/g, "_").toLowerCase())} className={inp} placeholder="cpu" /></Field>}
      <Field label="Иконка">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_ICONS.map(ic => (
            <button key={ic} onClick={() => setIcon(ic)} className={`flex h-9 w-9 items-center justify-center rounded-lg border ${icon === ic ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/50"}`} style={{ cursor: "pointer" }}>
              <Icon name={ic as "Package"} size={16} fallback="Package" />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Цвет (для карты связей)">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} className={`h-8 w-8 rounded-lg border-2 ${color === c ? "border-foreground" : "border-transparent"}`} style={{ background: c, cursor: "pointer" }} />
          ))}
        </div>
      </Field>
      <Field label="Какие товары относятся к этой категории">
        <select value={slug} onChange={e => setSlug(e.target.value)} className={inp} style={{ cursor: "pointer" }}>
          <option value="">— не привязано —</option>
          {slugs.map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </select>
      </Field>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} onDelete={cat ? del : undefined} />
    </Modal>
  )
}

// ── Модалка характеристики ───────────────────────────────────────────────────
function AttributeModal({ attr, categoryId, onClose, onSaved }:
  { attr: SpecAttribute | null; categoryId: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(attr?.name || "")
  const [code, setCode] = useState(attr?.code || "")
  const [fieldType, setFieldType] = useState<FieldType>(attr?.field_type || "text")
  const [unit, setUnit] = useState(attr?.unit || "")
  const [options, setOptions] = useState<string[]>(attr?.options || [])
  const [draft, setDraft] = useState("")
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editText, setEditText] = useState("")
  const [affects, setAffects] = useState(attr?.affects_compat ?? false)
  const [required, setRequired] = useState(attr?.is_required ?? false)
  const [appliesTo, setAppliesTo] = useState<"all" | "air" | "liquid">(attr?.applies_to || "all")
  const [saving, setSaving] = useState(false)

  const hasOptions = fieldType === "select" || fieldType === "multiselect"

  const addOption = () => {
    const v = draft.trim()
    if (!v || options.includes(v)) { setDraft(""); return }
    setOptions(o => [...o, v])
    setDraft("")
  }
  const removeOption = (i: number) => setOptions(o => o.filter((_, idx) => idx !== i))
  const startEdit = (i: number) => { setEditIdx(i); setEditText(options[i]) }
  const commitEdit = () => {
    if (editIdx === null) return
    const v = editText.trim()
    setOptions(o => v ? o.map((x, idx) => idx === editIdx ? v : x) : o.filter((_, idx) => idx !== editIdx))
    setEditIdx(null); setEditText("")
  }

  const save = async () => {
    if (!name.trim() || (!attr && !code.trim())) return
    setSaving(true)
    const payload = { name, field_type: fieldType, unit: unit || null, options: hasOptions ? options : [], affects_compat: affects, is_required: required, applies_to: appliesTo }
    if (attr) await api.warehouse.specAttrUpdate({ id: attr.id, ...payload })
    else await api.warehouse.specAttrCreate({ category_id: categoryId, code: code.trim(), ...payload })
    setSaving(false)
    onSaved()
  }
  const del = async () => {
    if (!attr || !confirm("Удалить характеристику? Значения у товаров и связи тоже удалятся.")) return
    await api.warehouse.specAttrDelete(attr.id)
    onSaved()
  }

  return (
    <Modal title={attr ? "Характеристика" : "Новая характеристика"} onClose={onClose}>
      <Field label="Название"><input value={name} onChange={e => setName(e.target.value)} className={inp} placeholder="Сокет" /></Field>
      {!attr && <Field label="Код (латиницей)"><input value={code} onChange={e => setCode(e.target.value.replace(/\s/g, "_").toLowerCase())} className={inp} placeholder="socket" /></Field>}
      <Field label="Тип поля">
        <select value={fieldType} onChange={e => setFieldType(e.target.value as FieldType)} className={inp} style={{ cursor: "pointer" }}>
          {Object.entries(FIELD_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      {hasOptions && (
        <Field label="Варианты">
          <div className="flex gap-2">
            <input value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addOption() } }}
              className={inp} placeholder="Напишите вариант и нажмите Enter" />
            <button type="button" onClick={addOption}
              className="shrink-0 rounded-lg bg-primary px-3 text-primary-foreground hover:opacity-90" style={{ cursor: "pointer" }}>
              <Icon name="Plus" size={16} />
            </button>
          </div>
          {options.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
                  {editIdx === i ? (
                    <input autoFocus value={editText} onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitEdit() } }}
                      onBlur={commitEdit}
                      className="flex-1 bg-transparent text-sm outline-none" />
                  ) : (
                    <span className="flex-1 text-sm text-foreground cursor-text" onClick={() => startEdit(i)}>{o}</span>
                  )}
                  <button type="button" onClick={() => startEdit(i)} className="text-foreground/30 hover:text-primary" style={{ cursor: "pointer" }}>
                    <Icon name="Pencil" size={13} />
                  </button>
                  <button type="button" onClick={() => removeOption(i)} className="text-foreground/30 hover:text-red-400" style={{ cursor: "pointer" }}>
                    <Icon name="X" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Field>
      )}
      {fieldType === "number" && (
        <Field label="Единица измерения"><input value={unit} onChange={e => setUnit(e.target.value)} className={inp} placeholder="мм / Вт / ГБ" /></Field>
      )}
      <Field label="Показывать для (охлаждение)">
        <select value={appliesTo} onChange={e => setAppliesTo(e.target.value as "all" | "air" | "liquid")} className={inp} style={{ cursor: "pointer" }}>
          <option value="all">Всегда (любой тип)</option>
          <option value="air">Только воздушное охлаждение</option>
          <option value="liquid">Только жидкостное (СЖО)</option>
        </select>
        <p className="mt-1 text-xs text-foreground/40">Для категории охлаждения: поле появится только если у товара выбран этот тип. Для остальных категорий оставьте «Всегда».</p>
      </Field>
      <div className="space-y-2 rounded-lg border border-border p-3">
        <Toggle on={affects} onClick={() => setAffects(v => !v)}
          label="Влияет на совместимость" hint="Можно использовать в правилах связей. Иначе — просто для ознакомления." />
        <Toggle on={required} onClick={() => setRequired(v => !v)}
          label="Обязательная для заполнения" hint="Пока не заполнена — товар в статусе «Новый»." />
      </div>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} onDelete={attr ? del : undefined} />
    </Modal>
  )
}

// ── Мелкие UI-хелперы ────────────────────────────────────────────────────────
const inp = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-background p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground" style={{ cursor: "pointer" }}><Icon name="X" size={20} /></button>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-sm font-medium text-foreground/80">{label}</label>{children}</div>
}

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button onClick={onClick} className="flex w-full items-start gap-3 text-left" style={{ cursor: "pointer" }}>
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? "bg-primary" : "bg-muted"}`}>
        <span className={`h-4 w-4 rounded-full bg-white transition-transform ${on ? "translate-x-4" : ""}`} />
      </span>
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-foreground/40">{hint}</span>
      </span>
    </button>
  )
}

export function ModalFooter({ onClose, onSave, saving, onDelete }:
  { onClose: () => void; onSave: () => void; saving: boolean; onDelete?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {onDelete ? (
        <button onClick={onDelete} className="text-sm text-red-400 hover:text-red-300" style={{ cursor: "pointer" }}>Удалить</button>
      ) : <span />}
      <div className="flex gap-2">
        <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:text-foreground" style={{ cursor: "pointer" }}>Отмена</button>
        <button onClick={onSave} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50" style={{ cursor: "pointer" }}>
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </div>
  )
}