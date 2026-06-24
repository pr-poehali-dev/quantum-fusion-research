import { useEffect, useState, useCallback, useRef } from "react"
import { api } from "@/lib/api"
import Icon from "@/components/ui/icon"
import { getAdminKey } from "@/pages/admin/types"
import { MetricPref, CATEGORIES, categoryOf, prefId } from "@/components/admin/metricUtils"

// Метрика, как она приходит в прогоне (для подтягивания списка известных метрик).
interface SeenMetric { key: string; label: string }

interface Props {
  highlight?: string | null
  onHighlightDone?: () => void
}

export default function MetricPrefsTab({ highlight, onHighlightDone }: Props) {
  const adminKey = getAdminKey()
  const [prefs, setPrefs] = useState<MetricPref[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.stress.metricPrefsList(adminKey),
      api.stress.list(adminKey),
    ]).then(async ([prefsRes, runsRes]) => {
      const existing: MetricPref[] = prefsRes.prefs || []

      // Подтягиваем метрики из последних прогонов, чтобы было что настраивать,
      // даже если prefs ещё пустые.
      const seen = new Map<string, SeenMetric>()
      const runs = (runsRes.runs || []).slice(0, 5)
      for (const r of runs) {
        const det = await api.stress.get(r.id, adminKey)
        for (const m of (det.run?.metrics || []) as { key: string; label: string }[]) {
          seen.set(prefId(m.key, m.label), { key: m.key, label: m.label })
        }
      }

      // Сливаем: существующие prefs + новые увиденные метрики.
      const byId = new Map(existing.map(p => [prefId(p.metric_key, p.label_orig), p]))
      let order = existing.length
      for (const [id, sm] of seen) {
        if (!byId.has(id)) {
          byId.set(id, {
            metric_key: sm.key, label_orig: sm.label, label_custom: "",
            category: categoryOf(sm.key), visible: true, sort_order: order++,
          })
        }
      }
      const merged = Array.from(byId.values()).sort((a, b) => a.sort_order - b.sort_order)
      setPrefs(merged)
    }).finally(() => setLoading(false))
  }, [adminKey])

  useEffect(() => { load() }, [load])

  // Подсветка метрики при переходе по двойному клику из карточки прогона.
  useEffect(() => {
    if (!highlight || loading || prefs.length === 0) return
    setFlash(highlight)
    const el = rowRefs.current[highlight]
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
    const t = setTimeout(() => { setFlash(null); onHighlightDone?.() }, 2500)
    return () => clearTimeout(t)
  }, [highlight, loading, prefs.length, onHighlightDone])

  const upd = (i: number, patch: Partial<MetricPref>) =>
    setPrefs(prefs.map((p, idx) => idx === i ? { ...p, ...patch } : p))

  const save = () => {
    setSaving(true)
    const ordered = prefs.map((p, i) => ({ ...p, sort_order: i }))
    api.stress.metricPrefsSave(ordered, adminKey).then(() => load()).finally(() => setSaving(false))
  }

  // Drag & drop (нативный HTML5)
  const onDrop = (i: number) => {
    if (dragIdx === null || dragIdx === i) return
    const arr = [...prefs]
    const [moved] = arr.splice(dragIdx, 1)
    arr.splice(i, 0, moved)
    setPrefs(arr)
    setDragIdx(null)
  }

  if (loading) return (
    <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
  )

  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Настройка метрик</h2>
          <p className="mt-0.5 text-xs text-foreground/40">Скрывай ненужное, меняй порядок (перетаскивай), задавай свои названия и категории.</p>
        </div>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors" style={{ cursor: "pointer" }}>
          <Icon name="Save" size={15} /> {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </div>

      {prefs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-foreground/40">
          Метрик пока нет. Прогони тест с запущенным приложением — датчики появятся здесь автоматически.
        </div>
      ) : (
        <div className="space-y-1.5">
          {prefs.map((p, i) => {
            const id = prefId(p.metric_key, p.label_orig)
            const isFlash = flash === id
            return (
            <div key={id}
              ref={el => { rowRefs.current[id] = el }}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(i)}
              className={`flex items-center gap-2 rounded-xl border p-2.5 transition-all ${isFlash ? "border-primary bg-primary/10 ring-2 ring-primary" : dragIdx === i ? "border-primary bg-card opacity-60" : "border-border bg-card"} ${!p.visible ? "opacity-50" : ""}`}>
              <Icon name="GripVertical" size={16} className="shrink-0 cursor-grab text-foreground/30" />

              {/* Видимость */}
              <button onClick={() => upd(i, { visible: !p.visible })}
                className="shrink-0 rounded-lg border border-border p-1.5 hover:border-primary transition-colors" style={{ cursor: "pointer" }}
                title={p.visible ? "Скрыть" : "Показать"}>
                <Icon name={p.visible ? "Eye" : "EyeOff"} size={14} className={p.visible ? "text-foreground/70" : "text-foreground/30"} />
              </button>

              {/* Название (своё / исходное как placeholder) */}
              <input value={p.label_custom} onChange={e => upd(i, { label_custom: e.target.value })}
                placeholder={p.label_orig}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary" />

              {/* Категория */}
              <select value={p.category} onChange={e => upd(i, { category: e.target.value })}
                className="shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary" style={{ cursor: "pointer" }}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>

              <span className="shrink-0 w-16 truncate text-right text-[11px] text-foreground/30" title={p.metric_key}>{p.metric_key}</span>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}