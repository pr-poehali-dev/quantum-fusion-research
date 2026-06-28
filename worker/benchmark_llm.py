"""
==============================================================
  СТРЕСС-ТЕСТ / БЕНЧМАРК LLM-МОДЕЛЕЙ ДЛЯ РАСПОЗНАВАНИЯ СЧЕТОВ
==============================================================

Гоняет одинаковый запрос по набору моделей в двух режимах
(всё на GPU / всё на CPU), несколько повторов, и печатает таблицу:
среднее время ответа и скорость (токенов/сек). Так видно, что
реально быстрее на ТВОЁМ железе — видеокарта или процессор.

ЗАПУСК:
    дважды кликни benchmark_llm.bat   (или: py benchmark_llm.py)

Ollama должна быть установлена и в PATH. Скрипт сам поднимет сервер,
если он не запущен. Модели, которых нет, будут пропущены (можно
заранее: ollama pull qwen2.5vl:3b-q4_K_M  и т.д.).
"""

import os
import sys
import time
import json
import shutil
import subprocess
import statistics

import urllib.request
import urllib.error

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# Какие модели проверяем (отсутствующие пропускаются автоматически)
MODELS = os.environ.get(
    "BENCH_MODELS",
    "qwen2.5vl:3b-q4_K_M,qwen2.5vl:3b,qwen2.5vl:7b-q4_K_M,qwen2.5vl:7b",
).split(",")

REPEATS = int(os.environ.get("BENCH_REPEATS", "3"))   # прогонов на режим (берём среднее)
NUM_CTX = int(os.environ.get("BENCH_NUM_CTX", "8192"))

# Текстовый промпт, имитирующий распознавание уже извлечённого из счёта текста.
# Длинный — чтобы нагрузка была близка к реальной (как твои ~12000 символов).
SAMPLE_TABLE = (
    "Поставщик: ООО ТехноОпт\n"
    "Покупатель: ООО ВЕКТОР\n"
    "№  Наименование                       Кол-во   Цена        Сумма\n"
)
for i in range(1, 41):
    SAMPLE_TABLE += (
        f"{i}  Видеокарта GeForce RTX модель-{i:02d} 8GB GDDR6   "
        f"{(i % 5) + 1}   {8699 + i * 100},00   {(8699 + i * 100) * ((i % 5) + 1)},00\n"
    )

PROMPT = (
    "Ты распознаёшь товарный счёт. Верни СТРОГО JSON: "
    '{"store":"<поставщик>","items":[{"name":"","article":"","qty":0,"price":0,"total":0}]}. '
    "Вот текст счёта:\n" + SAMPLE_TABLE
)


def http_get(path, timeout=10):
    req = urllib.request.Request(f"{OLLAMA_URL}{path}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def http_post(path, payload, timeout=600):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}{path}", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def ollama_alive():
    try:
        http_get("/api/tags", timeout=5)
        return True
    except Exception:
        return False


def ensure_ollama():
    if ollama_alive():
        return True
    exe = shutil.which("ollama")
    if not exe:
        print("ОШИБКА: команда 'ollama' не найдена в PATH. Установи Ollama.")
        return False
    print("Поднимаю ollama serve...")
    flags = 0x08000000 if os.name == "nt" else 0
    subprocess.Popen([exe, "serve"], creationflags=flags)
    for _ in range(60):
        if ollama_alive():
            return True
        time.sleep(1)
    print("ОШИБКА: Ollama не поднялась.")
    return False


def installed_models():
    try:
        data = http_get("/api/tags")
        return [m.get("name", "") for m in data.get("models", [])]
    except Exception:
        return []


def run_once(model, num_gpu):
    """Один прогон. num_gpu=999 — всё на GPU, num_gpu=0 — всё на CPU.
    Возвращает (секунды_всего, токенов_в_секунду) или (None, None) при ошибке."""
    payload = {
        "model": model,
        "prompt": PROMPT,
        "stream": False,
        "format": "json",
        "keep_alive": "5m",
        "options": {"num_ctx": NUM_CTX, "num_gpu": num_gpu, "temperature": 0},
    }
    t0 = time.time()
    try:
        resp = http_post("/api/generate", payload, timeout=900)
    except Exception as e:
        print(f"      ошибка прогона: {e}")
        return None, None
    dt = time.time() - t0
    # eval_count / eval_duration (нс) — скорость генерации от самой Ollama
    ec = resp.get("eval_count") or 0
    ed = resp.get("eval_duration") or 0
    tps = (ec / (ed / 1e9)) if ed else 0.0
    return dt, tps


def bench_model(model):
    print(f"\n=== Модель: {model} ===")
    results = {}
    for mode, num_gpu in (("GPU (всё на видеокарту)", 999), ("CPU (всё на процессор)", 0)):
        print(f"  Режим: {mode}")
        # прогрев (не считаем) — загрузка модели в нужное устройство
        print("    прогрев...")
        run_once(model, num_gpu)
        times, speeds = [], []
        for n in range(REPEATS):
            dt, tps = run_once(model, num_gpu)
            if dt is None:
                break
            times.append(dt)
            speeds.append(tps)
            print(f"    прогон {n + 1}/{REPEATS}: {dt:5.1f} c, {tps:5.1f} ток/с")
        if times:
            results[mode] = (statistics.mean(times), statistics.mean(speeds))
    return results


def main():
    print("=" * 60)
    print("  БЕНЧМАРК LLM ДЛЯ РАСПОЗНАВАНИЯ СЧЕТОВ")
    print(f"  Повторов на режим: {REPEATS}, контекст: {NUM_CTX}")
    print("=" * 60)

    if not ensure_ollama():
        sys.exit(1)

    have = installed_models()
    to_test = [m.strip() for m in MODELS if m.strip() and m.strip() in have]
    skipped = [m.strip() for m in MODELS if m.strip() and m.strip() not in have]
    if skipped:
        print(f"\nПропускаю (не скачаны): {', '.join(skipped)}")
        print("  Чтобы добавить:  ollama pull <модель>")
    if not to_test:
        print("\nНет ни одной доступной модели из списка. Скачай хотя бы одну.")
        sys.exit(1)

    all_results = {}
    for m in to_test:
        all_results[m] = bench_model(m)

    # Итоговая таблица
    print("\n" + "=" * 70)
    print("  ИТОГ (среднее время ответа / скорость):")
    print("=" * 70)
    header = f"{'Модель':<24}{'GPU время':>12}{'GPU ток/с':>11}{'CPU время':>12}{'CPU ток/с':>11}"
    print(header)
    print("-" * 70)
    for m, res in all_results.items():
        g = res.get("GPU (всё на видеокарту)")
        c = res.get("CPU (всё на процессор)")
        gt = f"{g[0]:6.1f} c" if g else "   —"
        gs = f"{g[1]:6.1f}" if g else "   —"
        ct = f"{c[0]:6.1f} c" if c else "   —"
        cs = f"{c[1]:6.1f}" if c else "   —"
        print(f"{m:<24}{gt:>12}{gs:>11}{ct:>12}{cs:>11}")
    print("-" * 70)
    print("Чем МЕНЬШЕ время и БОЛЬШЕ ток/с — тем лучше.")
    print("Сравни GPU и CPU по каждой модели: выбирай то, что быстрее у тебя.")
    print("=" * 70)


if __name__ == "__main__":
    main()
