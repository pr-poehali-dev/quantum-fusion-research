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
MODEL = os.environ.get("RECEIPT_MODEL", "qwen2.5vl:7b")
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


def fetch_image_b64(url):
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return base64.b64encode(r.content).decode()


def recognize(image_b64):
    """Шлём фото в Ollama. /api/generate — stateless, новый контекст на каждый чек."""
    payload = {
        "model": MODEL,
        "prompt": PROMPT,
        "images": [image_b64],
        "stream": False,
        "format": "json",       # просим Ollama вернуть валидный JSON
        "keep_alive": "30m",    # держим модель в VRAM, но контекст НЕ копим
        "options": {"temperature": 0},
    }
    r = requests.post(OLLAMA_URL, data=json.dumps(payload), timeout=180)
    r.raise_for_status()
    text = r.json().get("response", "").strip()
    # на всякий случай вырезаем возможные ```json ... ```
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):text.rfind("}") + 1]
    return json.loads(text)


def main():
    print(f"[worker] старт. backend={BACKEND_URL} model={MODEL}")
    while True:
        try:
            job = pull_job()
            if not job:
                time.sleep(POLL_INTERVAL)
                continue
            jid, img_url = job["id"], job["image_url"]
            print(f"[worker] задача #{jid}: {img_url}")
            try:
                b64 = fetch_image_b64(img_url)
                result = recognize(b64)
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