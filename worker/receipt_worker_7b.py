"""
==============================================================
  ВОРКЕР РАСПОЗНАВАНИЯ СЧЁТОВ  —  модель qwen2.5vl:7b  (ТОЧНЫЙ)
==============================================================

Самодостаточный воркер: САМ поднимает сервер Ollama, следит за ним,
перезапускает если упал, и не даёт модели выгрузиться из видеопамяти.
Забирает задачи из облака, распознаёт счёт и отправляет результат обратно.

ЗАПУСК:
    python receipt_worker_7b.py

ПЕРЕД ЗАПУСКОМ:
    1) Установить Ollama:  https://ollama.com/download
    2) Скачать модель:     ollama pull qwen2.5vl:7b
    3) Установить зависимости:  pip install requests
    4) Прописать токен воркера в переменную окружения RECEIPT_WORKER_TOKEN
       (тот же, что в секрете проекта RECEIPT_WORKER_TOKEN),
       либо вписать его ниже в WORKER_TOKEN.

Запускать Ollama отдельно НЕ нужно — воркер сделает это сам и будет
держать сервер живым, пока открыто это окно.

Подходит для точного распознавания, требует ~8-10 ГБ VRAM.
ВАЖНО: не запускай 3b и 7b одновременно на одной карте, если не хватает
видеопамяти — иначе они будут выгружать друг друга.
"""

import os
import time
import json
import base64
import shutil
import signal
import threading
import subprocess
import requests

# ─────────────────── НАСТРОЙКИ ───────────────────
MODEL = "qwen2.5vl:7b"               # ← модель этого воркера (точная, 7B)
NUM_CTX = 8192                        # длина контекста
KEEP_ALIVE = -1                       # -1 = держать модель в VRAM вечно

API_URL = "https://functions.poehali.dev/de7a55a6-8858-43db-b39f-e5d791bc39b4"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# токен воркера: лучше задать через переменную окружения RECEIPT_WORKER_TOKEN
WORKER_TOKEN = os.environ.get("RECEIPT_WORKER_TOKEN", "ВСТАВЬ_ТОКЕН_СЮДА")

POLL_INTERVAL = 3                     # сек между опросами очереди, когда задач нет
REQUEST_TIMEOUT = 300                 # таймаут запроса к Ollama (распознавание долгое)
HEALTH_INTERVAL = 20                  # как часто сторож проверяет сервер (сек)
KEEPALIVE_INTERVAL = 60               # как часто пинговать модель, чтобы не выгрузилась (сек)
OLLAMA_LOG = "ollama_serve.log"       # куда писать вывод сервера Ollama

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

# Глобальное состояние сервера
_ollama_proc = None          # subprocess.Popen запущенного нами `ollama serve`
_ollama_log_fh = None        # файловый дескриптор лога сервера
_stop = threading.Event()    # сигнал остановки всех потоков
_proc_lock = threading.Lock()


def log(msg: str):
    print(f"[{time.strftime('%H:%M:%S')}] [{MODEL}] {msg}", flush=True)


def ollama_alive() -> bool:
    """Сервер Ollama отвечает по HTTP?"""
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def _spawn_ollama() -> bool:
    """Запустить `ollama serve` как наш дочерний процесс. keep_alive прокидываем
    и через переменную окружения OLLAMA_KEEP_ALIVE, чтобы модель не выгружалась."""
    global _ollama_proc, _ollama_log_fh

    exe = shutil.which("ollama")
    if not exe:
        log("Команда 'ollama' не найдена в PATH. Установи Ollama: https://ollama.com/download")
        return False

    env = os.environ.copy()
    env["OLLAMA_KEEP_ALIVE"] = "-1"   # глобально держать модели в памяти

    try:
        _ollama_log_fh = open(OLLAMA_LOG, "a", encoding="utf-8")
        flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW (Windows)
        _ollama_proc = subprocess.Popen(
            [exe, "serve"],
            stdout=_ollama_log_fh, stderr=_ollama_log_fh,
            env=env, creationflags=flags,
        )
        log(f"Запустил `ollama serve` (PID {_ollama_proc.pid}). Лог сервера → {OLLAMA_LOG}")
        return True
    except Exception as e:
        log(f"Не смог запустить ollama serve: {e}")
        return False


