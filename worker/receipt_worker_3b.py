"""
==============================================================
  ВОРКЕР РАСПОЗНАВАНИЯ СЧЁТОВ  —  модель qwen2-vl:3b  (БЫСТРЫЙ)
==============================================================

Запускать на ПК/сервере, где установлена Ollama + видеокарта.
Модель держится в видеопамяти постоянно (keep_alive = -1),
контекст 8192 токена. Скрипт сам забирает задачи из облака,
распознаёт счёт и отправляет результат обратно.

ЗАПУСК:
    python receipt_worker_3b.py

ПЕРЕД ЗАПУСКОМ:
    1) Установить Ollama:  https://ollama.com/download
    2) Скачать модель:     ollama pull qwen2-vl:3b
    3) Установить зависимости:  pip install requests
    4) Прописать токен воркера в переменную окружения RECEIPT_WORKER_TOKEN
       (тот же, что в секрете проекта RECEIPT_WORKER_TOKEN),
       либо вписать его ниже в WORKER_TOKEN.

Легче и быстрее 7B, требует ~4-5 ГБ VRAM. Точность чуть ниже —
удобно для слабых видеокарт или когда нужна скорость.
ВАЖНО: не запускай 3b и 7b одновременно на одной карте, если не хватает
видеопамяти — иначе они будут выгружать друг друга.
"""

import os
import time
import json
import base64
import shutil
import subprocess
import requests

# ─────────────────── НАСТРОЙКИ ───────────────────
MODEL = "qwen2.5vl:3b"                # ← модель этого воркера (быстрая, 3B)
NUM_CTX = 8192                        # длина контекста
KEEP_ALIVE = -1                       # -1 = держать модель в VRAM вечно

API_URL = "https://functions.poehali.dev/de7a55a6-8858-43db-b39f-e5d791bc39b4"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# токен воркета: лучше задать через переменную окружения RECEIPT_WORKER_TOKEN
WORKER_TOKEN = os.environ.get("RECEIPT_WORKER_TOKEN", "ВСТАВЬ_ТОКЕН_СЮДА")

POLL_INTERVAL = 3                     # сек между опросами очереди, когда задач нет
REQUEST_TIMEOUT = 300                 # таймаут запроса к Ollama (распознавание долгое)

PROMPT = (
    "Ты распознаёшь товарный счёт (накладную) поставщика на фото. "
    "Верни СТРОГО JSON без пояснений в формате: "
    '{"store": "<название поставщика/магазина или null>", '
    '"items": [{"name": "<наименование товара>", "article": "<артикул/партномер или пусто>", '
    '"qty": <число>, "price": <цена за единицу числом>}]}. '
    "Цену указывай за 1 штуку. Количество — целым числом. "
    "Не придумывай позиции, бери только то, что видно на счёте. "
    "Если поле не читается — оставь пустую строку или null."
)
# ──────────────────────────────────────────────────


def log(msg: str):
    print(f"[{time.strftime('%H:%M:%S')}] [{MODEL}] {msg}", flush=True)


def ollama_alive() -> bool:
    """Проверяем, отвечает ли сервер Ollama."""
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def ensure_ollama():
    """Если Ollama не запущена — пробуем поднять `ollama serve` и ждём готовности.
    Если поднять не вышло — не берём задачи, чтобы не сжигать их в ошибки."""
    if ollama_alive():
        log("Ollama на связи.")
        return True

    log("Ollama не отвечает. Пробую запустить `ollama serve`...")
    exe = shutil.which("ollama")
    if exe:
        try:
            flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
            subprocess.Popen([exe, "serve"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=flags)
        except Exception as e:
            log(f"Не смог запустить ollama serve: {e}")
    else:
        log("Команда 'ollama' не найдена в PATH. Установи Ollama: https://ollama.com/download")

    # ждём до 30 сек, пока сервер поднимется
    for _ in range(30):
        if ollama_alive():
            log("Ollama запущена и готова.")
            return True
        time.sleep(1)

    log("ВНИМАНИЕ: Ollama так и не поднялась. Открой её вручную (ollama serve) и не закрывай окно.")
    return False


def warmup():
    """Прогрев: загружаем модель в VRAM сразу при старте, чтобы первая задача шла быстро."""
    log("Прогрев модели (загрузка в видеопамять)...")
    try:
        requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": MODEL, "prompt": "ok", "stream": False,
                  "keep_alive": KEEP_ALIVE, "options": {"num_ctx": NUM_CTX}},
            timeout=REQUEST_TIMEOUT,
        )
        log("Модель загружена и закреплена в VRAM (keep_alive=-1).")
    except Exception as e:
        log(f"Не удалось прогреть модель: {e}")


