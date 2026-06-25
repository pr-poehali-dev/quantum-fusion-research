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


def store_code_for_product(cur, pid):
    """Код магазина, из поставки которого пришёл товар (для гарантийки).
    product_id -> warehouse_groups -> последняя поставка с store_id -> code."""
    if not pid:
        return None
    cur.execute(
        f"SELECT st.code "
        f"FROM {SCHEMA}.warehouse_supplies s "
        f"JOIN {SCHEMA}.warehouse_groups g ON g.id = s.group_id "
        f"JOIN {SCHEMA}.warehouse_stores st ON st.id = s.store_id "
        f"WHERE g.product_id = %s AND s.store_id IS NOT NULL "
        f"ORDER BY s.id DESC LIMIT 1",
        (int(pid),),
    )
    row = cur.fetchone()
    return (row[0].strip() if row and row[0] else None)


def store_code_for_serial(cur, serial):
    """Код магазина по конкретному серийнику из реестра sn_archive.
    Главный приоритет для гарантийки: знаем, откуда КОНКРЕТНО куплена железка
    (например, проц), даже если потом докупали ту же модель в другом месте."""
    if not serial:
        return None
    s = str(serial).strip()
    if not s:
        return None
    cur.execute(
        f"SELECT st.code "
        f"FROM {SCHEMA}.sn_archive a "
        f"JOIN {SCHEMA}.warehouse_stores st ON st.id = a.store_id "
        f"WHERE a.serial = %s AND a.store_id IS NOT NULL "
        f"ORDER BY a.id DESC LIMIT 1",
        (s,),
    )
    row = cur.fetchone()
    return (row[0].strip() if row and row[0] else None)


