import json
import os
import base64
import io
import urllib.request
import psycopg2
from datetime import datetime

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p72635010_quantum_fusion_resea")

cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token",
}

FONT_REGULAR_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf"
FONT_BOLD_URL    = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf"

_fonts_registered = False

def ensure_fonts():
    global _fonts_registered
    if _fonts_registered:
        return
    def fetch_to_tmp(url, name):
        path = f"/tmp/{name}"
        try:
            with open(path, "rb"):
                pass
        except FileNotFoundError:
            with urllib.request.urlopen(url, timeout=15) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
        return path
    reg  = fetch_to_tmp(FONT_REGULAR_URL, "djv.ttf")
    bold = fetch_to_tmp(FONT_BOLD_URL, "djvb.ttf")
    pdfmetrics.registerFont(TTFont("dj",  reg))
    pdfmetrics.registerFont(TTFont("djB", bold))
    _fonts_registered = True


def months_label(n: int) -> str:
    if n % 100 in range(11, 20):
        return f"{n} месяцев"
    r = n % 10
    if r == 1:   return f"{n} месяц"
    if r in (2, 3, 4): return f"{n} месяца"
    return f"{n} месяцев"


WARRANTY_BLOCKS = [
    ("h1", "Гарантийные условия"),
    ("h2", "Процедура возврата товара."),
    ("h2b", "Товар надлежащего качества"),
    ("p", "Если Вы хотите вернуть товар надлежащего качества, Вам необходимо в течение 7 дней обратиться в магазин и заполнить заявление на возврат товара. При возврате товара надлежащего качества должны быть сохранены товарный вид, целостность упаковки, комплектация, наличие сопроводительных документов (Гарантийный талон, кассовый чек). Наличие следов эксплуатации может стать основанием для отказа в удовлетворении Ваших требований. Возврат денежных средств производится таким же способом, каким осуществлялась оплата товара."),
    ("h2b", "Товар ненадлежащего качества"),
    ("p", "Если в приобретённом Вами товаре был выявлен недостаток Вы вправе по своему выбору заявить одно из требований, указанных в ст.18 Закона РФ от 07.02.1992 N 2300-1 О защите прав потребителей. Тем не менее, если указанный товар относится к технически сложным (Постановление N924 от 10.11.2011), то требования могут быть заявлены только в течение 15 календарных дней с даты покупки. По истечении 15 дней предъявление требований возможно если:"),
    ("bullet", "обнаружен существенный недостаток"),
    ("bullet", "нарушены сроки устранения недостатков"),
    ("bullet", "товар не может использоваться более тридцати дней в течение каждого года гарантийного срока"),
    ("h2", "Проверка качества товара."),
    ("p", "При предъявлении Вами претензии продавцу вправе провести проверку качества товара. Напоминаем о необходимости предоставления товара вместе с претензией в магазин."),
    ("p", "Если Вы не согласны с результатами проведённой проверки качества, Вы вправе заявить письменное требование о проведении независимой экспертизы товара. Экспертиза проводится за счёт продавца."),
    ("p", "В случае, если экспертиза установит наличие недостатков, возникших не по вине магазина или изготовителя, то вы обязаны возместить стоимость экспертизы."),
    ("p", "Сумма возврата будет равняться сумме покупки. Срок рассмотрения заявления рассчитывается в рабочих днях без учёта праздников/выходных дней."),
    ("h1", "Условия проведения гарантийного обслуживания"),
    ("bullet", "Фактическое наличие неисправного товара в момент обращения"),
    ("bullet", "Гарантийное обслуживание на товары, гарантию на которые не даёт производитель, осуществляется в специализированных сервисных центрах"),
    ("bullet", "Срок гарантийного обслуживания не превышает 45 дней"),
    ("bullet", "Гарантийное обслуживание осуществляется в течение всего гарантийного срока, установленного на товар"),
    ("h1", "Право на гарантийный ремонт не распространяется на случаи"),
    ("bullet", "Неисправность вызвана нарушением правил эксплуатации, транспортировки и хранения"),
    ("bullet", "На устройстве отсутствует, нарушен или не читается оригинальный серийный номер"),
    ("bullet", "На устройстве отсутствуют или нарушены заводские или гарантийные пломбы и наклейки"),
    ("bullet", "Ремонт или модернизация устройства производились лицами, не уполномоченными производителем"),
    ("bullet", "Дефекты вызваны эксплуатацией в составе комплекта неисправного оборудования"),
    ("bullet", "Обнаруживается попадание внутрь устройства посторонних предметов, веществ, жидкостей, насекомых"),
    ("bullet", "Неисправность вызвана внешними механическими, химическими, термическими или иными воздействиями"),
    ("bullet", "Неисправность вызвана стихийными бедствиями или скачками напряжения электропитания"),
    ("bullet", "Неисправность вызвана несоответствием государственным стандартам параметров питающих сетей"),
    ("bullet", "Иные случаи, предусмотренные производителем"),
    ("p", "Гарантийные обязательства не распространяются на расходные элементы и материалы"),
]