def fetch_image_b64(image_url: str) -> str:
    r = requests.get(image_url, timeout=60)
    r.raise_for_status()
    return base64.b64encode(r.content).decode("ascii")


def recognize(image_url: str) -> dict:
    """Скачиваем фото счёта и отправляем в Ollama. Возвращаем распарсенный JSON-результат."""
    img_b64 = fetch_image_b64(image_url)
    payload = {
        "model": MODEL,
        "prompt": PROMPT,
        "images": [img_b64],
        "stream": False,
        "format": "json",
        "keep_alive": KEEP_ALIVE,
        "options": {"num_ctx": NUM_CTX, "temperature": 0},
    }
    r = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    text = (r.json() or {}).get("response", "").strip()
    try:
        return json.loads(text)
    except Exception:
        # иногда модель оборачивает в ```json ... ```
        cleaned = text.strip().lstrip("`").replace("json", "", 1).strip().rstrip("`").strip()
        return json.loads(cleaned)


def pull_job():
    r = requests.get(
        f"{API_URL}?action=worker_pull",
        headers={"X-Worker-Token": WORKER_TOKEN},
        timeout=30,
    )
    r.raise_for_status()
    return (r.json() or {}).get("job")


def send_result(job_id: int, result=None, error: str = None):
    body = {"job_id": job_id}
    if error:
        body["error"] = error
    else:
        body["result"] = result
    r = requests.post(
        f"{API_URL}?action=worker_result",
        headers={"X-Worker-Token": WORKER_TOKEN, "Content-Type": "application/json"},
        data=json.dumps(body),
        timeout=60,
    )
    r.raise_for_status()


def main():
    log("Воркер запущен.")
    # Ждём, пока Ollama не поднимется — задачи не берём, чтобы не сжигать их в ошибки.
    while not ensure_ollama():
        log("Жду Ollama 10 сек и пробую снова...")
        time.sleep(10)
    warmup()
    log("Опрашиваю очередь...")
    while True:
        # если Ollama вдруг отвалилась — не берём задачи, ждём её
        if not ollama_alive():
            log("Ollama пропала. Жду восстановления (задачи не беру)...")
            ensure_ollama()
            time.sleep(POLL_INTERVAL)
            continue

        try:
            job = pull_job()
        except Exception as e:
            log(f"Ошибка опроса очереди: {e}")
            time.sleep(POLL_INTERVAL)
            continue

        if not job:
            time.sleep(POLL_INTERVAL)
            continue

        job_id = job["id"]
        log(f"Взял задачу #{job_id}. Распознаю...")
        try:
            result = recognize(job["image_url"])
            send_result(job_id, result=result)
            n = len(result.get("items", [])) if isinstance(result, dict) else 0
            log(f"Задача #{job_id} готова: позиций распознано — {n}.")
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            log(f"Ошибка на задаче #{job_id}: {msg}")
            try:
                send_result(job_id, error=msg)
            except Exception as e2:
                log(f"Не смог отправить ошибку по задаче #{job_id}: {e2}")


if __name__ == "__main__":
    if WORKER_TOKEN == "ВСТАВЬ_ТОКЕН_СЮДА":
        log("ВНИМАНИЕ: не задан RECEIPT_WORKER_TOKEN. Укажи токен в env или в коде.")
    main()