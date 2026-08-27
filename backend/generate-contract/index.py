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

# Строгий деловой шрифт с засечками (PT Serif) — хорошо смотрится в договоре,
# полная поддержка кириллицы. Fallback на DejaVuSans, если PT Serif недоступен.
FONT_REGULAR_URL = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ptserif/PT_Serif-Web-Regular.ttf"
FONT_BOLD_URL    = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ptserif/PT_Serif-Web-Bold.ttf"
FONT_REGULAR_FALLBACK = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf"
FONT_BOLD_FALLBACK    = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf"

_fonts_registered = False

MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня",
             "июля", "августа", "сентября", "октября", "ноября", "декабря"]

SLOT_LABELS = {
    "cpu": "Процессор", "motherboard": "Плата", "ram": "Память",
    "gpu": "Видеокарта", "storage": "Ссд", "psu": "Блок питания",
    "case": "Корпус", "case_name": "Корпус", "cooling": "Охлаждение",
    "fan": "Вентилятор", "extra": "Прочее", "other": "Прочее",
}


def ensure_fonts():
    global _fonts_registered
    if _fonts_registered:
        return

    def fetch_to_tmp(url, name, fallback_url=None):
        path = f"/tmp/{name}"
        try:
            with open(path, "rb"):
                pass
            return path
        except FileNotFoundError:
            pass
        last_err = None
        for u in [url, fallback_url]:
            if not u:
                continue
            try:
                with urllib.request.urlopen(u, timeout=15) as r:
                    data = r.read()
                with open(path, "wb") as f:
                    f.write(data)
                return path
            except Exception as e:
                last_err = e
                continue
        raise last_err

    reg = fetch_to_tmp(FONT_REGULAR_URL, "ctr_reg.ttf", FONT_REGULAR_FALLBACK)
    bold = fetch_to_tmp(FONT_BOLD_URL, "ctr_bold.ttf", FONT_BOLD_FALLBACK)
    pdfmetrics.registerFont(TTFont("dj", reg))
    pdfmetrics.registerFont(TTFont("djB", bold))
    _fonts_registered = True


def fmt_money(n):
    try:
        return f"{float(n):,.0f}".replace(",", " ")
    except (ValueError, TypeError):
        return "0"


def fmt_money2(n):
    try:
        return f"{float(n):,.2f}".replace(",", " ").replace(".", ",")
    except (ValueError, TypeError):
        return "0,00"


def date_ru(dt):
    if not dt:
        dt = datetime.now()
    return f"«{dt.day:02d}» {MONTHS_RU[dt.month - 1]} {dt.year}г."


# ─── Многостраничный «писатель» PDF с авто-переносом строк ─────────────────────
class Doc:
    def __init__(self):
        self.buf = io.BytesIO()
        self.c = canvas.Canvas(self.buf, pagesize=A4)
        self.W, self.H = A4
        self.lm = 20 * mm
        self.rm = 20 * mm
        self.tm = 18 * mm
        self.bm = 22 * mm
        self.y = self.H - self.tm
        self.maxw = self.W - self.lm - self.rm
        self._header_done_footer()

    def _header_done_footer(self):
        # верхняя плашка
        self.c.setFont("dj", 8)
        self.c.setFillGray(0.4)
        self.c.drawString(self.lm, self.H - 12 * mm, "Договор поставки компьютеров")
        self.c.setStrokeGray(0.75)
        self.c.line(self.lm, self.H - 13 * mm, self.W - self.rm, self.H - 13 * mm)
        # нижние подписи
        self.c.setFont("dj", 9)
        self.c.setFillGray(0.2)
        self.c.drawString(self.lm, self.bm - 6 * mm, "Поставщик ______________")
        self.c.drawString(self.W / 2 + 10 * mm, self.bm - 6 * mm, "Покупатель ______________")
        self.c.setFillGray(0)

    def _newpage(self):
        self.c.showPage()
        self.y = self.H - self.tm
        self._header_done_footer()

    def _ensure(self, h):
        if self.y - h < self.bm:
            self._newpage()

    def space(self, h=4):
        self.y -= h * mm

    def text(self, s, font="dj", size=9.5, gap=1.6, indent=0, color=0.15):
        self.c.setFont(font, size)
        self.c.setFillGray(color)
        words = s.split(" ")
        line = ""
        x = self.lm + indent * mm
        avail = self.maxw - indent * mm
        for w in words:
            test = (line + " " + w).strip()
            if pdfmetrics.stringWidth(test, font, size) > avail and line:
                self._ensure(size * 0.5)
                self.c.setFont(font, size); self.c.setFillGray(color)
                self.c.drawString(x, self.y, line)
                self.y -= (size + gap)
                line = w
            else:
                line = test
        if line:
            self._ensure(size * 0.5)
            self.c.setFont(font, size); self.c.setFillGray(color)
            self.c.drawString(x, self.y, line)
            self.y -= (size + gap)
        self.c.setFillGray(0)

    def center(self, s, font="djB", size=13, gap=4, color=0.1):
        self._ensure(size * 0.6)
        self.c.setFont(font, size); self.c.setFillGray(color)
        self.c.drawCentredString(self.W / 2, self.y, s)
        self.c.setFillGray(0)
        self.y -= (size + gap)

    def heading(self, s):
        self.space(3)
        # подложка-плашка под заголовком раздела
        self._ensure(7)
        self.c.setFillGray(0.93)
        self.c.rect(self.lm, self.y - 2, self.maxw, 6 * mm, stroke=0, fill=1)
        self.c.setFillGray(0)
        self.c.setFont("djB", 10.5); self.c.setFillGray(0.1)
        self.c.drawString(self.lm + 2 * mm, self.y + 1.2 * mm, s)
        self.c.setFillGray(0)
        self.y -= (6 * mm + 2)

    def save(self):
        self.c.showPage()
        self.c.save()
        return self.buf.getvalue()