class PDFWriter:
    """Минималистичный построитель PDF на canvas без XML-парсинга."""

    PAGE_W, PAGE_H = A4
    ML = 20 * mm
    MR = 20 * mm
    MT = 15 * mm
    MB = 15 * mm

    def __init__(self, buf):
        self.c = canvas.Canvas(buf, pagesize=A4)
        self.W = self.PAGE_W - self.ML - self.MR
        self.y = self.PAGE_H - self.MT
        self._cur_font = "dj"
        self._cur_size = 9

    def _check_page(self, need=10*mm):
        if self.y < self.MB + need:
            self.c.showPage()
            self.c.setFillColorRGB(1, 1, 1)
            self.c.rect(0, 0, self.PAGE_W, self.PAGE_H, fill=1, stroke=0)
            self.c.setFillColorRGB(0, 0, 0)
            self.c.setFont(self._cur_font, self._cur_size)
            self.y = self.PAGE_H - self.MT

    def _draw_text(self, text: str, font: str, size: float, x: float, y: float, max_w: float = None) -> float:
        """Рисует текст с переносом по словам. Возвращает новый y."""
        self._cur_font, self._cur_size = font, size
        self.c.setFont(font, size)
        line_h = size * 1.4
        if max_w is None:
            max_w = self.W
        words = text.split()
        line = ""
        for word in words:
            test = (line + " " + word).strip()
            if self.c.stringWidth(test, font, size) <= max_w:
                line = test
            else:
                if line:
                    self._check_page(line_h * 2)
                    self.c.drawString(x, self.y, line)
                    self.y -= line_h
                line = word
        if line:
            self._check_page(line_h * 2)
            self.c.drawString(x, self.y, line)
            self.y -= line_h
        return self.y

    def text(self, txt, font="dj", size=9, indent=0, gap_after=1.5):
        lh = size * 1.4
        self._draw_text(txt, font, size, self.ML + indent, self.y, self.W - indent)
        self.y -= gap_after

    def hline(self):
        self._check_page(5*mm)
        self.c.setLineWidth(0.5)
        self.c.line(self.ML, self.y, self.ML + self.W, self.y)
        self.y -= 3*mm

    def ln(self, h=3):
        self.y -= h

    def cell_row(self, cells, col_widths, font="dj", size=8, row_h=None):
        """Рисует строку таблицы. cells = [text,...], col_widths = [w,...]"""
        self.c.setFont(font, size)
        lh = size * 1.35
        if row_h is None:
            # вычислить нужную высоту по самой высокой ячейке
            max_lines = 1
            for i, cell in enumerate(cells):
                words = cell.split()
                cw = col_widths[i] - 4
                line = ""
                lines = 0
                for w in words:
                    test = (line + " " + w).strip()
                    if self.c.stringWidth(test, font, size) <= cw:
                        line = test
                    else:
                        if line: lines += 1
                        line = w
                if line: lines += 1
                max_lines = max(max_lines, lines)
            row_h = lh * max_lines + 2

        self._check_page(row_h + 2)
        y0 = self.y
        x = self.ML
        for i, (cell, cw) in enumerate(zip(cells, col_widths)):
            self.c.rect(x, y0 - row_h, cw, row_h)
            # текст с переносом внутри ячейки
            inner_w = cw - 4
            words = cell.split()
            line = ""
            lines_out = []
            for w in words:
                test = (line + " " + w).strip()
                if self.c.stringWidth(test, font, size) <= inner_w:
                    line = test
                else:
                    if line: lines_out.append(line)
                    line = w
            if line: lines_out.append(line)
            ty = y0 - 2 - lh * 0
            for ln in lines_out:
                self.c.drawString(x + 2, ty - lh + size * 0.3, ln)
                ty -= lh
            x += cw
        self.y = y0 - row_h

    def save(self):
        self.c.save()


