// Отчёт по папке прогонов стресс-тестов: печать/PDF (HTML в новом окне)
// и выгрузка CSV. Данные приходят из api.stress.folderReport.

export interface ReportMetric {
  key: string; label: string; unit: string
  min: number | null; max: number | null; avg: number | null; samples: number
}
export interface ReportRun {
  id: number; run_uid: string; profile_name: string; machine_name: string
  os_info: string; note: string; started_at: string | null; finished_at: string | null
  total_tests: number; passed_tests: number; failed_tests: number; status: string
  created_at: string; metrics: ReportMetric[]
}
export interface ReportFolder {
  id: number; name: string; order_id: number | null; order_ref: string
  note: string; created_at: string
}

function fmtDate(s: string | null): string {
  if (!s) return "—"
  return new Date(s).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

const esc = (v: string | number | null): string => {
  const s = v == null ? "" : String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// CSV: одна строка = одна метрика внутри прогона (плюс строки-шапки прогонов).
export function folderReportCSV(folder: ReportFolder, runs: ReportRun[]): string {
  const head = [
    "Папка", "Заказ", "Прогон_ID", "ПК", "Профиль", "ОС", "Дата",
    "Тестов", "Успешно", "Ошибок", "Метрика", "Ед", "Мин", "Сред", "Макс",
  ]
  const rows: string[] = [head.map(esc).join(";")]
  for (const r of runs) {
    const base = [
      folder.name, folder.order_ref || "", r.id, r.machine_name || "",
      r.profile_name || "", r.os_info || "", fmtDate(r.created_at),
      r.total_tests, r.passed_tests, r.failed_tests,
    ]
    if (!r.metrics.length) {
      rows.push([...base, "", "", "", "", ""].map(esc).join(";"))
    } else {
      for (const m of r.metrics) {
        rows.push([...base, m.label, m.unit, m.min ?? "", m.avg ?? "", m.max ?? ""].map(esc).join(";"))
      }
    }
  }
  return rows.join("\n")
}

export function downloadFolderCSV(folder: ReportFolder, runs: ReportRun[]): void {
  const csv = folderReportCSV(folder, runs)
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `stress_folder_${folder.id}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const h = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// HTML-отчёт для печати/сохранения в PDF (через окно печати браузера).
export function openFolderReportPrint(folder: ReportFolder, runs: ReportRun[]): boolean {
  const totalTests = runs.reduce((s, r) => s + r.total_tests, 0)
  const totalPassed = runs.reduce((s, r) => s + r.passed_tests, 0)
  const totalFailed = runs.reduce((s, r) => s + r.failed_tests, 0)

  const runBlocks = runs.map(r => {
    const metricRows = r.metrics.length
      ? r.metrics.map(m => `
        <tr>
          <td>${h(m.label)}</td>
          <td class="num">${m.min ?? "—"}</td>
          <td class="num">${m.avg ?? "—"}</td>
          <td class="num strong">${m.max ?? "—"}</td>
          <td class="unit">${h(m.unit || "")}</td>
        </tr>`).join("")
      : `<tr><td colspan="5" class="muted">Метрики не записаны</td></tr>`
    const badge = r.failed_tests > 0
      ? `<span class="badge bad">${r.passed_tests}/${r.total_tests}</span>`
      : `<span class="badge good">${r.passed_tests}/${r.total_tests}</span>`
    return `
      <div class="run">
        <div class="run-head">
          <div>
            <div class="run-title">${h(r.machine_name || `Прогон #${r.id}`)}</div>
            <div class="run-meta">
              ${r.profile_name ? h(r.profile_name) + " · " : ""}${h(r.os_info || "")}
              ${r.os_info ? " · " : ""}${fmtDate(r.created_at)}
            </div>
          </div>
          ${badge}
        </div>
        ${r.note ? `<div class="run-note">${h(r.note)}</div>` : ""}
        <table class="metrics">
          <thead><tr><th>Датчик</th><th>Мин</th><th>Сред</th><th>Макс</th><th>Ед</th></tr></thead>
          <tbody>${metricRows}</tbody>
        </table>
      </div>`
  }).join("")

  const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>Отчёт: ${h(folder.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 20px; }
  .summary { display: flex; gap: 16px; margin-bottom: 24px; }
  .card { flex: 1; border: 1px solid #ddd; border-radius: 10px; padding: 12px; text-align: center; }
  .card .n { font-size: 24px; font-weight: 700; }
  .card.good .n { color: #16a34a; } .card.bad .n { color: #dc2626; }
  .card .l { font-size: 11px; color: #888; }
  .run { border: 1px solid #e2e2e2; border-radius: 10px; padding: 14px; margin-bottom: 14px; page-break-inside: avoid; }
  .run-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .run-title { font-weight: 600; font-size: 15px; }
  .run-meta { color: #777; font-size: 12px; margin-top: 2px; }
  .run-note { margin-top: 8px; padding: 6px 8px; background: #f6f6f6; border-radius: 6px; font-size: 12px; color: #555; }
  .badge { border-radius: 20px; padding: 3px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .badge.good { background: #dcfce7; color: #16a34a; } .badge.bad { background: #fee2e2; color: #dc2626; }
  table.metrics { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
  table.metrics th { text-align: left; color: #999; font-weight: 500; border-bottom: 1px solid #eee; padding: 4px 6px; }
  table.metrics td { padding: 4px 6px; border-bottom: 1px solid #f2f2f2; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; } td.strong { font-weight: 700; }
  td.unit { color: #999; } td.muted { color: #bbb; text-align: center; }
  @media print { body { padding: 12px; } .noprint { display: none; } }
  .btn { margin-bottom: 20px; padding: 8px 16px; border: 1px solid #333; background: #111; color: #fff; border-radius: 8px; cursor: pointer; font-size: 13px; }
</style></head>
<body>
  <button class="btn noprint" onclick="window.print()">🖨 Печать / Сохранить в PDF</button>
  <h1>${h(folder.name)}</h1>
  <div class="sub">
    ${folder.order_ref ? "Заказ: <b>" + h(folder.order_ref) + "</b> · " : ""}
    Прогонов: ${runs.length} · Сформировано: ${fmtDate(new Date().toISOString())}
    ${folder.note ? "<br>" + h(folder.note) : ""}
  </div>
  <div class="summary">
    <div class="card"><div class="n">${totalTests}</div><div class="l">всего тестов</div></div>
    <div class="card good"><div class="n">${totalPassed}</div><div class="l">успешно</div></div>
    <div class="card bad"><div class="n">${totalFailed}</div><div class="l">с ошибкой</div></div>
  </div>
  ${runBlocks || '<p class="muted">В папке нет прогонов.</p>'}
</body></html>`

  const win = window.open("", "_blank")
  if (!win) return false
  win.document.write(html)
  win.document.close()
  return true
}