def build_contract(d, order, company):
    order_id, cust_name, cust_phone = order["id"], order["name"], order["phone"]
    doc_date = order["doc_date"]   # сегодняшняя дата документа
    year_end = doc_date.year

    # ── Шапка ──
    d.space(2)
    d.center(f"Договор поставки компьютера № {order_id}", size=14, gap=5)
    d.center(f"Покупатель: {cust_name} {cust_phone}", size=11.5, gap=6, color=0.2)
    # тонкая разделительная линия под шапкой
    d.c.setStrokeGray(0.8); d.c.setLineWidth(0.5)
    d.c.line(d.lm, d.y, d.W - d.rm, d.y)
    d.y -= 10
    d.c.setFont("dj", 9.5); d.c.setFillGray(0.2)
    d.c.drawString(d.lm, d.y, f"г. {company['city']}")
    d.c.drawRightString(d.W - d.rm, d.y, date_ru(doc_date))
    d.c.setFillGray(0)
    d.y -= 14
    d.text(f"{company['supplier_name']}, в лице {company['supplier_person']}, именуемый в дальнейшем "
           f"Поставщик, с одной стороны.")
    d.text(f"И {cust_name}, именуемый в дальнейшем Покупатель, с другой стороны, именуемые в дальнейшем "
           f"Стороны, заключили настоящий договор (далее – «Договор») о нижеследующем:")

    d.heading("1. Предмет Договора")
    d.text("1.1. Поставщик обязуется поставить компьютеры и/или комплектующие (далее – «Товар»), в количестве, "
           "ассортименте (наименованием) и по ценам, согласованным сторонами, а Покупатель обязуется принять "
           "и оплатить товар, в порядке, определенном настоящим Договором.")
    d.text("1.2. Количество, ассортимент и цена поставляемого товара, сроки и адрес поставки указываются в "
           "спецификациях, являющихся неотъемлемой частью настоящего Договора.")

    d.heading("2. Обязательства Сторон")
    for t in [
        "2.1. Поставщик обязуется:",
        "2.1.1. Осуществить поставку товаров в объеме и сроки согласно спецификации.",
        "2.1.2. Гарантировать соответствие поставляемого товара требованиям стандартов и техническим "
        "характеристикам (условиям), установленным для данного вида товара.",
        "2.1.3. Исполнить иные обязанности, предусмотренные настоящим Договором.",
        "2.2. Покупатель обязуется:",
        "2.2.1. Принять и оплатить товар согласно условиям настоящего Договора.",
        "2.2.2. Исполнить иные обязанности, предусмотренные настоящим Договором.",
    ]:
        d.text(t)

    d.heading("3. Условия поставки и порядок приемки товара")
    for t in [
        "3.1. Поставка осуществляется в сроки и на условиях, указанных в спецификациях.",
        "3.2. Товар должен быть упакован в родную коробку от компьютерного корпуса. Все дополнительные коробки "
        "(других комплектующих) и чеки передаются Покупателю по факту полной оплаты поставки.",
        "3.3. Приемка товара осуществляется ответственным лицом Покупателя на основании представленного им "
        "документа. При приёмке Товара Покупатель проверяет его соответствие сведениям, указанным в "
        "соответствующей спецификации к настоящему Договору поставки компьютеров, по наименованию, количеству "
        "и комплектации.",
        "3.4. При обнаружении каких-либо несоответствий передаваемого Товара требованиям настоящего Договора и "
        "спецификации, составляется соответствующий Акт с указанием нарушений и сроками их устранения Поставщиком.",
        "3.5. Поставщик передает Покупателю вместе с товаром все гарантийные документы на каждый конкретный предмет.",
        "3.6. Обязанность Поставщика по поставке (передаче) товара Покупателю считается исполненной с момента "
        "подписания ими данного договора.",
        "3.7. Право собственности на поставляемый товар, риск случайной гибели или случайного повреждения "
        "товара переходит от Поставщика к Покупателю с момента подписания.",
    ]:
        d.text(t)

    d.heading("4. Стоимость поставки и порядок расчетов")
    # Процент берём фактический — тот, что задали в диалоге печати. Зашитые
    # 30/70 расходились бы с суммой предоплаты в спецификации, а это спор
    # с покупателем на ровном месте.
    pp = int(order.get("prepay_pct", 30) or 0)
    rest = 100 - pp
    if pp <= 0:
        pay_terms = "4.3. Оплата за поставляемый товар производится в полном объеме при приеме товара."
    elif pp >= 100:
        pay_terms = "4.3. Оплата за поставляемый товар производится в полном объеме при заказе."
    else:
        pay_terms = (f"4.3. Оплата за поставляемый товар производится {pp}% при заказе "
                     f"и {rest}% при приеме товара.")
    for t in [
        "4.1. Стоимость (цена) поставляемого товара указывается в спецификациях.",
        "4.2. Цена товара по подписанной с двух сторон спецификации является фиксированной и изменению не подлежит.",
        pay_terms,
        "4.4. Расчет за поставленный товар производится Покупателем в течение 2 (двух) дней со дня подписания "
        "Сторонами договора.",
        "4.5. Датой платежа считается дата зачисления средств на счет Поставщика.",
        "4.6. Цена товара определена с учетом расходов на доставку до места поставки, разгрузку Товара, "
        "страхование, уплату таможенных пошлин, налогов, сборов и других обязательных платежей.",
    ]:
        d.text(t)

    d.heading("5. Ответственность Сторон и разрешение споров")
    for t in [
        "5.1. Покупатель вправе взыскать с Поставщика за недопоставку или просрочку поставки товаров в "
        "установленные соответствующей спецификацией сроки неустойку в размере 0,1 % от стоимости "
        "недопоставленного товара за каждый день недопоставки или просрочки, но не более 10% от стоимости "
        "Заявки. Обязанность по уплате неустойки возникает со дня предъявления соответствующего требования Покупателем.",
        "5.2. Уплата штрафных санкций не освобождает Поставщика от исполнения обязательств в полном объеме и "
        "устранения нарушений.",
        "5.3. При несвоевременной оплате товара по настоящему Договору (за исключением оплаты авансовых "
        "платежей), Поставщик вправе требовать оплату неустойки в размере 0,1% за каждый день просрочки не "
        "перечисленных в срок сумм, начиная со дня, следующего после дня истечения срока оплаты, но не более "
        "10% от суммы неоплаченного в срок товара.",
        "5.4. Ответственность Сторон в иных случаях определяется в соответствии с действующим законодательством "
        "Российской Федерации.",
        "5.5. Все споры или разногласия, возникающие между Сторонами по настоящему договору или в связи с ним, "
        "разрешаются путем переговоров между ними. В случае невозможности разрешения разногласий путем "
        "переговоров они подлежат рассмотрению в Арбитражном суде по месту нахождения ответчика.",
    ]:
        d.text(t)

    d.heading("6. Форс-мажор")
    for t in [
        "6.1. Стороны освобождаются от ответственности за частичное или полное неисполнение обязательств по "
        "настоящему Договору, если оно вызвано обстоятельствами непреодолимой силы (форс-мажор), а именно: "
        "пожаром, наводнением, землетрясением, войной, постановлениями государственных органов и т.п., и если "
        "эти обстоятельства непосредственно повлияли на исполнение настоящего Договора.",
        "6.2. Сторона, для которой создалась невозможность исполнения обязательств по настоящему Договору, "
        "должна в течение 5 (пяти) рабочих дней уведомить другую Сторону в письменной форме о наступлении и "
        "(или) прекращении обстоятельств, препятствующих исполнению обязательств.",
        "6.3. В случае продолжения указанных обстоятельств, свыше 10 (десяти) календарных дней, Стороны решают "
        "вопрос о судьбе настоящего Договора.",
    ]:
        d.text(t)

    d.heading("7. Заключительные положения")
    for t in [
        f"7.1. Настоящий Договор действует с даты подписания его Сторонами до 31 декабря {year_end} г. или до "
        "полного исполнения Сторонами своих обязательств по настоящему Договору.",
        "7.2. Любые изменения и дополнения к настоящему Договору имеют силу только в том случае, если они "
        "оформлены в письменном виде в форме дополнительного соглашения и подписаны обеими Сторонами.",
        "7.3. В случае изменения у какой-либо из Сторон юридического адреса, названия, банковских реквизитов и "
        "прочего она обязана в течение 10-ти календарных дней письменно известить об этом другую Сторону.",
        "7.4. Настоящий Договор составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному "
        "экземпляру для каждой из Сторон.",
    ]:
        d.text(t)

    # ── Реквизиты ──
    d.heading("8. Юридические адреса, банковские реквизиты и подписи Сторон")
    d.text("Поставщик:", font="djB", size=9.5)
    for line in [
        company["supplier_name"],
        f"Р/С {company['rs']}" if company.get("rs") else "",
        f"Банк {company['bank']}" if company.get("bank") else "",
        f"Корр.сч {company['ks']}" if company.get("ks") else "",
        f"БИК {company['bik']}" if company.get("bik") else "",
        f"ИНН {company['inn']}" if company.get("inn") else "",
        f"ОГРНИП {company['ogrnip']}" if company.get("ogrnip") else "",
    ]:
        if line:
            d.text(line)
    d.space(2)
    d.text("Покупатель:", font="djB", size=9.5)
    d.text(cust_name)
    d.text(cust_phone)
    # Паспортные данные — опционально, печатаем только если заполнили в диалоге.
    if order.get("passport"):
        d.text(f"Паспорт: {order['passport']}")
    d.space(3)
    d.text("Стороны согласны с условиями данного договора и не имеют вопросов:")
    d.space(6)
    # линии подписей
    d.c.setStrokeGray(0.3)
    d.c.line(d.lm, d.y, d.lm + 70 * mm, d.y)
    d.c.line(d.W / 2 + 5 * mm, d.y, d.W / 2 + 5 * mm + 70 * mm, d.y)
    d.y -= 12
    d.c.setFont("dj", 7); d.c.setFillGray(0.4)
    d.c.drawString(d.lm + 10 * mm, d.y, "подпись, инициалы, фамилия")
    d.c.drawString(d.W / 2 + 15 * mm, d.y, "подпись, инициалы, фамилия")
    d.c.setFillGray(0); d.y -= 12
    d.c.drawString(d.lm, d.y + 4, company["sign_name"])
    d.c.setFont("dj", 8)
    d.c.drawString(d.lm, d.y - 8, "мп")
    d.c.drawString(d.W / 2 + 5 * mm, d.y - 8, "мп")


