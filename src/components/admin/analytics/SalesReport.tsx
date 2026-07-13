import { useState, useEffect, useCallback } from "react"
import Icon from "@/components/ui/icon"
import { api } from "@/lib/api"

type Item = {
  product_id: number
  name: string
  category: string
  units_sold: number
  lines: number
  orders_cnt: number
  distinct_days: number
  demand_type: string
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
type SpecGroup = {
  category: string
  attribute: string
  value: string
  products: number
  stock: number
  sold_total: number
  sold_regular: number
  daily_demand: number
  days_cover: number | null
  deficit: number
  warning: string | null
}
type Report = {
  period: { from: string; to: string }
  items: Item[]
  spec_groups: SpecGroup[]
  totals: { positions: number; units: number; revenue: number; margin: number; period_days: number; regular: number; one_off: number; spec_warnings: number }
}

const money = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("ru-RU") + " ₽")

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

// Промпт для внешней ИИ — только текст (CSV скачивается отдельно и
// прикладывается пользователем к запросу).
function buildPrompt(r: Report): string {
  return [
    "Ты — аналитик по закупкам магазина ПК-комплектующих. Я приложу CSV-отчёт продаж " +
      `за период ${r.period.from} — ${r.period.to} (${r.totals.period_days} дней).`,
    "",
    "Колонки CSV:",
    "- Товар, Категория",
    "- Продано_шт: сколько штук выдано за период (только завершённые заказы)",
    "- Заказов: в скольких разных заказах встречался товар (частота спроса)",
    "- Выручка_руб",
    "- Ср_цена_руб: средняя цена продажи",
    "- Себестоимость_руб: средняя закупочная цена за штуку",
    "- Маржа_руб, Маржа_проц: прибыль в рублях и процентах",
    "- Остаток_шт: сколько сейчас на складе",
    "- Спрос_шт_в_день: средний дневной спрос за период",
    "- Тип_спроса: 'регулярный' (продаётся стабильно), 'разовый' (1-2 продажи — " +
      "возможно случайность), 'нет данных'",
    "- Хватит_дней: на сколько дней хватит текущего остатка при таком спросе",
    "- Дефицит_шт: сколько не хватает под спрос на ближайшие 30 дней",
    "- Метки: авто-подсказки скрипта",
    "",
    "ВАЖНО: единичные/разовые продажи (Тип_спроса='разовый') НЕ считай реальным " +
      "спросом — не рекомендуй закупать их про запас, только отметь как возможный интерес.",
    "",
    "Во втором CSV-файле — контроль остатков по ХАРАКТЕРИСТИКАМ совместимости " +
      "(тип комплектующего). Колонки: Категория, Характеристика, Значение, " +
      "Товаров_в_группе, Остаток_шт, Продано_всего, Продано_регулярно, " +
      "Спрос_в_день, Хватит_дней, Дефицит_шт, Предупреждение. Это помогает " +
      "заметить нехватку целого ТИПА (напр. мало корпусов формата mATX или " +
      "плат под сокет AM5), даже если по отдельным моделям всё выглядит нормально.",
    "",
    "Задача — дай конкретные рекомендации:",
    "1) ЧТО ЗАКУПИТЬ в первую очередь: регулярный спрос + хорошая маржа + мало/нет на складе. Укажи товар и рекомендуемое кол-во.",
    "2) ЧТО ИСКЛЮЧИТЬ / не закупать: низкая или отрицательная маржа, слабые/разовые продажи.",
    "3) На что обратить внимание: регулярный спрос, который скоро закончится (риск потери продаж).",
    "4) ПРОБЕЛЫ ПО ТИПАМ: какие характеристики/типы (форм-фактор, сокет, тип памяти) в дефиците под спрос — их тоже пополнить.",
    "Ответь кратко, списком, с цифрами. Сначала топ-приоритеты.",
  ].join("\n")
}

function toCSV(items: Item[]): string {
  const head = [
    "Товар", "Категория", "Продано_шт", "Заказов", "Тип_спроса", "Выручка_руб", "Ср_цена_руб",
    "Себестоимость_руб", "Маржа_руб", "Маржа_проц", "Остаток_шт",
    "Спрос_шт_в_день", "Хватит_дней", "Дефицит_шт", "Метки",
  ]
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = items.map(i => [
    i.name, i.category, i.units_sold, i.orders_cnt, i.demand_type, Math.round(i.revenue),
    Math.round(i.avg_price), Math.round(i.avg_cost),
    i.margin_rub == null ? "" : Math.round(i.margin_rub),
    i.margin_pct == null ? "" : i.margin_pct,
    i.stock_now, i.daily_demand, i.days_cover == null ? "" : i.days_cover,
    i.deficit, i.labels.join(" / "),
  ].map(esc).join(";"))
  return [head.join(";"), ...rows].join("\n")
}

