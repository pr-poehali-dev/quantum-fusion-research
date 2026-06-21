import { useState, useMemo } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { SpecSchema, SpecLink, LinkRule, RULE_LABELS, RULE_SYMBOL } from "./types"
import { Modal, Field, ModalFooter } from "./AttributesBuilder"

interface Props { schema: SpecSchema; reload: () => void }

export default function LinksMap({ schema, reload }: Props) {
  const [editLink, setEditLink] = useState<SpecLink | "new" | null>(null)

  const attrById = useMemo(() => {
    const m: Record<number, { name: string; cat: number }> = {}
    schema.attributes.forEach(a => { m[a.id] = { name: a.name, cat: a.category_id } })
    return m
  }, [schema.attributes])

  const catById = useMemo(() => {
    const m: Record<number, { name: string; color: string; icon: string }> = {}
    schema.categories.forEach(c => { m[c.id] = { name: c.name, color: c.color || "#64748b", icon: c.icon || "Package" } })
    return m
  }, [schema.categories])

  // Узлы графа по кругу
  const W = 720, H = 460, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 70
  const nodes = useMemo(() => {
    const n = schema.categories.length || 1
    return schema.categories.map((c, i) => {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2
      return { ...c, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }
    })
  }, [schema.categories, cx, cy, R])
  const nodePos = useMemo(() => {
    const m: Record<number, { x: number; y: number }> = {}
    nodes.forEach(n => { m[n.id] = { x: n.x, y: n.y } })
    return m
  }, [nodes])

  // Рёбра графа: связь между категориями (по атрибутам)
  const edges = useMemo(() => {
    return schema.links.filter(l => l.is_active).map(l => {
      const fromCat = attrById[l.from_attribute_id]?.cat
      const toCat = attrById[l.to_attribute_id]?.cat
      if (fromCat == null || toCat == null) return null
      const a = nodePos[fromCat], b = nodePos[toCat]
      if (!a || !b) return null
      return { id: l.id, a, b, rule: l.rule }
    }).filter(Boolean) as { id: number; a: { x: number; y: number }; b: { x: number; y: number }; rule: LinkRule }[]
  }, [schema.links, attrById, nodePos])

  const linkLabel = (l: SpecLink) => {
    const fa = attrById[l.from_attribute_id], ta = attrById[l.to_attribute_id]
    const fc = fa ? catById[fa.cat]?.name : "?", tc = ta ? catById[ta.cat]?.name : "?"
    return `${fc}.${fa?.name || "?"} ${RULE_SYMBOL[l.rule]} ${tc}.${ta?.name || "?"}`
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-foreground">Карта совместимости</h3>
          <p className="text-xs text-foreground/40">Правила связывают характеристики разных категорий. По ним конфигуратор подбирает совместимое.</p>
        </div>
        <button onClick={() => setEditLink("new")} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" style={{ cursor: "pointer" }}>
          <Icon name="Plus" size={15} /> Правило
        </button>
      </div>

      {/* Граф */}
      <div className="mb-6 overflow-x-auto rounded-xl border border-border bg-card p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full" style={{ maxWidth: W }}>
          {edges.map((e, i) => (
            <line key={i} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y}
              stroke="currentColor" className="text-primary/30" strokeWidth={2} />
          ))}
          {nodes.map(n => (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={26} fill={(n.color || "#64748b") + "22"} stroke={n.color || "#64748b"} strokeWidth={2} />
              <text x={n.x} y={n.y + 44} textAnchor="middle" className="fill-foreground text-[11px] font-medium">{n.name}</text>
            </g>
          ))}
        </svg>
        {/* иконки поверх узлов (svg foreignObject ненадёжен — рисуем абсолютно) */}
      </div>

      {/* Список правил */}
      {schema.links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-foreground/40">Нет правил. Добавьте первое.</div>
      ) : (
        <div className="space-y-2">
          {schema.links.map(l => (
            <div key={l.id} className={`flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 ${!l.is_active ? "opacity-50" : ""}`}>
              <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-bold text-primary">{RULE_SYMBOL[l.rule]}</span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{l.name || linkLabel(l)}</p>
                <p className="truncate text-xs text-foreground/40">{linkLabel(l)} — {RULE_LABELS[l.rule]}</p>
              </div>
              <button onClick={() => setEditLink(l)} className="text-foreground/40 hover:text-primary" style={{ cursor: "pointer" }}><Icon name="Pencil" size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {editLink && <LinkModal link={editLink === "new" ? null : editLink} schema={schema} attrById={attrById} catById={catById}
        onClose={() => setEditLink(null)} onSaved={() => { setEditLink(null); reload() }} />}
    </div>
  )
}

function LinkModal({ link, schema, attrById, catById, onClose, onSaved }: {
  link: SpecLink | null; schema: SpecSchema
  attrById: Record<number, { name: string; cat: number }>
  catById: Record<number, { name: string; color: string; icon: string }>
  onClose: () => void; onSaved: () => void
}) {
  const [fromAttr, setFromAttr] = useState(link?.from_attribute_id || 0)
  const [toAttr, setToAttr] = useState(link?.to_attribute_id || 0)
  const [rule, setRule] = useState<LinkRule>(link?.rule || "eq")
  const [name, setName] = useState(link?.name || "")
  const [active, setActive] = useState(link?.is_active ?? true)
  const [saving, setSaving] = useState(false)
  const inp = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"

  // Только характеристики, влияющие на совместимость
  const compatAttrs = schema.attributes.filter(a => a.affects_compat)
  const optGroups = schema.categories.map(c => ({
    cat: c, attrs: compatAttrs.filter(a => a.category_id === c.id),
  })).filter(g => g.attrs.length > 0)

  const renderOpts = () => optGroups.map(g => (
    <optgroup key={g.cat.id} label={g.cat.name}>
      {g.attrs.map(a => <option key={a.id} value={a.id}>{g.cat.name}.{a.name}</option>)}
    </optgroup>
  ))

  const save = async () => {
    if (!fromAttr || !toAttr) return
    setSaving(true)
    if (link) await api.warehouse.specLinkUpdate({ id: link.id, from_attribute_id: fromAttr, to_attribute_id: toAttr, rule, name: name || null, is_active: active })
    else await api.warehouse.specLinkCreate({ from_attribute_id: fromAttr, to_attribute_id: toAttr, rule, name: name || null })
    setSaving(false)
    onSaved()
  }
  const del = async () => {
    if (!link || !confirm("Удалить правило?")) return
    await api.warehouse.specLinkDelete(link.id)
    onSaved()
  }

  return (
    <Modal title={link ? "Правило связи" : "Новое правило"} onClose={onClose}>
      <Field label="Характеристика 1">
        <select value={fromAttr} onChange={e => setFromAttr(Number(e.target.value))} className={inp} style={{ cursor: "pointer" }}>
          <option value={0}>— выбрать —</option>{renderOpts()}
        </select>
      </Field>
      <Field label="Правило">
        <select value={rule} onChange={e => setRule(e.target.value as LinkRule)} className={inp} style={{ cursor: "pointer" }}>
          {Object.entries(RULE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Характеристика 2">
        <select value={toAttr} onChange={e => setToAttr(Number(e.target.value))} className={inp} style={{ cursor: "pointer" }}>
          <option value={0}>— выбрать —</option>{renderOpts()}
        </select>
      </Field>
      <Field label="Название (необязательно)">
        <input value={name} onChange={e => setName(e.target.value)} className={inp} placeholder="Сокет процессора = сокет платы" />
      </Field>
      {link && (
        <button onClick={() => setActive(v => !v)} className="flex items-center gap-2 text-sm text-foreground/70" style={{ cursor: "pointer" }}>
          <Icon name={active ? "ToggleRight" : "ToggleLeft"} size={20} className={active ? "text-primary" : "text-foreground/30"} />
          {active ? "Правило активно" : "Правило отключено"}
        </button>
      )}
      <ModalFooter onClose={onClose} onSave={save} saving={saving} onDelete={link ? del : undefined} />
    </Modal>
  )
}
