import { useState, useEffect, useCallback } from "react"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"

type Item = {
  product_id: number
  name: string
  category: string
  units_sold: number
  lines: number
  revenue: number
  avg_price: number
  avg_cost: number
  margin_rub: number | null
  margin_pct: number | null
  stock_now: number
  daily_demand: number
  days_cover: number | null
  deficit: number
  labels: string[]
}
type Report = {
  period: { from: string; to: string }
  items: Item[]
  totals: { positions: number; units: number; revenue: number; margin: number; period_days: number }
}

const money = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("ru-RU") + " ₽")
const num = (n: number | null) => (n == null ? "—" : String(n))

// Первый день текущего месяца и завтра — период по умолчанию
function defaultRange(): { from: string; to: string } {
  const now = new Date()
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10)
  return { from, to }
}

const LABEL_STYLE: Record<string, string> = {
  "хит": "bg-emerald-500/15 text-emerald-500",
  "хорошая маржа": "bg-emerald-500/15 text-emerald-500",
  "дозаказать": "bg-amber-500/15 text-amber-500",
  "скоро закончится": "bg-amber-500/15 text-amber-500",
  "нет в наличии": "bg-red-500/15 text-red-500",
  "низкая маржа": "bg-red-500/15 text-red-500",
}

// Промпт для внешней ИИ — объясняет структуру CSV и что нужно вернуть
function buildPrompt(r: Report): string {
  return [
    "Ты — аналитик по закупкам магазина ПК-комплектующих. Ниже CSV-отчёт продаж за период " +
      `${r.period.from} — ${r.period.to} (${r.totals.period_days} дней).`,
    "",
    "Колонки CSV:",
    "- Товар, Категория",
    "- Продано_шт: сколько штук выдано за период (только завершённые заказы)",
    "- Выручка_руб",
    "- Ср_цена_руб: средняя цена продажи",
    "- Себестоимость_руб: средняя закупочная цена за штуку",
    "- Маржа_руб, Маржа_проц: прибыль в рублях и процентах",
    "- Остаток_шт: сколько сейчас на складе",
    "- Спрос_шт_в_день: средний дневной спрос за период",
    "- Хватит_дней: на сколько дней хватит текущего остатка при таком спросе",
    "- Дефицит_шт: сколько не хватает под спрос на ближайшие 30 дней",
    "- Метки: авто-подсказки скрипта",
    "",
    "Задача — дай конкретные рекомендации:",
    "1) ЧТО ЗАКУПИТЬ в первую очередь (хорошо продаётся + хорошая маржа + мало/нет на складе). Укажи товар и рекомендуемое кол-во.",
    "2) ЧТО ИСКЛЮЧИТЬ / не закупать (низкая или отрицательная маржа, слабые продажи).",
    "3) На что обратить внимание (скоро закончится — риск потери продаж).",
    "Ответь кратко, списком, с цифрами. Сначала топ-приоритеты.",
    "",
    "=== CSV НИЖЕ ===",
  ].join("\n")
}

function toCSV(items: Item[]): string {
  const head = [
    "Товар", "Категория", "Продано_шт", "Заказов", "Выручка_руб", "Ср_цена_руб",
    "Себестоимость_руб", "Маржа_руб", "Маржа_проц", "Остаток_шт",
    "Спрос_шт_в_день", "Хватит_дней", "Дефицит_шт", "Метки",
  ]
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = items.map(i => [
    i.name, i.category, i.units_sold, i.lines, Math.round(i.revenue),
    Math.round(i.avg_price), Math.round(i.avg_cost),
    i.margin_rub == null ? "" : Math.round(i.margin_rub),
    i.margin_pct == null ? "" : i.margin_pct,
    i.stock_now, i.daily_demand, i.days_cover == null ? "" : i.days_cover,
    i.deficit, i.labels.join(" / "),
  ].map(esc).join(";"))
  return [head.join(";"), ...rows].join("\n")
}

