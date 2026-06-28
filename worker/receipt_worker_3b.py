"""
==============================================================
  ВОРКЕР РАСПОЗНАВАНИЯ СЧЁТОВ  —  модель qwen2.5vl:3b  (БЫСТРЫЙ)
==============================================================

Самодостаточный воркер: САМ поднимает сервер Ollama, следит за ним,
перезапускает если упал, и не даёт модели выгрузиться из видеопамяти.
Забирает задачи из облака, распознаёт счёт и отправляет результат обратно.

ЗАПУСК:
    python receipt_worker_3b.py

ПЕРЕД ЗАПУСКОМ:
    1) Установить Ollama:  https://ollama.com/download
    2) Скачать модель:     ollama pull qwen2.5vl:3b
    3) Установить зависимости:  pip install requests
    4) Прописать токен воркера в переменную окружения RECEIPT_WORKER_TOKEN
       (тот же, что в секрете проекта RECEIPT_WORKER_TOKEN),
       либо вписать его ниже в WORKER_TOKEN.

Запускать Ollama отдельно НЕ нужно — воркер сделает это сам и будет
держать сервер живым, пока открыто это окно.

Легче и быстрее 7B, требует ~4-5 ГБ VRAM. Точность чуть ниже —
удобно для слабых видеокарт или когда нужна скорость.
ВАЖНО: не запускай 3b и 7b одновременно на одной карте, если не хватает
видеопамяти — иначе они будут выгружать друг друга.
"""

import os
import re
import time
import json
import base64
import shutil
import signal
import threading
import subprocess
import requests

# ─────────────────── НАСТРОЙКИ ───────────────────
MODEL = "qwen2.5vl:3b"               # ← модель этого воркера (быстрая, 3B)
NUM_CTX = 8192                      # длина контекста. 8k с запасом хватает на счёт; больше — лишний жор VRAM, из-за которого слои сваливаются на CPU
KEEP_ALIVE = -1                       # -1 = держать модель в VRAM вечно
NUM_GPU = 999                         # ВСЕ слои на видеокарту (Ollama положит максимум). Раньше 36 + большой контекст могли не влезть → часть на CPU (тормоз)
NUM_THREAD = 2                       # потоков CPU отдаём Ollama (у нас слабый 2-ядерный проц — больше не нужно)

API_URL = "https://functions.poehali.dev/de7a55a6-8858-43db-b39f-e5d791bc39b4"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# токен воркера: лучше задать через переменную окружения RECEIPT_WORKER_TOKEN.
# Чистим от случайных кавычек/пробелов, которые часто прилипают при вставке в .bat.
WORKER_TOKEN = (os.environ.get("RECEIPT_WORKER_TOKEN", "ВСТАВЬ_ТОКЕН_СЮДА") or "").strip().strip('"').strip("'").strip()

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
    '"qty": <число>, "price": <цена за единицу числом>, "total": <сумма по строке числом>}]}. '
    "store — это ПОСТАВЩИК (продавец), он указан в строке «Поставщик:» или в "
    "реквизитах получателя платежа. НЕ путай с покупателем! "
    "Строку «Покупатель: ... ВЕКТОР» игнорируй — это получатель товара (мы), а не магазин. "
    "Если поставщик не указан явно — верни store: null. "
    "В таблице обычно колонки: Наименование, Цена, Кол-во, Сумма. "
    "ВАЖНО про формат чисел: в счёте русский формат — пробел/неразрывный пробел "
    "разделяет тысячи, запятая отделяет копейки. Пример: «8 699,00» = 8699.00, "
    "«14 669,00» = 14669.00, «1 234 567,89» = 1234567.89. В JSON выводи числа "
    "БЕЗ пробелов, с точкой как десятичным разделителем (8699.00). "
    "qty бери СТРОГО из колонки «Кол-во» (целое число: 1, 2, 4, 6 и т.д.). "
    "price бери из колонки «Цена» (цена за 1 штуку), НЕ из «Сумма». "
    "total бери из колонки «Сумма» (это price × qty). "
    "Самопроверка: price × qty должно равняться total. Если не сходится — "
    "перечитай числа внимательнее, не путай колонки Цена и Сумма. "
    "Не придумывай позиции, бери только то, что видно на счёте. "
    "Если поле не читается — поставь null."
)
# ──────────────────────────────────────────────────

# Глобальное состояние сервера
_ollama_proc = None          # subprocess.Popen запущенного нами `ollama serve`
_ollama_log_fh = None        # файловый дескриптор лога сервера
_stop = threading.Event()    # сигнал остановки всех потоков
_proc_lock = threading.Lock()


