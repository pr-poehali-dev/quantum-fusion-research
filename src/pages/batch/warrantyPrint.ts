// Печать единого гарантийного талона на всю партию ПК.
// Формирует самодостаточный HTML-документ и открывает его в новом окне на печать.

export interface BatchWarrantyComp { slot: string; slot_label: string; name: string; serial: string }
export interface BatchWarrantyPC {
  group_label: string; unit_no: number; pc_serial: string
  warranty_until: string | null; components: BatchWarrantyComp[]
}
export interface BatchWarranty {
  customer_name?: string; customer_phone?: string; customer_email?: string
  display_number: string; created_at: string | null; pcs: BatchWarrantyPC[]
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const fmtDate = (iso: string | null) => {
  if (!iso) return new Date().toLocaleDateString("ru-RU")
  try { return new Date(iso).toLocaleDateString("ru-RU") } catch { return iso }
}

const WARRANTY_TERMS = [
  "Гарантийный срок исчисляется с даты выдачи товара. Гарантийное обслуживание осуществляется при наличии данного талона и кассового документа.",
  "Гарантия не распространяется на случаи механических повреждений, следов вскрытия, нарушения заводских пломб и наклеек, попадания жидкости, воздействия высоких температур, а также при нарушении правил эксплуатации.",
  "Гарантийное обслуживание не превышает 45 дней и осуществляется в течение всего гарантийного срока, установленного на товар.",
  "Расходные материалы и элементы питания гарантийному обслуживанию не подлежат.",
]

export function buildBatchWarrantyHtml(w: BatchWarranty): string {
  const pcsHtml = w.pcs.map(pc => {
    const rows = pc.components.map(c => `
      <tr>
        <td>${esc(c.slot_label)}</td>
        <td>${esc(c.name)}</td>
        <td class="sn">${esc(c.serial) || "—"}</td>
      </tr>`).join("")
    return `
      <div class="pc">
        <div class="pc-head">
          <b>ПК №${esc(pc.unit_no)}</b>
          <span class="muted">${esc(pc.group_label)}</span>
          ${pc.pc_serial ? `<span class="muted">S/N ПК: ${esc(pc.pc_serial)}</span>` : ""}
          ${pc.warranty_until ? `<span class="muted">Гарантия до: ${esc(pc.warranty_until)}</span>` : ""}
        </div>
        <table>
          <thead><tr><th>Комплектующее</th><th>Наименование</th><th>Серийный номер</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="3" class="muted">Нет компонентов</td></tr>`}</tbody>
        </table>
      </div>`
  }).join("")

  const terms = WARRANTY_TERMS.map(t => `<li>${esc(t)}</li>`).join("")

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>Гарантийный талон ${esc(w.display_number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 24px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .head { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 8px 0; }
  .meta div { font-size: 12px; }
  .muted { color: #666; font-size: 11px; }
  .pc { margin-bottom: 14px; page-break-inside: avoid; }
  .pc-head { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; font-size: 11px; }
  td.sn { font-family: monospace; }
  .terms { margin-top: 18px; }
  .terms h2 { font-size: 14px; margin: 0 0 6px; }
  .terms ol { margin: 0; padding-left: 18px; }
  .terms li { margin-bottom: 5px; }
  .sign { display: flex; justify-content: space-between; margin-top: 30px; gap: 40px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; text-align: center; font-size: 11px; }
  @media print { body { margin: 12mm; } button { display: none; } }
</style></head>
<body>
  <div class="head">
    <h1>Гарантийный талон</h1>
    <div class="meta">
      <div><b>№ заказа:</b> ${esc(w.display_number)}</div>
      <div><b>Дата:</b> ${fmtDate(w.created_at)}</div>
      <div><b>ПК в партии:</b> ${w.pcs.length}</div>
    </div>
    <div class="meta">
      ${w.customer_name ? `<div><b>Клиент:</b> ${esc(w.customer_name)}</div>` : ""}
      ${w.customer_phone ? `<div><b>Телефон:</b> ${esc(w.customer_phone)}</div>` : ""}
      ${w.customer_email ? `<div><b>E-mail:</b> ${esc(w.customer_email)}</div>` : ""}
    </div>
  </div>

  ${pcsHtml}

  <div class="terms">
    <h2>Гарантийные условия</h2>
    <ol>${terms}</ol>
  </div>

  <div class="sign">
    <div>Продавец / подпись</div>
    <div>Покупатель / подпись</div>
  </div>

  <script>window.onload = function () { setTimeout(function(){ window.print() }, 300) }</script>
</body></html>`
}