def handler(event: dict, context) -> dict:
    """Генерация PDF гарантийного листа по order_id."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    params = event.get("queryStringParameters") or {}
    order_id = params.get("order_id")
    if not order_id:
        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "order_id required"})}

    ensure_fonts()

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(
        f"SELECT customer_name, customer_phone, customer_email, items, total, created_at, order_type "
        f"FROM {SCHEMA}.orders WHERE id = %s",
        (int(order_id),)
    )
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Order not found"})}

    customer_name, customer_phone, customer_email, items_raw, total, created_at, order_type = row
    items = items_raw if isinstance(items_raw, list) else json.loads(items_raw)

    enriched = []

    if order_type == "pc_build":
        # Для ПК-заказов берём компоненты из wip_build
        cur.execute(
            f"SELECT wb.cpu, wb.motherboard, wb.ram, wb.gpu, wb.storage, "
            f"wb.psu, wb.case_name, wb.cooling, wb.extra, wb.build_id "
            f"FROM {SCHEMA}.wip_builds wb WHERE wb.order_id = %s LIMIT 1",
            (int(order_id),)
        )
        wip = cur.fetchone()
        slot_names = ["cpu", "motherboard", "ram", "gpu", "storage", "psu", "case_name", "cooling", "extra"]

        # Маппинг slot -> product_id из pc_builds
        slot_product_map = {}
        if wip and wip[9]:
            cur.execute(f"SELECT components FROM {SCHEMA}.pc_builds WHERE id = %s LIMIT 1", (wip[9],))
            pc_row = cur.fetchone()
            if pc_row and pc_row[0]:
                raw = pc_row[0] if isinstance(pc_row[0], list) else json.loads(pc_row[0])
                for comp in raw:
                    s = comp.get("slot")
                    if s and comp.get("source") == "catalog" and comp.get("source_id"):
                        slot_product_map[s] = int(comp["source_id"])

        # Серийники из items заказа по слоту (items хранят slot для ПК-заказов)
        slot_serials = {}
        slot_item_price = {}
        for it in items:
            slot = it.get("slot")
            if slot:
                sn = it.get("serial_numbers") or []
                if not sn and it.get("serial_number"):
                    sn = [it["serial_number"]]
                slot_serials[slot] = [s for s in sn if s and str(s).strip()]
                price = float(it.get("final_price") or it.get("price", 0))
                if price:
                    slot_item_price[slot] = price

        if wip:
            for i, slot in enumerate(slot_names):
                name = wip[i]
                if not name or not name.strip():
                    continue
                # Гарантия из склада
                warranty = 12
                pid = slot_product_map.get(slot)
                if not pid:
                    cur.execute(f"SELECT id FROM {SCHEMA}.products p WHERE p.name = %s LIMIT 1", (name,))
                    pr = cur.fetchone()
                    if pr:
                        pid = pr[0]
                if pid:
                    cur.execute(
                        f"SELECT wg.warranty_months FROM {SCHEMA}.warehouse_groups wg WHERE wg.product_id = %s LIMIT 1",
                        (pid,)
                    )
                    wr = cur.fetchone()
                    if wr and wr[0]:
                        warranty = wr[0]
                serials = slot_serials.get(slot, [])
                price = slot_item_price.get(slot, 0)
                enriched.append({
                    "name": name,
                    "qty": 1,
                    "price": price,
                    "warranty": warranty,
                    "serials": serials,
                })

        # Строка стоимости сборки
        assembly_fee = 0
        assembly_warranty = 12
        assembly_serials = []
        for it in items:
            if it.get("item_type") == "assembly" or "сборк" in str(it.get("name", "")).lower():
                assembly_fee = float(it.get("final_price") or it.get("price", 0))
                assembly_warranty = int(it.get("warranty_months") or 12)
                sn = it.get("serial_numbers") or []
                if not sn and it.get("serial_number"):
                    sn = [it["serial_number"]]
                assembly_serials = [s for s in sn if s and str(s).strip()]
        if not assembly_fee:
            # Пробуем из pc_builds
            if wip and wip[9]:
                cur.execute(f"SELECT assembly_fee FROM {SCHEMA}.pc_builds WHERE id = %s LIMIT 1", (wip[9],))
                af = cur.fetchone()
                if af and af[0]:
                    assembly_fee = float(af[0])
        if assembly_fee:
            enriched.append({
                "name": "Работа по сборке и настройке ПК",
                "qty": 1,
                "price": assembly_fee,
                "warranty": assembly_warranty,
                "serials": assembly_serials,
            })
    else:
        # Обычные заказы комплектующих
        for item in items:
            pid = item.get("id")
            warranty = 12
            if pid and item.get("item_type") == "product":
                cur.execute(
                    f"SELECT wg.warranty_months FROM {SCHEMA}.warehouse_groups wg WHERE wg.product_id = %s LIMIT 1",
                    (int(pid),)
                )
                wr = cur.fetchone()
                if wr and wr[0]:
                    warranty = wr[0]
            serials = item.get("serial_numbers") or []
            if not serials and item.get("serial_number"):
                serials = [item["serial_number"]]
            serials = [s for s in serials if s and str(s).strip()]
            enriched.append({
                "name": item.get("name", ""),
                "qty": item.get("quantity", 1),
                "price": float(item.get("final_price") or item.get("price", 0)),
                "warranty": warranty,
                "serials": serials,
            })

    cur.close(); conn.close()

    date_str  = created_at.strftime("%d.%m.%Y") if created_at else datetime.now().strftime("%d.%m.%Y")
    total_fmt = f"{float(total):,.2f}".replace(",", " ") + " руб."

    buf = io.BytesIO()
    p = PDFWriter(buf)
    W = p.W

    # ── Заголовок ───────────────────────────────────────────────────────────
    p.c.setFont("djB", 13)
    title = f"Товарный чек N {order_id}"
    tw = p.c.stringWidth(title, "djB", 13)
    p.c.drawString(p.ML + (W - tw) / 2, p.y, title)
    p.y -= 13 * 1.6
    p.ln(3)

    # ── Шапка: BeGraphics / дата ─────────────────────────────────────────────
    p.c.setFont("djB", 9)
    p.c.drawString(p.ML, p.y, "BeGraphics")
    date_txt = f"Дата: {date_str}"
    p.c.drawRightString(p.ML + W, p.y, date_txt)
    p.y -= 9 * 1.4
    p.c.setFont("dj", 9)
    p.c.drawString(p.ML, p.y, "Связь: вотсап, телеграм +79600296998")
    p.c.drawRightString(p.ML + W, p.y, f"Гарантийный талон N {order_id}")
    p.y -= 9 * 1.4
    p.ln(4)

    # ── Клиент ───────────────────────────────────────────────────────────────
    p.text(f"Покупатель: {customer_name}", size=9)
    p.text(f"Телефон: {customer_phone or '-'}", size=9)
    if customer_email:
        p.text(f"Email: {customer_email}", size=9)
    p.ln(4)

    # ── Таблица товаров ───────────────────────────────────────────────────────
    col_w = [W * 0.40, W * 0.22, W * 0.16, W * 0.08, W * 0.14]
    headers = ["Наименование товара", "Серийный номер", "Срок гарантии", "Кол.", "Цена"]
    p.c.setFillColorRGB(0.91, 0.91, 0.91)
    x = p.ML
    for i, (h, cw) in enumerate(zip(headers, col_w)):
        p.c.rect(x, p.y - 7*mm, cw, 7*mm, fill=1)
        x += cw
    p.c.setFillColorRGB(0, 0, 0)
    x = p.ML
    p.c.setFont("djB", 8)
    for h, cw in zip(headers, col_w):
        hw = p.c.stringWidth(h, "djB", 8)
        p.c.drawString(x + (cw - hw) / 2, p.y - 5*mm, h)
        x += cw
    p.y -= 7*mm

    for it in enriched:
        price_str = f"{it['price']:,.0f}".replace(",", " ") if it["price"] else "—"
        warranty_str = months_label(it["warranty"]) if it["warranty"] else "—"
        p.c.setFont("dj", 8)
        if it["serials"]:
            # Отдельная строка на каждый серийник — все данные в каждой строке
            for sn in it["serials"]:
                cells = [it["name"], sn, warranty_str, "1", price_str]
                p.cell_row(cells, col_w, font="dj", size=8)
        else:
            # Нет серийника — одна строка с общим кол-вом
            cells = [it["name"], "—", warranty_str, str(it["qty"]), price_str]
            p.cell_row(cells, col_w, font="dj", size=8)

    p.ln(18)
    p.c.setFont("djB", 11)
    total_str = f"Стоимость заказа: {total_fmt}"
    p.c.drawRightString(p.ML + W, p.y, total_str)
    p.y -= 11 * 1.4
    p.ln(12)

    # ── Гарантийный текст ─────────────────────────────────────────────────────
    for kind, text in WARRANTY_BLOCKS:
        if kind == "h1":
            p.ln(3)
            p.text(text, font="djB", size=10, gap_after=2)
        elif kind in ("h2", "h2b"):
            p.ln(1)
            p.text(text, font="djB", size=9, gap_after=1)
        elif kind == "bullet":
            p.text(f"  -  {text}", font="dj", size=9, gap_after=0.5)
        else:
            p.text(text, font="dj", size=9, gap_after=2)

    p.ln(8)
    p.hline()
    p.ln(3)

    # ── Подписи ───────────────────────────────────────────────────────────────
    p.c.setFont("dj", 9)
    p.c.drawString(p.ML, p.y, "Покупатель согласен с условиями гарантии:")
    p.c.drawString(p.ML + W * 0.6, p.y, "Продавец")
    p.y -= 9 * 1.4
    p.ln(10)
    p.c.drawString(p.ML, p.y, "____________________________")
    p.c.drawString(p.ML + W * 0.6, p.y, "____________________________")

    p.save()
    pdf_b64 = base64.b64encode(buf.getvalue()).decode()

    return {
        "statusCode": 200,
        "headers": {**cors, "Content-Type": "application/json"},
        "body": json.dumps({"pdf_b64": pdf_b64, "filename": f"warranty_{order_id}.pdf"}),
    }