def build_spec(d, order, company):
    d._newpage()
    order_id, doc_date = order["id"], order["doc_date"]
    d.c.setFont("dj", 9.5); d.c.setFillGray(0.2)
    d.c.drawRightString(d.W - d.rm, d.y, "Приложение №1")
    d.y -= 13
    d.c.drawRightString(d.W - d.rm, d.y, f"к Договору поставки компьютеров № {order_id}")
    d.y -= 13
    d.c.drawRightString(d.W - d.rm, d.y, f"от {date_ru(doc_date)}")
    d.c.setFillGray(0)
    d.space(10)
    ds = doc_date.strftime("%d.%m.%Y")
    d.text(f"СПЕЦИФИКАЦИЯ №1 от {ds}г.", font="djB", size=12)
    d.space(4)

    # таблица: Слот | Наименование | Кол-во | Цена
    rows = order["spec_rows"]   # [(label, name, qty, line_sum)]
    col_x = d.lm
    c1 = 30 * mm                       # слот
    c3 = 14 * mm                       # кол-во
    c4 = 32 * mm                       # цена (шире — крупные суммы не обрезаются)
    c2 = d.maxw - c1 - c3 - c4         # наименование
    x_qty = col_x + c1 + c2
    x_price = col_x + c1 + c2 + c3

    pad = 2.5 * mm          # внутренний отступ ячейки
    line_h = 4.2 * mm       # высота одной текстовой строки
    min_rh = 8 * mm         # минимальная высота строки таблицы

    def wrap_lines(s, w, font="dj", size=9):
        """Переносит текст по словам так, чтобы каждая строка влезала в ширину w.
        Длинное слово (без пробелов) при необходимости рвётся по символам —
        текст НИКОГДА не теряется."""
        avail = w - 2 * pad
        words = str(s).split()
        if not words:
            return [""]
        lines, cur = [], ""
        for word in words:
            trial = (cur + " " + word).strip()
            if pdfmetrics.stringWidth(trial, font, size) <= avail:
                cur = trial
                continue
            if cur:
                lines.append(cur)
                cur = ""
            # слово само по себе шире ячейки — рвём по символам
            while pdfmetrics.stringWidth(word, font, size) > avail and len(word) > 1:
                chunk = word
                while pdfmetrics.stringWidth(chunk, font, size) > avail and len(chunk) > 1:
                    chunk = chunk[:-1]
                lines.append(chunk)
                word = word[len(chunk):]
            cur = word
        if cur:
            lines.append(cur)
        return lines or [""]

    def draw_cell(lines, x, w, top_y, height, align="left", font="dj", size=9, color=0.15):
        """Рисует многострочный текст, вертикально центрируя блок в ячейке."""
        d.c.setFont(font, size); d.c.setFillGray(color)
        block_h = len(lines) * line_h
        cy = top_y - (height - block_h) / 2 - line_h + 1.2 * mm
        for ln in lines:
            if align == "center":
                d.c.drawCentredString(x + w / 2, cy, ln)
            elif align == "right":
                d.c.drawRightString(x + w - pad, cy, ln)
            else:
                d.c.drawString(x + pad, cy, ln)
            cy -= line_h
        d.c.setFillGray(0)

    def row_height(cells):
        """cells: [(lines_count)] -> высота строки по самой «высокой» ячейке."""
        max_lines = max(cells) if cells else 1
        return max(min_rh, max_lines * line_h + 3 * mm)

    # ── Шапка таблицы ──
    hdr = [
        ("Комплектующее", col_x, c1, "left"),
        ("Наименование", col_x + c1, c2, "center"),
        ("Кол-во", x_qty, c3, "center"),
        ("Цена, ₽", x_price, c4, "right"),
    ]
    hdr_lines = [wrap_lines(t, w, "djB", 8.5) for t, _, w, _ in hdr]
    h_rh = row_height([len(l) for l in hdr_lines])
    d._ensure(h_rh / mm + 2)
    top = d.y
    d.c.setFillGray(0.92)
    d.c.rect(col_x, top - h_rh, d.maxw, h_rh, stroke=0, fill=1)
    d.c.setFillGray(0)
    for (t, x, w, al), lines in zip(hdr, hdr_lines):
        draw_cell(lines, x, w, top, h_rh, al, "djB", 8.5, 0.25)
    d.c.setStrokeGray(0.6); d.c.setLineWidth(0.6)
    d.c.rect(col_x, top - h_rh, d.maxw, h_rh)
    d.y -= h_rh

    # ── Строки (чередование фона, авто-высота, перенос текста) ──
    d.c.setStrokeGray(0.78); d.c.setLineWidth(0.4)
    for i, (label, name, qty, line_sum) in enumerate(rows):
        l_label = wrap_lines(label, c1, "dj", 8.5)
        l_name = wrap_lines(name, c2, "dj", 9)
        l_qty = wrap_lines(f"{qty} шт", c3, "dj", 8.5)
        l_price = wrap_lines(fmt_money(line_sum), c4, "djB", 9)
        r_h = row_height([len(l_label), len(l_name), len(l_qty), len(l_price)])
        d._ensure(r_h / mm + 2)
        top = d.y
        if i % 2 == 1:
            d.c.setFillGray(0.97)
            d.c.rect(col_x, top - r_h, d.maxw, r_h, stroke=0, fill=1)
            d.c.setFillGray(0)
        d.c.setStrokeGray(0.78)
        d.c.rect(col_x, top - r_h, c1, r_h)
        d.c.rect(col_x + c1, top - r_h, c2, r_h)
        d.c.rect(x_qty, top - r_h, c3, r_h)
        d.c.rect(x_price, top - r_h, c4, r_h)
        draw_cell(l_label, col_x, c1, top, r_h, "left", "dj", 8.5, 0.2)
        draw_cell(l_name, col_x + c1, c2, top, r_h, "center", "dj", 9, 0.1)
        draw_cell(l_qty, x_qty, c3, top, r_h, "center", "dj", 8.5, 0.2)
        draw_cell(l_price, x_price, c4, top, r_h, "right", "djB", 9, 0.1)
        d.y -= r_h

    # ── ИТОГО ──
    total_lines = wrap_lines(fmt_money(order["total"]), c4, "djB", 10)
    t_rh = row_height([len(total_lines), 1])
    d._ensure(t_rh / mm + 2)
    top = d.y
    d.c.setFillGray(0.9)
    d.c.rect(col_x, top - t_rh, d.maxw, t_rh, stroke=0, fill=1)
    d.c.setFillGray(0)
    d.c.setStrokeGray(0.6); d.c.setLineWidth(0.6)
    d.c.rect(col_x, top - t_rh, c1 + c2 + c3, t_rh)
    d.c.rect(x_price, top - t_rh, c4, t_rh)
    draw_cell(["ИТОГО:"], col_x, c1 + c2 + c3, top, t_rh, "right", "djB", 10, 0.1)
    draw_cell(total_lines, x_price, c4, top, t_rh, "right", "djB", 10, 0.05)
    d.y -= t_rh
    d.space(8)

    # Проценты берём фактические (order['prepay_pct']), а не зашитые 30/70 —
    # предоплату можно задать вручную в диалоге печати.
    _pp = order.get("prepay_pct", 30)
    d.text(f"Срок поставки: {company['delivery_days']} дней.")
    d.text(f"Предоплата ({_pp}%): {fmt_money2(order['prepay'])} руб.")
    d.text(f"Остаток ({100 - _pp}%): {fmt_money2(order['remaining'])} руб.")
    d.text("Стороны согласны с условиями, не имеют претензий к выполненной работе. Товар поставлен полностью, "
           "в соответствии с характеристиками.")
    d.space(14)
    d.c.setStrokeGray(0.3)
    d.c.line(d.lm, d.y, d.lm + 70 * mm, d.y)
    d.c.line(d.W / 2 + 5 * mm, d.y, d.W / 2 + 5 * mm + 70 * mm, d.y)
    d.y -= 4
    d.c.setFont("dj", 9); d.c.drawString(d.lm, d.y + 6, company["sign_name"])
    d.y -= 8
    d.c.setFont("dj", 7); d.c.setFillGray(0.4)
    d.c.drawString(d.lm + 10 * mm, d.y, "подпись, инициалы, фамилия")
    d.c.drawString(d.W / 2 + 15 * mm, d.y, "подпись, инициалы, фамилия")
    d.c.setFillGray(0)


