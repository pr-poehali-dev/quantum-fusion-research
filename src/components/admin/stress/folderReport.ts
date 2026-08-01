// Отчёт по прогонам стресс-тестов: печать/PDF (HTML в новом окне) и CSV.
// Единый движок renderRunPage(run, mode) под фирменный формат: один прогон =
// одна страница. Отчёт по одному прогону и по папке (много страниц) используют
// один и тот же рендер. Данные — из api.stress.folderReport / api.stress.get.

import QRCode from "qrcode"
import { testTitle, statsLine } from "./scoreFormat"

// QR-код ссылки партнёра как data-URL (для вставки картинкой в окно отчёта).
async function qrDataUrl(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: "M" })
  } catch {
    return ""
  }
}

export interface ReportMetric {
  key: string; label: string; unit: string
  min: number | null; max: number | null; avg: number | null; samples: number
}
export interface ReportFile { file_name: string; file_url: string; file_size: number }
export interface ReportResult {
  id: number; test_name: string; command: string; exit_code: number | null
  duration_sec: number; timed_out: boolean; success: boolean; files: ReportFile[]
  score_text?: string; ocr_stress_failed?: boolean
}
export interface ReportRun {
  id: number; run_uid: string; profile_name: string; machine_name: string
  os_info: string; note: string; started_at: string | null; finished_at: string | null
  total_tests: number; passed_tests: number; failed_tests: number; status: string
  created_at: string; metrics: ReportMetric[]; results?: ReportResult[]
  partner_logo_url?: string       // логотип партнёра в углу отчёта
  partner_link?: string           // первая ссылка партнёра (для QR-кода)
  partner_links?: string[]        // весь перечень строк/ссылок (список под лого)
}
export interface ReportFolder {
  id: number; name: string; order_id: number | null; order_ref: string
  note: string; created_at: string
}

export type ReportMode = "compact" | "detailed" | "super"

function fmtDate(s: string | null): string {
  if (!s) return "—"
  return new Date(s).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}