export default function SalesReport() {
  const [range, setRange] = useState(defaultRange())
  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const d = await api.marketing.salesReport(range.from, range.to).catch(() => null)
    setData(d && !d.error ? d : null)
    setLoading(false)
  }, [range])

  useEffect(() => { load() }, [load])

  const copyPrompt = async () => {
    if (!data) return
    const text = buildPrompt(data) + "\n" + toCSV(data.items)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert("Не удалось скопировать. Скачайте CSV кнопкой ниже.")
    }
  }

  const downloadCSV = () => {
    if (!data) return
    const blob = new Blob(["\uFEFF" + toCSV(data.items)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `sales_${range.from}_${range.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const lowStock = (data?.items || []).filter(
    i => i.units_sold > 0 && (i.stock_now === 0 || (i.days_cover != null && i.days_cover <= 14))
  )

  return (
    <div className="space-y-5">
      {/* Период */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-foreground/50">С</label>
          <input type="date" value={range.from}
            onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
            className="rounded border border-border bg-background px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-foreground/50">По</label>
          <input type="date" value={range.to}
            onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
            className="rounded border border-border bg-background px-2 py-1.5 text-sm" />
        </div>
        <p className="text-xs text-foreground/40 pb-2">Учитываются только выданные заказы (продажи)</p>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-card animate-pulse" />)}</div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-foreground/50">
          За выбранный период продаж нет
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { l: "Позиций", v: String(data.totals.positions) },
              { l: "Продано, шт", v: String(data.totals.units) },
              { l: "Выручка", v: money(data.totals.revenue) },
              { l: "Маржа", v: money(data.totals.margin) },
            ].map(k => (
              <div key={k.l} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="text-xs text-foreground/50">{k.l}</p>
                <p className="mt-0.5 text-lg font-bold">{k.v}</p>
              </div>
            ))}
          </div>

          {/* Выгрузка для ИИ */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <Icon name="Sparkles" size={18} className="mt-0.5 shrink-0 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-semibold">Отчёт для ИИ</p>
                <p className="mt-0.5 text-xs text-foreground/60">
                  Скопируйте готовый промпт с данными и вставьте в любую ИИ — она подскажет,
                  что закупить, а что исключить.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={copyPrompt}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    style={{ cursor: "pointer" }}>
                    <Icon name={copied ? "Check" : "Copy"} size={15} />
                    {copied ? "Скопировано!" : "Скопировать промпт для ИИ"}
                  </button>
                  <button onClick={downloadCSV}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                    style={{ cursor: "pointer" }}>
                    <Icon name="Download" size={15} />
                    Скачать отчёт CSV
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Предупреждения о низком остатке */}
          {lowStock.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-600">
                <Icon name="TriangleAlert" size={16} />
                Скоро закончатся ({lowStock.length}) — продаются, но мало на складе
              </p>
              <div className="space-y-1">
                {lowStock.map(i => (
                  <div key={i.product_id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-foreground/80">{i.name}</span>
                    <span className="text-foreground/50">
                      остаток <b className="text-foreground/70">{i.stock_now}</b> шт ·
                      спрос {i.daily_demand}/день ·
                      {i.days_cover != null ? <> хватит на <b className="text-amber-600">{i.days_cover}</b> дн.</> : " —"}
                      {i.deficit > 0 && <> · дозаказать <b className="text-amber-600">{i.deficit}</b> шт</>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Таблица продаж */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-foreground/50">
                  <th className="px-3 py-2.5 text-left">Товар</th>
                  <th className="px-3 py-2.5 text-center">Продано</th>
                  <th className="px-3 py-2.5 text-right">Выручка</th>
                  <th className="px-3 py-2.5 text-right">Маржа</th>
                  <th className="px-3 py-2.5 text-center">Остаток</th>
                  <th className="px-3 py-2.5 text-center">Хватит</th>
                  <th className="px-3 py-2.5 text-left">Метки</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i, idx) => (
                  <tr key={i.product_id} className={`border-b border-border/50 ${idx % 2 ? "bg-muted/10" : ""}`}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{i.name}</p>
                      <p className="text-xs text-foreground/40">{i.category}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold">{i.units_sold}</td>
                    <td className="px-3 py-2.5 text-right">{money(i.revenue)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={i.margin_pct == null ? "text-foreground/40" : i.margin_pct < 10 ? "text-red-500" : i.margin_pct >= 25 ? "text-emerald-500" : ""}>
                        {money(i.margin_rub)}
                      </span>
                      {i.margin_pct != null && <span className="ml-1 text-xs text-foreground/40">{i.margin_pct}%</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-center ${i.stock_now === 0 ? "text-red-500 font-semibold" : ""}`}>{i.stock_now}</td>
                    <td className="px-3 py-2.5 text-center text-xs text-foreground/60">
                      {i.days_cover == null ? "—" : `${i.days_cover} дн`}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {i.labels.map(l => (
                          <span key={l} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${LABEL_STYLE[l] || "bg-muted text-foreground/60"}`}>{l}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-foreground/40">
            Метки считаются автоматически: <b>хит</b> — продано ≥3 шт; <b>хорошая маржа</b> — ≥25% и ≥2 продаж;
            <b> низкая маржа</b> — &lt;10%; <b>скоро закончится</b> — хватит ≤14 дней; <b>дозаказать</b> — не хватит под спрос на 30 дней.
          </p>
        </>
      )}
    </div>
  )
}