def gpu_options(extra: dict = None) -> dict:
    """Опции Ollama с принудительной выгрузкой ВСЕХ слоёв на GPU.
    num_gpu=999 — все слои на видеокарту, num_thread=2 — ограничиваем нагрузку
    на слабый CPU. Так нейросеть считает видеокарта, а не двухядерный проц."""
    opts = {"num_ctx": NUM_CTX, "num_gpu": NUM_GPU, "num_thread": NUM_THREAD}
    if extra:
        opts.update(extra)
    return opts


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


def installed_models() -> list:
    """Список моделей, которые реально видит этот сервер Ollama."""
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=10)
        r.raise_for_status()
        return [m.get("name", "") for m in (r.json() or {}).get("models", [])]
    except Exception:
        return []


def ensure_model() -> bool:
    """Проверяем, что нужная модель есть в этом сервере Ollama. Если нет — качаем."""
    models = installed_models()
    if MODEL in models:
        return True

    log(f"Модель {MODEL} не найдена в этом сервере Ollama. Доступны: {models or 'нет'}")
    exe = shutil.which("ollama")
    if not exe:
        log("Не могу скачать: команда 'ollama' не найдена в PATH.")
        return False

    log(f"Качаю модель {MODEL} (`ollama pull`)... Это может занять несколько минут.")
    try:
        # pull через CLI; он сам докачивает в каталог, который видит сервер
        subprocess.run([exe, "pull", MODEL], check=True)
    except Exception as e:
        log(f"Не удалось скачать модель: {e}")
        return False

    if MODEL in installed_models():
        log(f"Модель {MODEL} скачана.")
        return True
    log(f"Модель {MODEL} всё ещё не видна серверу. Проверь: ollama list")
    return False


def warmup():
    """Загружаем модель в VRAM сразу при старте, чтобы первая задача шла быстро."""
    if not ensure_model():
        return False
    log("Прогрев модели (загрузка в видеопамять)...")
    try:
        r = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": MODEL, "prompt": "ok", "stream": False,
                  "keep_alive": KEEP_ALIVE, "options": gpu_options()},
            timeout=REQUEST_TIMEOUT,
        )
        r.raise_for_status()
        log("Модель загружена и закреплена в VRAM (keep_alive=-1).")
        return True
    except Exception as e:
        log(f"Не удалось прогреть модель: {e}")
        return False


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
                              "keep_alive": KEEP_ALIVE, "options": gpu_options()},
                        timeout=30,
                    )
                except Exception:
                    pass
                last_keepalive = time.time()
        _stop.wait(HEALTH_INTERVAL)


def fetch_bytes(url: str) -> bytes:
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    return r.content


def _parse_json_response(text: str) -> dict:
    text = (text or "").strip()
    try:
        return json.loads(text)
    except Exception:
        cleaned = text.lstrip("`").replace("json", "", 1).strip().rstrip("`").strip()
        return json.loads(cleaned)


def friendly_error(e: Exception) -> str:
    """Переводим техническую ошибку в понятную админу формулировку.
    Возвращаем текст, который уходит и в лог, и в облако как причина провала задачи."""
    name = type(e).__name__
    raw = str(e)
    low = raw.lower()

    # 1) Ошибки локальной модели Ollama
    if "model runner has unexpectedly stopped" in low or "resource limitation" in low:
        return "Ошибка локальной ИИ, перезапустите сервер"
    if "not found" in low and ("model" in low or "ollama" in low):
        return "Модель не установлена. Скачайте: ollama pull qwen2.5vl:3b"
    if "ollama 400" in low or "ollama 422" in low:
        return "Файл повреждён или не читается. Пришлите счёт заново"
    if "ollama 5" in low:  # 500/502/503 и т.п.
        return "Ошибка локальной ИИ, перезапустите сервер"
    if low.startswith("ollama ") or "ollama" in low:
        return "Ошибка локальной ИИ, перезапустите сервер"

    # 2) Ошибки разбора файлов
    if "openpyxl" in low:
        return "Не настроен разбор Excel. Перезапустите .bat — он доустановит библиотеки"
    if "excel пустой" in low:
        return "Excel-файл пустой или повреждён"
    if "pdf-скан" in low or "poppler" in low or "pdf2image" in low:
        return "Для PDF-сканов нужен poppler (см. инструкцию). Текстовые PDF и Excel работают без него"
    if "отрендерить pdf" in low:
        return "PDF повреждён или пустой"

    # 3) Системные ошибки (сеть, JSON, скачивание)
    if name in ("JSONDecodeError",) or "expecting value" in low:
        return "Модель не смогла разобрать счёт. Попробуйте другое фото или более чёткий файл"
    if name in ("ConnectionError", "Timeout", "ReadTimeout", "ConnectTimeout"):
        return "Нет связи с локальной ИИ. Проверьте, что сервер Ollama запущен"
    if name == "HTTPError" or "failed to establish" in low:
        return "Не удалось скачать файл счёта из хранилища"

    # Если не распознали — отдаём исходный текст (чтобы не потерять причину)
    return f"{name}: {raw}"


