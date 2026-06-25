import { useState } from "react"
import { createPortal } from "react-dom"
import Icon from "@/components/ui/icon"
import ArticleChart from "./ArticleChart"
import { ChartConfig, ChartType, nextColor, uid, emptyChartConfig } from "@/lib/chartTypes"

interface Props {
  initial?: ChartConfig
  onSave: (config: ChartConfig) => void
  onClose: () => void
}

export default function ChartEditModal({ initial, onSave, onClose }: Props) {
  const [cfg, setCfg] = useState<ChartConfig>(initial || emptyChartConfig("line"))

  const upd = (patch: Partial<ChartConfig>) => setCfg(c => ({ ...c, ...patch }))

  // ── Серии ──
  const addSeries = () => setCfg(c => ({
    ...c,
    series: [...c.series, { id: uid(), name: `Серия ${c.series.length + 1}`, color: nextColor(c.series.length) }],
  }))
  const removeSeries = (id: string) => setCfg(c => ({
    ...c,
    series: c.series.filter(s => s.id !== id),
    points: c.points.map(p => { const v = { ...p.values }; delete v[id]; return { ...p, values: v } }),
  }))
  const updSeries = (id: string, patch: Partial<{ name: string; color: string; group: string }>) => setCfg(c => ({
    ...c,
    series: c.series.map(s => s.id === id ? { ...s, ...patch } : s),
  }))

  // ── Точки (строки) ──
  const addPoint = () => setCfg(c => ({ ...c, points: [...c.points, { x: String(c.points.length + 1), values: {} }] }))
  const removePoint = (i: number) => setCfg(c => ({ ...c, points: c.points.filter((_, idx) => idx !== i) }))
  const updPointX = (i: number, x: string) => setCfg(c => ({ ...c, points: c.points.map((p, idx) => idx === i ? { ...p, x } : p) }))
  const updPointVal = (i: number, sid: string, raw: string) => setCfg(c => ({
    ...c,
    points: c.points.map((p, idx) => {
      if (idx !== i) return p
      const v = { ...p.values }
      if (raw.trim() === "") delete v[sid]
      else v[sid] = parseFloat(raw.replace(",", "."))
      return { ...p, values: v }
    }),
  }))

  const switchType = (type: ChartType) => upd({ type, showValues: type === "bar" ? true : cfg.showValues })

  const valid = cfg.series.length > 0 && cfg.points.length > 0

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-background shadow-2xl"
        onClick={e => e.stopPropagation()}>

        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name="ChartLine" size={16} className="text-primary" />
            <h3 className="text-sm font-medium text-foreground">{initial ? "Редактировать график" : "Добавить график"}</h3>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/40 hover:bg-muted hover:text-foreground" style={{ cursor: "pointer" }}>
            <Icon name="X" size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Тип графика */}
          <div className="flex gap-2">
            {([["line", "Линейный", "ChartSpline"], ["bar", "Столбчатый", "ChartColumn"]] as [ChartType, string, string][]).map(([t, label, icon]) => (
              <button key={t} type="button" onClick={() => switchType(t)} style={{ cursor: "pointer" }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  cfg.type === t ? "border-primary bg-primary/15 text-primary" : "border-border text-foreground/60 hover:border-primary/40"
                }`}>
                <Icon name={icon} size={15} /> {label}
              </button>
            ))}
          </div>

          {/* Заголовок и оси */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Заголовок</label>
              <input value={cfg.title} onChange={e => upd({ title: e.target.value })}
                placeholder="Напр. Температуры под нагрузкой"
                className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Подпись оси X</label>
              <input value={cfg.xLabel} onChange={e => upd({ xLabel: e.target.value })}
                placeholder="Напр. Децибелы (dBA)"
                className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-foreground/50 mb-1 block">Подпись оси Y</label>
              <input value={cfg.yLabel} onChange={e => upd({ yLabel: e.target.value })}
                placeholder="Напр. Температура (°C)"
                className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:border-primary focus:outline-none" />
            </div>
          </div>

          {/* Чекбоксы */}
          <div className="flex flex-wrap gap-4 text-sm text-foreground/70">
            <label className="flex items-center gap-2" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={cfg.showValues} onChange={e => upd({ showValues: e.target.checked })} style={{ cursor: "pointer" }} />
              Показывать значения на графике
            </label>
            {cfg.type === "line" && (
              <label className="flex items-center gap-2" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={cfg.showDots} onChange={e => upd({ showDots: e.target.checked })} style={{ cursor: "pointer" }} />
                Точки на линиях
              </label>
            )}
          </div>

          {/* Серии */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Серии (линии / столбцы)</p>
              <button type="button" onClick={addSeries} style={{ cursor: "pointer" }}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground/60 hover:border-primary hover:text-foreground">
                <Icon name="Plus" size={12} /> Серия
              </button>
            </div>
            <div className="space-y-1.5">
              {cfg.series.map(s => (
                <div key={s.id} className="flex items-center gap-2">
                  <input type="color" value={s.color} onChange={e => updSeries(s.id, { color: e.target.value })}
                    className="h-8 w-9 shrink-0 rounded border border-border bg-card p-0.5" style={{ cursor: "pointer" }} />
                  <input value={s.name} onChange={e => updSeries(s.id, { name: e.target.value })}
                    placeholder="Название серии"
                    className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:border-primary focus:outline-none" />
                  <input value={s.group || ""} onChange={e => updSeries(s.id, { group: e.target.value })}
                    placeholder="Категория"
                    list="chart-groups"
                    title="Серии одной категории рисуются на отдельном графике со своей шкалой"
                    className="w-32 shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:border-primary focus:outline-none" />
                  <button type="button" onClick={() => removeSeries(s.id)} style={{ cursor: "pointer" }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground/40 hover:text-destructive">
                    <Icon name="Trash2" size={14} />
                  </button>
                </div>
              ))}
              <datalist id="chart-groups">
                {Array.from(new Set(cfg.series.map(s => (s.group || "").trim()).filter(Boolean))).map(g => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <p className="mt-1.5 text-[11px] text-foreground/40">
              «Категория» делит серии на отдельные графики со своей шкалой высоты (напр. «Время» и «Цена» не будут давить друг друга). Пусто — общий график.
            </p>
          </div>

          {/* Таблица точек */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Данные (точки по оси X)</p>
              <button type="button" onClick={addPoint} style={{ cursor: "pointer" }}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground/60 hover:border-primary hover:text-foreground">
                <Icon name="Plus" size={12} /> Точка
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-foreground/50 min-w-[90px]">X (ось)</th>
                    {cfg.series.map(s => (
                      <th key={s.id} className="px-2 py-1.5 text-left text-xs font-medium min-w-[80px]">
                        <span className="flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                          <span className="truncate text-foreground/70 max-w-[90px]">{s.name}</span>
                        </span>
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {cfg.points.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-1.5 py-1">
                        <input value={p.x} onChange={e => updPointX(i, e.target.value)}
                          className="w-full rounded border border-border bg-card px-2 py-1 text-xs focus:border-primary focus:outline-none" />
                      </td>
                      {cfg.series.map(s => (
                        <td key={s.id} className="px-1.5 py-1">
                          <input value={p.values[s.id] ?? ""} onChange={e => updPointVal(i, s.id, e.target.value)}
                            inputMode="decimal" placeholder="—"
                            className="w-full rounded border border-border bg-card px-2 py-1 text-xs tabular-nums focus:border-primary focus:outline-none" />
                        </td>
                      ))}
                      <td className="px-1 py-1 text-center">
                        <button type="button" onClick={() => removePoint(i)} style={{ cursor: "pointer" }}
                          className="text-foreground/40 hover:text-destructive">
                          <Icon name="X" size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-foreground/40">Пустая ячейка — нет данных в этой точке (линия не прервётся).</p>
          </div>

          {/* Превью */}
          {valid && (
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Предпросмотр</p>
              <ArticleChart config={cfg} compact />
            </div>
          )}
        </div>

        {/* Футер */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/60 hover:border-primary hover:text-foreground" style={{ cursor: "pointer" }}>
            Отмена
          </button>
          <button type="button" onClick={() => valid && onSave(cfg)} disabled={!valid}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40" style={{ cursor: "pointer" }}>
            <Icon name="Check" size={14} /> Сохранить график
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}