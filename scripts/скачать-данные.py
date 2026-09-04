"""Скачивание всех данных проекта для переноса на локальную машину.

Забирает базу (дамп SQL) и все файлы хранилища (фото, отчёты, счета).

Запуск:
    python scripts/скачать-данные.py 36610808

Результат складывается в папку выгрузка/ рядом со скриптом:
    выгрузка/dump.sql   — вся база, восстанавливается одной командой
    выгрузка/files/     — файлы, разложенные по папкам как в хранилище

Восстановление на локальной машине:
    createdb myproject
    psql myproject -f выгрузка/dump.sql
"""

import json
import os
import sys
import time
import urllib.request

FUNC_URL = "https://functions.poehali.dev/91990b31-7e23-4f0e-aae1-4eb2364c11a6"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "выгрузка")

# Таблицы логов и метрик. По умолчанию скачиваем без их содержимого —
# это 48 тысяч строк истории цен и метрик, для работы проекта не нужны.
# Нужны целиком? Запустите с ключом --всё
SKIP_HEAVY = True


def запрос(url: str, ключ: str, попыток: int = 3) -> str:
    for n in range(попыток):
        try:
            req = urllib.request.Request(url, headers={"X-Admin-Key": ключ})
            return urllib.request.urlopen(req, timeout=300).read().decode()
        except Exception as e:
            if n == попыток - 1:
                raise
            time.sleep(2)
    return ""


def слишком_большой(e: Exception) -> bool:
    """Ответ не влез в лимит функции — надо дробить на части."""
    return "502" in str(e) or "504" in str(e)


def забрать_таблицу(имя: str, строк: int, флаг: str, ключ: str) -> list:
    """Скачать таблицу, при необходимости по частям."""
    try:
        return [запрос(f"{FUNC_URL}?action=db&table={имя}{флаг}", ключ, попыток=1)]
    except Exception as e:
        if not слишком_большой(e):
            raise

    for шаг in (1000, 250, 50, 10, 2):
        куски, ok = [], True
        try:
            for off in range(0, max(строк, 1), шаг):
                куски.append(запрос(
                    f"{FUNC_URL}?action=db&table={имя}&offset={off}&limit={шаг}{флаг}",
                    ключ, попыток=1))
        except Exception as e:
            if not слишком_большой(e):
                raise
            ok = False
        if ok:
            print(f"      (по частям, шаг {шаг})")
            return куски

    raise RuntimeError(f"таблица {имя}: не удалось выгрузить даже по 2 строки")


def скачать_базу(ключ: str, всё: bool) -> None:
    info = json.loads(запрос(f"{FUNC_URL}?action=info", ключ))
    таблицы = info["tables"]
    print(f"База: {info['db_size']}, таблиц {len(таблицы)}, строк {info['rows_total']}")

    куски = []
    for i, t in enumerate(таблицы, 1):
        имя = t["table"]
        строк = t["rows"]
        флаг = "&full=1" if всё else ""

        # Сначала пробуем забрать таблицу целиком. Если ответ не влезает в
        # лимит (502) — дробим на части и уменьшаем шаг, пока не пройдёт.
        # По числу строк заранее не угадать: в заказах строк мало, но в
        # каждой лежит целый состав сборки, и таблица тяжелее иных длинных.
        куски.extend(забрать_таблицу(имя, строк, флаг, ключ))

        print(f"  [{i}/{len(таблицы)}] {имя} ({строк})")

    путь = os.path.join(OUT_DIR, "dump.sql")
    with open(путь, "w", encoding="utf-8") as f:
        f.write("\n".join(куски))
    мб = os.path.getsize(путь) / 1024 / 1024
    print(f"База сохранена: {путь} ({мб:.1f} МБ)\n")


def скачать_файлы(ключ: str) -> None:
    d = json.loads(запрос(f"{FUNC_URL}?action=files", ключ))
    файлы = d["files"]
    print(f"Файлов: {d['count']}")
    for папка, кол in sorted(d["by_folder"].items()):
        print(f"  {папка or '(корень)'}: {кол}")

    корень = os.path.join(OUT_DIR, "files")
    ошибки = []
    for i, f in enumerate(файлы, 1):
        путь = os.path.join(корень, f["key"].replace("/", os.sep))
        os.makedirs(os.path.dirname(путь), exist_ok=True)
        if os.path.exists(путь):          # повторный запуск не качает заново
            continue
        try:
            with urllib.request.urlopen(f["url"], timeout=120) as r, \
                 open(путь, "wb") as out:
                out.write(r.read())
        except Exception as e:
            ошибки.append((f["key"], str(e)[:60]))
        if i % 100 == 0:
            print(f"  скачано {i}/{len(файлы)}")

    print(f"Файлы сохранены: {корень}")
    if ошибки:
        print(f"Не скачалось: {len(ошибки)}")
        for k, e in ошибки[:10]:
            print(f"  {k}: {e}")


def main() -> None:
    аргументы = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not аргументы:
        print("Укажите пароль администратора:\n"
              "  python scripts/скачать-данные.py ВАШ_ПАРОЛЬ\n"
              "  python scripts/скачать-данные.py ВАШ_ПАРОЛЬ --всё   (с логами)")
        sys.exit(1)

    ключ = аргументы[0]
    всё = "--всё" in sys.argv or "--all" in sys.argv
    os.makedirs(OUT_DIR, exist_ok=True)

    скачать_базу(ключ, всё)
    скачать_файлы(ключ)

    print("\nГотово. Как поднять базу локально:")
    print("  createdb myproject")
    print(f"  psql myproject -f {os.path.join(OUT_DIR, 'dump.sql')}")


if __name__ == "__main__":
    main()