def _ollama_generate(payload: dict) -> dict:
    """Запрос в Ollama. При ошибке вытаскиваем тело ответа — там обычно понятная причина."""
    r = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=REQUEST_TIMEOUT)
    if r.status_code >= 400:
        detail = ""
        try:
            detail = (r.json() or {}).get("error", "")
        except Exception:
            detail = (r.text or "")[:500]
        raise RuntimeError(f"Ollama {r.status_code}: {detail or 'без подробностей'}")
    return _parse_json_response((r.json() or {}).get("response", ""))


def recognize_image(img_bytes: bytes) -> dict:
    """Распознаём счёт-картинку через визуальную модель Ollama."""
    img_b64 = base64.b64encode(img_bytes).decode("ascii")
    return _ollama_generate({
        "model": MODEL,
        "prompt": PROMPT,
        "images": [img_b64],
        "stream": False,
        "format": "json",
        "keep_alive": KEEP_ALIVE,
        "options": gpu_options({"temperature": 0}),
    })


def recognize_text(table_text: str) -> dict:
    """Разбираем УЖЕ извлечённый текст счёта (из Excel/PDF) через модель — без картинки."""
    prompt = (
        PROMPT
        + "\n\nНиже текст/таблица счёта, извлечённые из файла. "
        + "Разбери их и верни JSON в указанном формате:\n\n"
        + table_text[:120000]
    )
    return _ollama_generate({
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "keep_alive": KEEP_ALIVE,
        "options": gpu_options({"temperature": 0}),
    })


def excel_to_text(data: bytes) -> str:
    """Читаем Excel как таблицу: каждая строка -> ячейки через | (без распознавания)."""
    try:
        import openpyxl
    except ImportError:
        raise RuntimeError("Нет библиотеки openpyxl. Установи: pip install openpyxl")
    import io
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    lines = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            cells = ["" if c is None else str(c) for c in row]
            if any(c.strip() for c in cells):
                lines.append(" | ".join(cells))
    return "\n".join(lines)


def _page_has_items(text: str) -> bool:
    """Похоже ли, что на странице таблица товаров (а не юр.вода/реквизиты/оферта)?
    Ищем заголовок таблицы ИЛИ строку с наименованием+количеством+ценой."""
    low = text.lower()
    header_hits = sum(k in low for k in ("наименование", "кол-во", "количество", "цена", "сумма", "товар"))
    junk = any(k in low for k in (
        "образец заполнения", "платёжного поручения", "платежного поручения",
        "в отсутствии между сторонами", "акцептом", "директор филиал",
    ))
    if junk and header_hits < 3:
        return False
    return header_hits >= 2


def pdf_extract_text(data: bytes) -> str:
    """Вытаскиваем текст из PDF. Для многостраничных счетов (ДНС и т.п.) оставляем
    только страницы с товарной таблицей — иначе модель тонет в юр.воде."""
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader  # запасной вариант
        except ImportError:
            return ""
    import io
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [(p.extract_text() or "") for p in reader.pages]
    except Exception:
        return ""

    total = len(pages)
    kept = [t for t in pages if _page_has_items(t)]
    if kept:
        log(f"PDF: страниц {total}, оставил с товарной таблицей — {len(kept)} "
            f"(отброшено юр.воды — {total - len(kept)}).")
        result = "\n".join(kept).strip()
    else:
        log(f"PDF: страниц {total}, товарную таблицу по маркерам не нашёл — беру весь текст.")
        result = "\n".join(pages).strip()
    log(f"PDF: извлечено символов текста — {len(result)}.")
    return result


def pdf_to_image_bytes(data: bytes) -> bytes:
    """PDF-скан -> картинка первой страницы (нужен pdf2image + poppler)."""
    try:
        from pdf2image import convert_from_bytes
    except ImportError:
        raise RuntimeError(
            "PDF-скан: нужна библиотека pdf2image и poppler. "
            "Установи: pip install pdf2image, и распакуй poppler (добавь в PATH)."
        )
    import io
    images = convert_from_bytes(data, dpi=200, first_page=1, last_page=1)
    if not images:
        raise RuntimeError("Не удалось отрендерить PDF в картинку.")
    buf = io.BytesIO()
    images[0].save(buf, format="PNG")
    return buf.getvalue()


