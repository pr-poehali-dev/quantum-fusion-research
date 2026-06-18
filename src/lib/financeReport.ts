// Генерация PDF-отчёта по движению средств через печать браузера.
// Открывает окно с готовой HTML-таблицей и вызывает печать (Сохранить как PDF).
// Без внешних зависимостей, кириллица работает нативно.

export interface ReportItem {
  kind: "income" | "expense" | "collection"
  amount: number
  note: string
  occurred_at: string
  type_name: string | null
  user: string | null
}

const KIND_LABEL: Record<string, string> = {
  income: "Приход",
  expense: "Расход",
  collection: "Инкассация",
}

const fmtMoney = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽"

const fmtDate = (s: string) => {
  if (!s) return ""
  const d = new Date(s)
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

const fmtDay = (s: string) => {
  if (!s) return ""
  const d = new Date(s + "T00:00:00")
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
}

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function generateFinanceReport(items: ReportItem[], dateFrom: string, dateTo: string) {
  const income = items.filter(i => i.kind === "income").reduce((s, i) => s + i.amount, 0)
  const expense = items.filter(i => i.kind === "expense").reduce((s, i) => s + i.amount, 0)
  const collection = items.filter(i => i.kind === "collection").reduce((s, i) => s + i.amount, 0)
  const net = income - expense

  const sorted = [...items].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))

  const rows = sorted.map(it => {
    const sign = it.kind === "income" ? "+" : it.kind === "expense" ? "−" : "→"
    const color = it.kind === "income" ? "#16a34a" : it.kind === "expense" ? "#dc2626" : "#2563eb"
    return `<tr>
      <td>${esc(fmtDate(it.occurred_at))}</td>
      <td>${esc(it.type_name || KIND_LABEL[it.kind])}</td>
      <td class="note">${esc(it.note || "")}</td>
      <td>${esc(it.user || "")}</td>
      <td class="amount" style="color:${color}">${sign} ${esc(fmtMoney(it.amount))}</td>
    </tr>`
  }).join("")

  const periodTxt = `${fmtDay(dateFrom)} — ${fmtDay(dateTo)}`
  const now = new Date().toLocaleString("ru-RU")

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Отчёт по движению средств ${esc(periodTxt)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 32px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 20px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
  .card { border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px 16px; min-width: 150px; }
  .card .lbl { font-size: 11px; color: #777; margin-bottom: 4px; }
  .card .val { font-size: 18px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; color: #888; border-bottom: 2px solid #ddd; }
  td.amount { text-align: right; white-space: nowrap; font-weight: 600; }
  td.note { color: #444; max-width: 320px; word-break: break-word; }
  tfoot td { font-weight: 700; border-top: 2px solid #ddd; }
  .footer { margin-top: 24px; color: #999; font-size: 11px; }
  @media print { body { margin: 12mm; } .card { break-inside: avoid; } tr { break-inside: avoid; } }
</style></head>
<body>
  <h1>Отчёт по движению средств</h1>
  <div class="sub">Период: ${esc(periodTxt)} · сформирован ${esc(now)} · операций: ${items.length}</div>

  <div class="summary">
    <div class="card"><div class="lbl">Приходы</div><div class="val" style="color:#16a34a">${esc(fmtMoney(income))}</div></div>
    <div class="card"><div class="lbl">Расходы</div><div class="val" style="color:#dc2626">${esc(fmtMoney(expense))}</div></div>
    <div class="card"><div class="lbl">Инкассация</div><div class="val" style="color:#2563eb">${esc(fmtMoney(collection))}</div></div>
    <div class="card"><div class="lbl">Итог (приход − расход)</div><div class="val" style="color:${net >= 0 ? "#16a34a" : "#dc2626"}">${esc(fmtMoney(net))}</div></div>
  </div>

  <table>
    <thead><tr><th>Дата</th><th>Тип</th><th>Комментарий</th><th>Сотрудник</th><th style="text-align:right">Сумма</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" style="text-align:center;color:#999;padding:24px">Нет операций за период</td></tr>`}</tbody>
    <tfoot>
      <tr><td colspan="4">Приходы</td><td class="amount" style="color:#16a34a">${esc(fmtMoney(income))}</td></tr>
      <tr><td colspan="4">Расходы</td><td class="amount" style="color:#dc2626">${esc(fmtMoney(expense))}</td></tr>
      <tr><td colspan="4">Итог</td><td class="amount">${esc(fmtMoney(net))}</td></tr>
    </tfoot>
  </table>

  <div class="footer">Документ сформирован автоматически из раздела «Финансы».</div>
  <script>window.onload = function(){ setTimeout(function(){ window.print() }, 300) }</script>
</body></html>`

  const w = window.open("", "_blank")
  if (!w) {
    alert("Разрешите всплывающие окна, чтобы сформировать отчёт")
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}