def store_code_by_serials(cur, serials, pid):
    """Магазин для строки гарантийки: сперва по серийнику (точно),
    иначе фолбэк на последнюю поставку товара."""
    for sn in (serials or []):
        code = store_code_for_serial(cur, sn)
        if code:
            return code
    return store_code_for_product(cur, pid)


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

    def _wrap_cell(self, text, inner_w, font, size):
        """Разбивает текст на строки по ширине ячейки. Длинные слова без
        пробелов (например серийные номера) дополнительно режутся по символам,
        чтобы не вылезать за границу колонки."""
        def split_long(word):
            """Режет слишком длинное слово на куски, влезающие в inner_w."""
            if self.c.stringWidth(word, font, size) <= inner_w:
                return [word]
            parts, chunk = [], ""
            for ch in word:
                if self.c.stringWidth(chunk + ch, font, size) <= inner_w:
                    chunk += ch
                else:
                    if chunk:
                        parts.append(chunk)
                    chunk = ch
            if chunk:
                parts.append(chunk)
            return parts

        lines_out = []
        line = ""
        for w in text.split():
            for piece in split_long(w):
                test = (line + " " + piece).strip()
                if self.c.stringWidth(test, font, size) <= inner_w:
                    line = test
                else:
                    if line:
                        lines_out.append(line)
                    line = piece
        if line:
            lines_out.append(line)
        return lines_out or [""]

    def cell_row(self, cells, col_widths, font="dj", size=8, row_h=None):
        """Рисует строку таблицы. cells = [text,...], col_widths = [w,...]"""
        self.c.setFont(font, size)
        lh = size * 1.35
        # заранее переносим текст каждой ячейки (с учётом длинных слов)
        wrapped = [self._wrap_cell(cell, cw - 4, font, size)
                   for cell, cw in zip(cells, col_widths)]
        if row_h is None:
            max_lines = max((len(w) for w in wrapped), default=1)
            row_h = lh * max_lines + 2

        self._check_page(row_h + 2)
        y0 = self.y
        x = self.ML
        for lines_out, cw in zip(wrapped, col_widths):
            self.c.rect(x, y0 - row_h, cw, row_h)
            ty = y0 - 2
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

        # Состав сборки — источник истины (верные slot/qty/price, включая нестандартные слоты).
        slot_product_map = {}
        slot_build_price = {}  # цена компонента из состава сборки (фолбэк для гарантийки)
        build_components = []
        if wip and wip[9]:
            cur.execute(f"SELECT components FROM {SCHEMA}.pc_builds WHERE id = %s LIMIT 1", (wip[9],))
            pc_row = cur.fetchone()
            if pc_row and pc_row[0]:
                build_components = pc_row[0] if isinstance(pc_row[0], list) else json.loads(pc_row[0])
                for comp in build_components:
                    s = comp.get("slot")
                    if not s:
                        continue
                    if comp.get("source") == "catalog" and comp.get("source_id"):
                        slot_product_map[s] = int(comp["source_id"])
                    cp = float(comp.get("current_price") or comp.get("price") or 0)
                    if cp:
                        slot_build_price[s] = cp

        # Серийники из items[0].slot_serials (новый формат) или по slot (старый)
        slot_serials = {}
        slot_item_price = {}
        slot_status_map = {}  # slot -> item_status (для отсева returned)
        for it in items:
            # Новый формат: slot_serials = {slot: [sn1, sn2]}
            stored = it.get("slot_serials") or {}
            for s, sn in stored.items():
                slot_serials[s] = sn if isinstance(sn, list) else [sn]
        for it in items:
            slot = it.get("slot")
            if slot:
                if it.get("item_status"):
                    slot_status_map[slot] = it["item_status"]
                sn = it.get("serial_numbers") or []
                if not sn and it.get("serial_number"):
                    sn = [it["serial_number"]]
                if sn:
                    slot_serials[slot] = [s for s in sn if s and str(s).strip()]
                price = float(it.get("final_price") or it.get("price", 0))
                if price:
                    slot_item_price[slot] = price

        if build_components:
            for comp in build_components:
                slot = comp.get("slot")
                name = comp.get("name")
                if not name or not str(name).strip():
                    continue
                qty = int(comp.get("qty", 1))
                # Возвращённый на склад компонент в гарантийку не попадает
                slot_alias = "case" if slot == "case_name" else slot
                if slot_status_map.get(slot) == "returned" or slot_status_map.get(slot_alias) == "returned":
                    continue
                # Гарантия из склада
                warranty = 12
                pid = None
                if comp.get("source") == "catalog" and comp.get("source_id"):
                    pid = int(comp["source_id"])
                if not pid:
                    # Устойчиво к лишним пробелам и регистру (имена в каталоге
                    # бывают с хвостовым пробелом → точное сравнение не находило товар)
                    cur.execute(
                        f"SELECT id FROM {SCHEMA}.products p "
                        f"WHERE LOWER(TRIM(p.name)) = LOWER(TRIM(%s)) LIMIT 1",
                        (name,)
                    )
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
                # Цена: сперва из items заказа, иначе из состава сборки (pc_builds),
                # иначе актуальная цена каталога по товару.
                price = slot_item_price.get(slot, 0)
                if not price:
                    price = float(comp.get("current_price") or comp.get("price") or 0)
                if not price:
                    price = slot_build_price.get(slot) or slot_build_price.get(slot_alias) or 0
                if not price and pid:
                    cur.execute(f"SELECT price FROM {SCHEMA}.products WHERE id = %s LIMIT 1", (pid,))
                    pp = cur.fetchone()
                    if pp and pp[0]:
                        price = float(pp[0])
                # Магазин: сперва точно по серийнику (sn_archive), затем по поставке.
                store_code = store_code_by_serials(cur, serials, pid)
                enriched.append({
                    "name": name + (f" [{store_code}]" if store_code else ""),
                    "qty": qty,
                    "price": price,
                    "warranty": warranty,
                    "serials": serials,
                })

        # Строка стоимости сборки.
        # ВАЖНО: цену работы берём ТОЛЬКО из pc_builds.assembly_fee — это источник истины.
        # Строку item_type="config" из orders.items НЕ используем как fee (там может лежать
        # мусорное final_price), иначе работа задваивается/искажается.
        assembly_fee = 0
        assembly_warranty = 12
        assembly_serials = []
        for it in items:
            if it.get("assembly_warranty"):
                assembly_warranty = int(it["assembly_warranty"])
            # Явная строка услуги сборки (не config) — берём её данные
            if it.get("item_type") == "assembly":
                if it.get("warranty_months"):
                    assembly_warranty = int(it["warranty_months"])
                sn = it.get("serial_numbers") or []
                if not sn and it.get("serial_number"):
                    sn = [it["serial_number"]]
                assembly_serials = [s for s in sn if s and str(s).strip()]
        # Цена работы — всегда из состава сборки
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
            # Возвращённые на склад позиции в гарантийку не попадают
            if item.get("item_status") == "returned":
                continue
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
            # Магазин: точно по серийнику из sn_archive, иначе по последней поставке.
            store_code = store_code_for_serial(cur, serials[0]) if serials else None
            if not store_code and pid and item.get("item_type") == "product":
                store_code = store_code_for_product(cur, pid)
            enriched.append({
                "name": item.get("name", "") + (f" [{store_code}]" if store_code else ""),
                "qty": item.get("quantity", 1),
                "price": float(item.get("final_price") or item.get("price", 0)),
                "warranty": warranty,
                "serials": serials,
            })

    cur.close(); conn.close()

    date_str  = created_at.strftime("%d.%m.%Y") if created_at else datetime.now().strftime("%d.%m.%Y")
    # Стоимость считаем как сумму строк чека (цена × кол-во) — это всегда соответствует
    # тому, что напечатано в таблице. orders.total для ПК-сборок может быть устаревшим.
    computed_total = sum(float(it.get("price", 0) or 0) * int(it.get("qty", 1) or 1) for it in enriched)
    total_fmt = f"{computed_total:,.2f}".replace(",", " ") + " руб."

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