def detect_kind(url_low: str, data: bytes) -> str:
    """Определяем тип файла: 'excel' | 'pdf' | 'image'.
    Сначала по содержимому (надёжно, т.к. файлы в S3 часто без расширения),
    потом по расширению из URL как запасной вариант."""
    head = data[:8]
    # PDF: начинается с %PDF
    if head[:4] == b"%PDF":
        return "pdf"
    # XLSX/XLSM — это zip-архив (PK..), а внутри есть xl/ — но для скорости берём по zip+расширению
    if head[:2] == b"PK":
        # .xlsx (zip). .xls (старый) — сигнатура D0 CF 11 E0 (OLE)
        return "excel"
    if head[:4] == b"\xd0\xcf\x11\xe0":  # старый .xls (OLE2)
        return "excel"
    # Картинки: JPEG (FF D8), PNG (89 50), GIF, BMP, WEBP(RIFF)
    if head[:2] == b"\xff\xd8" or head[:8] == b"\x89PNG\r\n\x1a\n" \
            or head[:3] == b"GIF" or head[:2] == b"BM" or head[:4] == b"RIFF":
        return "image"
    # запасной вариант — по расширению
    if url_low.endswith((".xlsx", ".xls", ".xlsm")):
        return "excel"
    if url_low.endswith(".pdf"):
        return "pdf"
    return "image"


def _to_number(v):
    """Приводим число к float, понимая русский формат: «8 699,00» -> 8699.00.
    Возвращаем None, если распознать не удалось."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    s = re.sub(r"[^\d,.\s\u00a0]", "", s)
    s = s.replace("\u00a0", "").replace(" ", "")  # тысячные пробелы
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _postprocess(result: dict) -> dict:
    """Нормализуем числа и чиним цену через сумму: price = total / qty.
    Это спасает от путаницы колонок Цена/Сумма и кривого формата чисел."""
    if not isinstance(result, dict):
        return result
    items = result.get("items")
    if not isinstance(items, list):
        return result

    for it in items:
        if not isinstance(it, dict):
            continue
        qty = _to_number(it.get("qty"))
        price = _to_number(it.get("price"))
        total = _to_number(it.get("total"))

        qty_int = int(round(qty)) if qty and qty > 0 else 1

        if total and total > 0 and qty_int > 0:
            calc_price = round(total / qty_int, 2)
            if not price or abs(price * qty_int - total) > max(1.0, total * 0.01):
                if abs(calc_price - (price or 0)) > 0.01:
                    log(f"  поправил цену по сумме: '{it.get('name','')[:40]}' "
                        f"{price} -> {calc_price} (сумма {total} / кол-во {qty_int})")
                price = calc_price

        it["qty"] = qty_int
        if price is not None:
            it["price"] = price
        it.pop("total", None)

    return result


def recognize(image_url: str) -> dict:
    """Главная точка: определяем тип файла и выбираем способ разбора."""
    url_low = image_url.lower().split("?")[0]
    data = fetch_bytes(image_url)
    kind = detect_kind(url_low, data)
    log(f"Тип файла: {kind} ({len(data)} байт)")

    # Excel — читаем таблицу напрямую, потом разбираем текст моделью
    if kind == "excel":
        log("Файл Excel — читаю таблицу...")
        table = excel_to_text(data)
        if not table.strip():
            raise RuntimeError("Excel пустой или не читается.")
        return _postprocess(recognize_text(table))

    # PDF — сперва пробуем текст, если пусто (скан) — рендерим в картинку
    if kind == "pdf":
        log("Файл PDF — пробую извлечь текст...")
        text = pdf_extract_text(data)
        if len(text) >= 30:
            return _postprocess(recognize_text(text))
        log("Текста в PDF мало (похоже скан) — рендерю в картинку для модели...")
        return _postprocess(recognize_image(pdf_to_image_bytes(data)))

    # Иначе считаем, что это картинка
    return _postprocess(recognize_image(data))


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

    # 2) Проверяем/качаем модель и прогреваем. Без модели работать нет смысла.
    while not warmup():
        if _stop.is_set():
            return
        log("Модель недоступна. Жду 15 сек и пробую снова (проверь: ollama list)...")
        time.sleep(15)
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
            msg = friendly_error(e)
            # В лог пишем и понятный текст, и технический оригинал — для разбора.
            log(f"Ошибка на задаче #{job_id}: {msg}  [тех: {type(e).__name__}: {e}]")
            try:
                send_result(job_id, error=msg)
            except Exception as e2:
                log(f"Не смог отправить ошибку по задаче #{job_id}: {e2}")


def check_token() -> bool:
    """Токен должен быть задан и состоять только из ASCII (заголовки HTTP не умеют в кириллицу)."""
    t = (WORKER_TOKEN or "").strip()
    if not t or t == "ВСТАВЬ_ТОКЕН_СЮДА":
        log("ОШИБКА: не задан токен воркера.")
        log("  Открой start_worker_3b.bat в Блокноте и впиши токен в строку:")
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