const esc = (v: string | number | null): string => {
  const s = v == null ? "" : String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const h = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// Картинка ли файл (для секции «Скриншоты»)
const isImage = (name: string, url: string): boolean =>
  /\.(jpe?g|png|webp|gif|bmp)$/i.test(name) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(url)

// ─── CSV ────────────────────────────────────────────────────────────────────
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

// ─── Общие стили отчёта (фирменный формат) ──────────────────────────────────
const REPORT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 40px 44px; }
  h1 { font-size: 30px; font-weight: 700; margin: 0 0 8px; letter-spacing: -0.01em; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
  .head-l { min-width: 0; }
  .head .mode { margin-bottom: 0; }
  /* Брендинг партнёра: QR слева, лого справа, ссылка снизу */
  .brand { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .brand-row { display: flex; align-items: center; gap: 12px; }
  .qr { width: 92px; height: 92px; border: 1px solid #e4e4e4; border-radius: 8px; padding: 4px; background: #fff; }
  .logo { flex-shrink: 0; max-height: 92px; max-width: 200px; object-fit: contain; }
  .brand-links { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .brand-link { display: block; font-size: 12px; color: #555; word-break: break-all; text-align: right; max-width: 300px; text-decoration: none; }
  a.brand-link:hover { color: #1a1a1a; text-decoration: underline; }
  .meta { color: #555; font-size: 14px; margin-bottom: 2px; }
  .mode { color: #9a9a9a; font-size: 13px; margin-bottom: 22px; }
  .stats { display: flex; gap: 0; border: 1px solid #d7d7d7; border-radius: 8px; overflow: hidden; margin-bottom: 26px; }
  .stat { flex: 1; padding: 16px 20px; border-right: 1px solid #e4e4e4; }
  .stat:last-child { border-right: none; }
  .stat.ok { box-shadow: inset 0 0 0 2px #22c55e; }
  .stat.err { box-shadow: inset 0 0 0 2px #ef4444; }
  .stat .n { font-size: 30px; font-weight: 700; line-height: 1; }
  .stat.ok .n { color: #16a34a; } .stat.err .n { color: #dc2626; }
  .stat .l { font-size: 13px; color: #666; margin-top: 6px; }
  .section { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #8a8a8a; font-weight: 600; margin: 28px 0 12px; }
  .test { border: 1px solid #dcdcdc; border-radius: 8px; padding: 14px 18px; margin-bottom: 10px; page-break-inside: avoid; }
  .test.bad { border-color: #f0a0a0; background: #fdf3f3; }
  .test-name { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
  .test-meta { font-size: 13px; color: #666; }
  .test-cmd { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; color: #888; margin-top: 6px; word-break: break-all; }
  .to { background: #ffedd5; color: #ea580c; border-radius: 4px; padding: 1px 6px; font-size: 11px; margin-left: 6px; }
  /* Датчики — карточки (compact) */
  .sensors { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .sensor { border: 1px solid #dcdcdc; border-radius: 8px; padding: 14px 16px; page-break-inside: avoid; }
  .s-label { font-size: 13px; color: #666; margin-bottom: 8px; min-height: 34px; }
  .s-max { display: flex; align-items: baseline; gap: 5px; }
  .s-num { font-size: 26px; font-weight: 700; line-height: 1; }
  .s-unit { font-size: 13px; color: #888; }
  .s-tag { margin-left: 4px; background: #ef4444; color: #fff; border-radius: 4px; padding: 2px 6px; font-size: 11px; align-self: center; }
  .s-mm { font-size: 12px; color: #777; margin-top: 8px; }
  /* Датчики — таблица (detailed) */
  table.sensors-t { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.sensors-t th { text-align: left; color: #8a8a8a; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #e4e4e4; }
  table.sensors-t td { padding: 6px 8px; }
  table.sensors-t td.n { font-variant-numeric: tabular-nums; }
  table.sensors-t td.mx { font-weight: 700; }
  table.sensors-t td.u { color: #999; text-align: right; }
  /* Скриншоты */
  .shots { display: grid; gap: 14px; }
  .shot { border: 1px solid #dcdcdc; border-radius: 8px; padding: 14px 16px 16px; page-break-inside: avoid; }
  .shot-title { font-size: 15px; font-weight: 600; margin-bottom: 10px; }
  .shot img { max-width: 100%; border-radius: 6px; display: block; }
  .footer { margin-top: 34px; padding-top: 14px; border-top: 1px solid #eee; text-align: center; color: #b0b0b0; font-size: 12px; }
  .muted { color: #bbb; font-size: 13px; }
  /* Верхний колонтитул суперкомпактного отчёта */
  .rep-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #888; margin-bottom: 18px; }
  .rep-head .rep-head-c { font-weight: 600; color: #555; }
  /* Суперкомпактный режим — плотнее вёрстка */
  body.super .test { padding: 10px 16px; margin-bottom: 7px; }
  body.super .test-name { font-size: 15px; margin-bottom: 2px; }
  body.super .test-meta { font-size: 12px; }
  body.super .stats { margin-bottom: 18px; }
  body.super h1 { font-size: 26px; }
  @media print { body { padding: 20px; } .noprint { display: none; } }
  .btn { margin-bottom: 22px; padding: 9px 18px; border: 1px solid #111; background: #111; color: #fff; border-radius: 8px; cursor: pointer; font-size: 14px; }
`

// Рендер одной страницы = одного прогона в фирменном формате.
async function renderRunPage(r: ReportRun, mode: ReportMode, pageBreak: boolean): Promise<string> {
  const okAll = r.failed_tests === 0
  const isSuper = mode === "super"
  // Заголовок = профиль (имя прогона), мета = ПК · старт → финиш · ОС/ядра
  const title = r.profile_name || r.machine_name || `Прогон #${r.id}`
  const metaParts: string[] = [
    r.machine_name || "",
    `${fmtDate(r.started_at)} → ${fmtDate(r.finished_at)}`,
    r.os_info || "",
  ].filter(s => s.length > 0)

  // В суперкомпактном режиме сортируем тесты по названию
  const resultList = isSuper
    ? [...(r.results || [])].sort((a, b) => (a.test_name || "").localeCompare(b.test_name || "", "ru"))
    : (r.results || [])

  // СТРЕСС-ТЕСТЫ (заголовок с баллом + статистика — 1:1 с EXE)
  const tests = resultList.map(t => {
    const stats = statsLine(t.exit_code, t.timed_out, t.duration_sec)
    return `
    <div class="test ${t.success ? "" : "bad"}">
      <div class="test-name">${t.success ? "✓" : "✕"} ${h(testTitle(t.test_name || "Без названия", t.score_text))}${t.timed_out ? '<span class="to">таймаут</span>' : ""}</div>
      ${stats ? `<div class="test-meta">${h(stats)}</div>` : ""}
      ${mode === "detailed" && t.command ? `<div class="test-cmd">${h(t.command)}</div>` : ""}
    </div>`
  }).join("")

  // ДАТЧИКИ
  let sensors: string
  if (!r.metrics.length) {
    sensors = `<div class="muted">Датчики не записаны</div>`
  } else if (mode === "compact") {
    sensors = `<div class="sensors">${r.metrics.map(m => `
      <div class="sensor">
        <div class="s-label">${h(m.label)}</div>
        <div class="s-max"><span class="s-num">${m.max ?? "—"}</span><span class="s-unit">${h(m.unit || "")}</span><span class="s-tag">max</span></div>
        <div class="s-mm">мин ${m.min ?? "—"} · сред ${m.avg ?? "—"}</div>
      </div>`).join("")}</div>`
  } else {
    sensors = `<table class="sensors-t">
      <thead><tr><th>Датчик</th><th>мин</th><th>сред</th><th>макс</th><th></th></tr></thead>
      <tbody>${r.metrics.map(m => `
        <tr>
          <td>${h(m.label)}</td>
          <td class="n">${m.min ?? "—"}</td>
          <td class="n">${m.avg ?? "—"}</td>
          <td class="n mx">${m.max ?? "—"}</td>
          <td class="u">${h(m.unit || "")}</td>
        </tr>`).join("")}</tbody>
    </table>`
  }

  // СКРИНШОТЫ — только изображения
  const shots = (r.results || []).flatMap(t =>
    (t.files || []).filter(f => isImage(f.file_name, f.file_url)).map(f => ({ test: t.test_name, f }))
  )
  const shotsBlock = shots.length ? `
    <div class="section">Скриншоты</div>
    <div class="shots">${shots.map(s => `
      <div class="shot">
        <div class="shot-title">${h(s.test || s.f.file_name)}</div>
        <img src="${h(s.f.file_url)}" alt="${h(s.f.file_name)}" loading="eager" />
      </div>`).join("")}</div>` : ""

  // Брендинг партнёра: QR (слева, по первой ссылке) + лого (справа) +
  // полный перечень строк/ссылок снизу списком.
  const logo = (r.partner_logo_url || "").trim()
  const links = (r.partner_links && r.partner_links.length
    ? r.partner_links
    : (r.partner_link ? [r.partner_link] : [])
  ).map(s => s.trim()).filter(Boolean)
  const firstLink = links[0] || ""
  const logoImg = logo ? `<img class="logo" src="${h(logo)}" alt="logo" />` : ""
  const qrSrc = firstLink ? await qrDataUrl(firstLink) : ""
  const qrImg = qrSrc ? `<img class="qr" src="${qrSrc}" alt="QR" />` : ""
  // Строка-ссылка (http) → кликабельно; любой другой текст → просто текст
  const linkRow = (s: string) => {
    const isUrl = /^(https?:\/\/|t\.me\/|vk\.com\/|@)/i.test(s) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)
    if (isUrl) {
      const href = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^@/, "t.me/")}`
      return `<a class="brand-link" href="${h(href)}" target="_blank" rel="noreferrer">${h(s)}</a>`
    }
    return `<span class="brand-link">${h(s)}</span>`
  }
  const linksEl = links.length ? `<div class="brand-links">${links.map(linkRow).join("")}</div>` : ""
  const brand = (logoImg || qrImg || linksEl)
    ? `<div class="brand"><div class="brand-row">${qrImg}${logoImg}</div>${linksEl}</div>`
    : ""

  return `
    <section class="page" ${pageBreak ? 'style="page-break-after: always;"' : ""}>
      <div class="head">
        <div class="head-l">
          <h1>${h(title)}</h1>
          <div class="meta">${metaParts.map(h).join(" · ")}</div>
          <div class="mode">${isSuper ? "Суперкомпактный отчёт" : mode === "compact" ? "Компактный отчёт" : "Подробный отчёт"}</div>
          ${r.note ? `<div class="meta">${h(r.note)}</div>` : ""}
        </div>
        ${brand}
      </div>
      <div class="stats">
        <div class="stat"><div class="n">${r.total_tests}</div><div class="l">всего</div></div>
        <div class="stat ok"><div class="n">${r.passed_tests}</div><div class="l">успешно</div></div>
        <div class="stat err"><div class="n">${r.failed_tests}</div><div class="l">ошибок</div></div>
      </div>
      ${tests ? `<div class="section">Стресс-тесты</div>${tests}` : ""}
      ${isSuper ? "" : `<div class="section">Датчики (min / сред / max)</div>${sensors}${shotsBlock}`}
      <div class="footer">StressTester · ${fmtDate(new Date().toISOString())}${okAll ? "" : " · есть ошибки"}</div>
    </section>`
}

// Открыть окно с отчётом (набор прогонов) в выбранном режиме.
// Async: страницы содержат QR-код ссылки партнёра (генерится асинхронно).
async function openReport(titleTag: string, runs: ReportRun[], mode: ReportMode): Promise<boolean> {
  // Окно открываем сразу (синхронно после клика), чтобы не блокировал попап-блокер.
  const win = window.open("", "_blank")
  if (!win) return false
  win.document.write('<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Отчёт…</title></head><body style="font-family:sans-serif;padding:40px;color:#888">Формируем отчёт…</body></html>')
  win.document.close()

  const pages = runs.length
    ? (await Promise.all(runs.map((r, i) => renderRunPage(r, mode, i < runs.length - 1)))).join("")
    : '<p class="muted">Нет данных для отчёта.</p>'
  // Верхний колонтитул (как в EXE): дата слева, «Отчёт: N компов» по центру
  const repHead = mode === "super" ? `
    <div class="rep-head">
      <span>${h(fmtDate(new Date().toISOString()))}</span>
      <span class="rep-head-c">Отчёт: ${runs.length} ${plural(runs.length, "комп", "компа", "компов")}</span>
      <span></span>
    </div>` : ""
  const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>${h(titleTag)}</title>
<style>${REPORT_CSS}</style></head>
<body class="${mode === "super" ? "super" : ""}">
  <button class="btn noprint" onclick="window.print()">Печать / Сохранить в PDF</button>
  ${repHead}
  ${pages}
</body></html>`
  win.document.open()
  win.document.write(html)
  win.document.close()
  return true
}

// Русское склонение существительного по числу
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

// ─── Публичные функции ──────────────────────────────────────────────────────

// Отчёт по папке: компактный (карточки датчиков)
export function openFolderReportCompact(folder: ReportFolder, runs: ReportRun[]): Promise<boolean> {
  return openReport(`Отчёт: ${folder.name}`, runs, "compact")
}
// Отчёт по папке: подробный (таблица датчиков + пути)
export function openFolderReportPrint(folder: ReportFolder, runs: ReportRun[]): Promise<boolean> {
  return openReport(`Отчёт: ${folder.name}`, runs, "detailed")
}
// Отчёт по папке: суперкомпактный (только тесты с баллами, без датчиков/скринов)
export function openFolderReportSuper(folder: ReportFolder, runs: ReportRun[]): Promise<boolean> {
  return openReport(`Отчёт: ${folder.name}`, runs, "super")
}
// Отчёт по одному прогону
export function openRunReport(run: ReportRun, mode: ReportMode = "compact"): Promise<boolean> {
  return openReport(run.profile_name || `Прогон #${run.id}`, [run], mode)
}