def ensure_ollama(wait_sec: int = 60) -> bool:
    """Гарантируем работающий сервер Ollama. Если не отвечает — поднимаем сами.
    Ждём готовности до wait_sec секунд."""
    global _ollama_proc

    if ollama_alive():
        return True

    with _proc_lock:
        # наш процесс умер? подчистим
        if _ollama_proc is not None and _ollama_proc.poll() is not None:
            log(f"Процесс ollama serve завершился (код {_ollama_proc.returncode}). Перезапускаю...")
            _ollama_proc = None

        # сервер мог быть запущен снаружи (приложение Ollama в трее) — тогда не плодим второй
        if not ollama_alive() and _ollama_proc is None:
            _spawn_ollama()

    for _ in range(wait_sec):
        if ollama_alive():
            log("Ollama на связи.")
            return True
        if _stop.is_set():
            return False
        time.sleep(1)

    log("ВНИМАНИЕ: Ollama не поднялась. Проверь установку и лог ollama_serve.log.")
    return False


def warmup():
    """Загружаем модель в VRAM сразу при старте, чтобы первая задача шла быстро."""
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


def _watchdog():
    """Фоновый сторож: следит, что сервер жив и модель не выгрузилась.
    Если сервер упал — поднимает заново и прогревает модель."""
    last_keepalive = 0.0
    while not _stop.is_set():
        if not ollama_alive():
            log("Сторож: Ollama не отвечает — поднимаю заново.")
            if ensure_ollama():
                warmup()
                last_keepalive = time.time()
        else:
            # периодический keepalive-пинг, чтобы модель оставалась в VRAM
            if time.time() - last_keepalive >= KEEPALIVE_INTERVAL:
                try:
                    requests.post(
                        f"{OLLAMA_URL}/api/generate",
                        json={"model": MODEL, "prompt": "", "stream": False,
                              "keep_alive": KEEP_ALIVE, "options": {"num_ctx": NUM_CTX}},
                        timeout=30,
                    )
                except Exception:
                    pass
                last_keepalive = time.time()
        _stop.wait(HEALTH_INTERVAL)


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


def shutdown(*_):
    """Корректная остановка: гасим сторожа и наш дочерний ollama serve."""
    if _stop.is_set():
        return
    log("Останавливаюсь...")
    _stop.set()
    with _proc_lock:
        if _ollama_proc is not None and _ollama_proc.poll() is None:
            try:
                _ollama_proc.terminate()
                _ollama_proc.wait(timeout=10)
            except Exception:
                try:
                    _ollama_proc.kill()
                except Exception:
                    pass
            log("Сервер Ollama остановлен.")
    if _ollama_log_fh:
        try:
            _ollama_log_fh.close()
        except Exception:
            pass


def main():
    log("Воркер запущен.")
    # 1) Поднимаем сервер Ollama (или используем уже запущенный) и ждём готовности.
    while not ensure_ollama():
        if _stop.is_set():
            return
        log("Жду 10 сек и пробую снова поднять Ollama...")
        time.sleep(10)

    # 2) Прогреваем модель и запускаем фонового сторожа.
    warmup()
    threading.Thread(target=_watchdog, daemon=True).start()
    log("Сторож сервера активен. Опрашиваю очередь...")

    # 3) Основной цикл: берём задачи и распознаём.
    while not _stop.is_set():
        if not ollama_alive():
            # сторож сейчас поднимает сервер — просто ждём, задачи не берём
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


def check_token() -> bool:
    """Токен должен быть задан и состоять только из ASCII (заголовки HTTP не умеют в кириллицу)."""
    t = (WORKER_TOKEN or "").strip()
    if not t or t == "ВСТАВЬ_ТОКЕН_СЮДА":
        log("ОШИБКА: не задан токен воркера.")
        log("  Открой start_worker_7b.bat в Блокноте и впиши токен в строку:")
        log('  set "RECEIPT_WORKER_TOKEN=<твой_токен>"')
        log("  Токен берётся из секрета проекта RECEIPT_WORKER_TOKEN.")
        return False
    try:
        t.encode("ascii")
    except UnicodeEncodeError:
        log("ОШИБКА: в токене есть русские буквы/спецсимволы — так нельзя.")
        log("  Скопируй токен заново (только латиница/цифры) в .bat.")
        return False
    return True


if __name__ == "__main__":
    if not check_token():
        log("Воркер не запущен. Исправь токен и запусти снова.")
        time.sleep(15)
        raise SystemExit(1)
    signal.signal(signal.SIGINT, shutdown)
    try:
        signal.signal(signal.SIGTERM, shutdown)
    except Exception:
        pass
    try:
        main()
    finally:
        shutdown()