def load_company(cur, entity_id=None):
    fields = ["supplier_name", "supplier_person", "sign_name", "rs", "bank", "ks",
              "bik", "inn", "ogrnip", "city", "delivery_days"]
    cols = ", ".join(fields)
    if entity_id:
        cur.execute(f"SELECT {cols} FROM {SCHEMA}.company_entities WHERE id = %s", (int(entity_id),))
        row = cur.fetchone()
        if row:
            return dict(zip(fields, row))
    # по умолчанию: помеченное is_default, иначе первое
    cur.execute(
        f"SELECT {cols} FROM {SCHEMA}.company_entities ORDER BY is_default DESC, sort_order, id LIMIT 1"
    )
    row = cur.fetchone()
    if not row:
        return {f: "" for f in fields} | {"city": "Москва", "delivery_days": 20}
    return dict(zip(fields, row))


def handler(event: dict, context) -> dict:
    """Генерация PDF договора поставки + спецификации по order_id."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": ""}

    params = event.get("queryStringParameters") or {}
    order_id = params.get("order_id")
    entity_id = params.get("entity_id")

    # Ручные переопределения из диалога печати (все опциональны).
    # Пустая строка = «не переопределять», берём значение из заказа/юрлица.
    def _p(key):
        v = (params.get(key) or "").strip()
        return v or None

    ov_prepay = _p("prepay")            # сумма предоплаты, руб
    ov_delivery = _p("delivery_days")   # срок поставки, дней
    ov_name = _p("cust_name")           # ФИО покупателя
    ov_phone = _p("cust_phone")         # телефон покупателя
    ov_passport = _p("passport")        # паспортные данные (опционально)

    if not order_id:
        return {"statusCode": 400, "headers": cors, "body": json.dumps({"error": "order_id required"})}

    ensure_fonts()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(
        f"SELECT customer_name, customer_phone, items, total, created_at, "
        f"prepayment_amount, prepayment_percent "
        f"FROM {SCHEMA}.orders WHERE id = %s",
        (int(order_id),),
    )
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return {"statusCode": 404, "headers": cors, "body": json.dumps({"error": "Order not found"})}

    cust_name, cust_phone, items_raw, total, created_at, prepay, pct = row
    remaining = None  # остаток = total - предоплата
    items = items_raw if isinstance(items_raw, list) else json.loads(items_raw or "[]")

    # Спецификация: строки по позициям (слот → название → цена) + строка «Работа»
    spec_rows = []
    calc_total = 0
    for it in items:
        if it.get("item_status") == "returned":
            continue
        itype = it.get("item_type")
        name = (it.get("name") or "").strip()
        if not name:
            continue
        price = float(it.get("final_price") if it.get("final_price") is not None else it.get("price", 0) or 0)
        qty = int(it.get("quantity", 1) or 1)
        line_sum = price * qty
        if itype == "assembly":
            label = "Работа"
        else:
            slot = it.get("slot") or "other"
            label = it.get("slot_label") or SLOT_LABELS.get(slot, "Прочее")
        spec_rows.append((label, name, qty, line_sum))
        calc_total += line_sum

    total_val = float(total) if total else calc_total
    pct_val = float(pct) if pct is not None else 30.0
    prepay_val = float(prepay) if prepay is not None else round(total_val * pct_val / 100, 2)
    # Предоплату из диалога печати ставим поверх сохранённой в заказе.
    if ov_prepay is not None:
        try:
            prepay_val = float(str(ov_prepay).replace(",", ".").replace(" ", ""))
        except ValueError:
            pass
    prepay_val = max(0.0, min(prepay_val, total_val))
    remaining_val = round(total_val - prepay_val, 2)
    # Процент считаем от фактической предоплаты — иначе в тексте договора
    # «Предоплата (30%)» разойдётся с реальной суммой.
    prepay_pct = round(prepay_val / total_val * 100) if total_val else 0

    company = load_company(cur, entity_id)
    cur.close(); conn.close()

    if ov_delivery is not None:
        try:
            company["delivery_days"] = int(float(ov_delivery))
        except ValueError:
            pass

    order = {
        "id": int(order_id),
        "name": ov_name or cust_name or "—",
        "phone": ov_phone or cust_phone or "",
        "passport": ov_passport or "",
        "doc_date": datetime.now(), "spec_rows": spec_rows, "total": total_val,
        "prepay": prepay_val, "remaining": remaining_val,
        "prepay_pct": prepay_pct,
    }

    d = Doc()
    build_contract(d, order, company)
    build_spec(d, order, company)
    pdf = d.save()

    pdf_b64 = base64.b64encode(pdf).decode()
    return {
        "statusCode": 200,
        "headers": {**cors, "Content-Type": "application/json"},
        "body": json.dumps({"pdf_b64": pdf_b64, "filename": f"contract_{order_id}.pdf"}),
    }