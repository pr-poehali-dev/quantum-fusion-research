"""
FastAPI-воркер распознавания счетов на ЛОКАЛЬНОМ сервере с GPU (2080 Ti 22GB).

Что делает:
  1. Раз в POLL_INTERVAL секунд опрашивает облачный бэкенд: "есть NEW задачи?"
  2. Берёт фото счёта, шлёт в локальную Ollama (модель qwen2-vl) с промптом.
  3. Модель возвращает JSON позиций -> воркер отправляет результат обратно.

ЗАПУСК:
    pip install fastapi uvicorn requests
    # модель:
    curl -fsSL https://ollama.com/install.sh | sh
    ollama pull qwen2-vl:7b
    # воркер (фоновый цикл, без веб-сервера достаточно просто python worker.py):
    python worker.py

БЕЗОПАСНОСТЬ: наружу этот воркер торчать НЕ обязан — он сам ходит к облаку.
Ollama держим на localhost:11434 и закрываем firewall'ом.
"""
import os
import time
import base64
import json
import requests

# ─── НАСТРОЙКИ (поменяй под себя) ─────────────────────────────────────────────
# URL облачной функции receipt-scan (из проекта)
BACKEND_URL = os.environ.get(
    "RECEIPT_BACKEND_URL",
    "https://functions.poehali.dev/de7a55a6-8858-43db-b39f-e5d791bc39b4",
)
# Тот же токен, что в секрете RECEIPT_WORKER_TOKEN на сайте
WORKER_TOKEN = os.environ.get("RECEIPT_WORKER_TOKEN", "ВСТАВЬ_СЮДА_ТОКЕН")
# Локальная Ollama
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
MODEL = os.environ.get("RECEIPT_MODEL", "qwen2.5vl:3b")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "3"))

# Промпт: жёстко требуем чистый JSON без лишнего текста
PROMPT = (
    "Ты распознаёшь товарный чек/счёт магазина компьютерных комплектующих "
    "(ДНС, Мерлион/Майнтрейд, Online и т.п.). Верни СТРОГО JSON без пояснений, "
    "без markdown, в формате:\n"
    '{"store": "название магазина или null", "date": "ГГГГ-ММ-ДД или null", '
    '"items": [{"name": "точное название товара как в чеке", "qty": число, '
    '"price": число_сумма_по_строке, "article": "артикул если есть иначе null"}]}\n'
    "Правила: qty — количество штук; price — сумма по строке (цена×кол-во) числом без пробелов и валюты; "
    "не выдумывай товары, бери только реальные строки чека; "
    "служебные строки (ИТОГО, НДС, скидка) НЕ включай в items."
)


def headers():
    return {"X-Worker-Token": WORKER_TOKEN, "Content-Type": "application/json"}


def pull_job():
    r = requests.get(f"{BACKEND_URL}?action=worker_pull", headers=headers(), timeout=30)
    r.raise_for_status()
    return r.json().get("job")


def send_result(job_id, result=None, error=None):
    body = {"action": "worker_result", "job_id": job_id}
    if error:
        body["error"] = error
    else:
        body["result"] = result
    r = requests.post(BACKEND_URL, headers=headers(), data=json.dumps(body), timeout=30)
    r.raise_for_status()


def fetch_bytes(url):
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.content


def _parse_json(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):text.rfind("}") + 1]
    return json.loads(text)


def ollama_vision(images_b64):
    """Распознавание по картинке(ам). /api/generate — stateless."""
    payload = {
        "model": MODEL, "prompt": PROMPT, "images": images_b64,
        "stream": False, "format": "json", "keep_alive": "30m",
        "options": {"temperature": 0},
    }
    r = requests.post(OLLAMA_URL, data=json.dumps(payload), timeout=300)
    r.raise_for_status()
    return _parse_json(r.json().get("response", ""))


def ollama_text(text_content):
    """Распознавание по тексту (Excel/текстовый PDF) — без картинки."""
    payload = {
        "model": MODEL,
        "prompt": PROMPT + "\n\nВот содержимое счёта (текст/таблица):\n" + text_content[:15000],
        "stream": False, "format": "json", "keep_alive": "30m",
        "options": {"temperature": 0},
    }
    r = requests.post(OLLAMA_URL, data=json.dumps(payload), timeout=300)
    r.raise_for_status()
    return _parse_json(r.json().get("response", ""))


def excel_to_text(data):
    """Читаем xlsx/xls в плоский текст. Нужен: pip install openpyxl"""
    import io, openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    lines = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) for c in row if c is not None and str(c).strip()]
            if cells:
                lines.append(" | ".join(cells))
    return "\n".join(lines)


def pdf_extract_text(data):
    """Пытаемся вытащить текст из PDF. Нужен: pip install pypdf"""
    import io
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    parts = []
    for page in reader.pages:
        t = page.extract_text() or ""
        if t.strip():
            parts.append(t)
    return "\n".join(parts)


def pdf_to_images_b64(data, max_pages=3):
    """Рендерим страницы PDF в картинки (для сканов). Нужен: pip install pymupdf"""
    import fitz  # PyMuPDF
    doc = fitz.open(stream=data, filetype="pdf")
    imgs = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        pix = page.get_pixmap(dpi=170)
        imgs.append(base64.b64encode(pix.tobytes("png")).decode())
    return imgs


def recognize(url):
    """Определяем тип файла по URL и распознаём подходящим способом."""
    data = fetch_bytes(url)
    low = url.lower().split("?")[0]

    # Excel — читаем таблицу, отдаём текстом
    if low.endswith((".xlsx", ".xls")):
        text = excel_to_text(data)
        print(f"[worker]   Excel -> {len(text)} символов текста")
        return ollama_text(text)

    # PDF — сначала пробуем текст, если пусто (скан) — рендерим в картинки
    if low.endswith(".pdf"):
        text = pdf_extract_text(data)
        if len(text.strip()) > 40:
            print(f"[worker]   PDF (текст) -> {len(text)} символов")
            return ollama_text(text)
        print("[worker]   PDF (скан) -> рендер страниц в картинки")
        return ollama_vision(pdf_to_images_b64(data))

    # иначе — обычная картинка
    return ollama_vision([base64.b64encode(data).decode()])


def main():
    print(f"[worker] старт. backend={BACKEND_URL} model={MODEL}")
    while True:
        try:
            job = pull_job()
            if not job:
                time.sleep(POLL_INTERVAL)
                continue
            jid, file_url = job["id"], job["image_url"]
            print(f"[worker] задача #{jid}: {file_url}")
            try:
                result = recognize(file_url)
                send_result(jid, result=result)
                print(f"[worker] #{jid} готово, позиций: {len(result.get('items', []))}")
            except Exception as e:
                print(f"[worker] #{jid} ошибка распознавания: {e}")
                send_result(jid, error=str(e))
        except Exception as e:
            print(f"[worker] цикл: {e}")
            time.sleep(POLL_INTERVAL * 2)


if __name__ == "__main__":
    main()