// CSV по группам характеристик (контроль остатков по типу комплектующего)
function specToCSV(groups: SpecGroup[]): string {
  const head = [
    "Категория", "Характеристика", "Значение", "Товаров_в_группе", "Остаток_шт",
    "Продано_всего", "Продано_регулярно", "Спрос_в_день", "Хватит_дней",
    "Дефицит_шт", "Предупреждение",
  ]
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = groups.map(g => [
    g.category, g.attribute, g.value, g.products, g.stock,
    g.sold_total, g.sold_regular, g.daily_demand,
    g.days_cover == null ? "" : g.days_cover, g.deficit, g.warning || "",
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
    // Копируем ТОЛЬКО промпт (без CSV) — CSV пользователь скачивает и прикладывает отдельно.
    try {
      await navigator.clipboard.writeText(buildPrompt(data))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert("Не удалось скопировать промпт.")
    }
  }

  const downloadFile = (name: string, content: string) => {
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadCSV = () => {
    if (!data) return
    // Отчёт по товарам
    downloadFile(`sales_${range.from}_${range.to}.csv`, toCSV(data.items))
    // Отдельный CSV по характеристикам (контроль остатков по типу)
    if (data.spec_groups?.length) {
      downloadFile(`sales_by_specs_${range.from}_${range.to}.csv`, specToCSV(data.spec_groups))
    }
  }

  // Предупреждаем только по РЕГУЛЯРНОМУ спросу — разовые продажи не считаем.
  const lowStock = (data?.items || []).filter(
    i => i.demand_type === "регулярный" && (i.stock_now === 0 || (i.days_cover != null && i.days_cover <= 14))
  )
  // Группы характеристик: с предупреждением и топ по продажам
  const specWarn = (data?.spec_groups || []).filter(g => g.warning)
  const specTop = (data?.spec_groups || []).filter(g => g.sold_total > 0).slice(0, 12)

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
                  1) Скопируйте промпт и вставьте в любую ИИ. 2) Скачайте CSV (2 файла:
                  по товарам и по характеристикам) и приложите к тому же запросу — ИИ
                  подскажет, что закупить, а что исключить.
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

          {/* Контроль по характеристикам (тип комплектующего) */}
          {(data.spec_groups?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Icon name="Boxes" size={16} className="text-primary" />
                Контроль по характеристикам совместимости
              </p>
              <p className="mb-3 text-xs text-foreground/50">
                Остатки и спрос по ТИПУ комплектующего (форм-фактор, сокет, тип памяти…) —
                чтобы заметить нехватку целого типа, даже если по моделям всё в норме.
              </p>

              {/* Предупреждения по типам */}
              {specWarn.length > 0 && (
                <div className="mb-3 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                    <Icon name="TriangleAlert" size={13} /> Нехватка по типам ({specWarn.length})
                  </p>
                  {specWarn.map((g, k) => (
                    <div key={k} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-foreground/80">{g.category} · {g.attribute}: <b>{g.value}</b></span>
                      <span className="text-foreground/50">
                        остаток <b className="text-foreground/70">{g.stock}</b> ·
                        рег. спрос {g.daily_demand}/день ·
                        {g.days_cover != null ? <> хватит <b className="text-amber-600">{g.days_cover}</b> дн.</> : " —"}
                        {g.deficit > 0 && <> · дозаказать <b className="text-amber-600">{g.deficit}</b></>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Таблица по группам характеристик */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs text-foreground/50">
                      <th className="px-3 py-2 text-left">Тип / характеристика</th>
                      <th className="px-3 py-2 text-center">Остаток</th>
                      <th className="px-3 py-2 text-center">Продано (всего / рег.)</th>
                      <th className="px-3 py-2 text-center">Хватит</th>
                      <th className="px-3 py-2 text-left">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specTop.map((g, k) => (
                      <tr key={k} className={`border-b border-border/50 ${k % 2 ? "bg-muted/10" : ""}`}>
                        <td className="px-3 py-2">
                          <span className="font-medium">{g.value}</span>
                          <span className="ml-1 text-xs text-foreground/40">{g.category} · {g.attribute}</span>
                        </td>
                        <td className={`px-3 py-2 text-center ${g.stock === 0 ? "text-red-500 font-semibold" : ""}`}>{g.stock}</td>
                        <td className="px-3 py-2 text-center">
                          {g.sold_total}
                          <span className="text-xs text-foreground/40"> / {g.sold_regular}</span>
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-foreground/60">
                          {g.days_cover == null ? "—" : `${g.days_cover} дн`}
                        </td>
                        <td className="px-3 py-2">
                          {g.warning
                            ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${g.warning === "нет в наличии" ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-500"}`}>{g.warning}</span>
                            : <span className="text-[10px] text-emerald-500">норма</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-foreground/40">
                «Продано (всего / рег.)» — все продажи типа и только регулярные. Спрос и
                статус считаются по регулярным. Полный список — в отдельном CSV «by_specs».
              </p>
            </div>
          )}

          {/* Таблица продаж */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-foreground/50">
                  <th className="px-3 py-2.5 text-left">Товар</th>
                  <th className="px-3 py-2.5 text-center">Продано</th>
                  <th className="px-3 py-2.5 text-center">Спрос</th>
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
                    <td className="px-3 py-2.5 text-center font-semibold">
                      {i.units_sold}
                      <span className="block text-[10px] font-normal text-foreground/40">{i.orders_cnt} зак.</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${i.demand_type === "регулярный" ? "bg-emerald-500/15 text-emerald-500" : i.demand_type === "разовый" ? "bg-foreground/10 text-foreground/50" : "bg-muted text-foreground/40"}`}>
                        {i.demand_type}
                      </span>
                    </td>
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
            <b>Тип спроса</b>: «регулярный» — покупали в разных заказах/дни (реальный спрос);
            «разовый» — 1 заказ (возможно случайность, не считается спросом).
            Метки: <b>хит</b> — регулярный спрос ≥3 шт; <b>хорошая маржа</b> — ≥25%;
            <b> низкая маржа</b> — &lt;10%; <b>скоро закончится</b> / <b>дозаказать</b> —
            только по регулярному спросу (хватит ≤14 дней / не хватит на 30 дней).
          </p>
        </>
      )}
    </div>
  )
}