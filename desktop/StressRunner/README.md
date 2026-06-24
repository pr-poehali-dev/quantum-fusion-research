# StressRunner — приложение для стресс-тестов (Windows .exe)

Запускает по списку внешние программы и скрипты, каждый на заданное время,
сохраняет результат (код завершения + длительность + файлы-отчёты) в локальную
базу на ПК и отправляет на сайт в раздел админки **Стресс-тесты**.

## Что нужно установить (один раз)

1. **.NET SDK 8.0** — https://dotnet.microsoft.com/download/dotnet/8.0
   (скачай «SDK x64» для Windows, установи).

## Сборка в .exe

Открой папку `desktop/StressRunner` в командной строке и выполни:

```bat
dotnet restore
dotnet publish -c Release -r win-x64 --self-contained false -o publish
```

Готовый `StressRunner.exe` будет в папке `publish`.

> Хочешь, чтобы exe работал на ПК **без установленного .NET** — собери так:
> ```bat
> dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o publish
> ```
> Получится один большой самодостаточный файл.

## Настройка (рядом с exe появятся файлы при первом запуске)

### settings.json
```json
{
  "ingest_url": "https://functions.poehali.dev/ffa7efcd-7a92-4a76-a463-abec515d846c",
  "token": "СЮДА_ТОКЕН_STRESS_INGEST_TOKEN",
  "machine_name": "Стенд-1",
  "upload_files": true,
  "max_file_mb": 8
}
```
- `token` — то же значение, что задано в секрете **STRESS_INGEST_TOKEN** на сайте.
- `machine_name` — как этот ПК будет подписан в админке.

### profiles.json — список профилей и тестов
```json
[
  {
    "name": "Полная проверка сборки",
    "note": "OCCT + FurMark + диск",
    "tests": [
      {
        "name": "CPU — OCCT",
        "program": "C:\\OCCT\\OCCT.exe",
        "args": "/cpu /duration 600",
        "duration_sec": 600,
        "timeout_is_success": true,
        "success_exit_code": 0,
        "report_files": ["C:\\OCCT\\reports\\*.csv", "C:\\OCCT\\*.png"]
      },
      {
        "name": "Свой скрипт диагностики",
        "program": "C:\\stress\\check.bat",
        "args": "",
        "duration_sec": 120,
        "timeout_is_success": true,
        "report_files": ["C:\\stress\\out\\*.log"]
      }
    ]
  }
]
```

Поля теста:
| Поле | Что значит |
|------|------------|
| `program` | путь к .exe / .bat / .cmd / .ps1 |
| `args` | аргументы командной строки |
| `working_dir` | рабочая папка (необязательно) |
| `duration_sec` | сколько секунд держать тест; потом процесс гасится |
| `timeout_is_success` | true — остановка по времени считается успехом (для OCCT/Prime95) |
| `success_exit_code` | какой код = успех, если тест завершился сам (0 по умолчанию, -1 = любой) |
| `report_files` | какие файлы-отчёты забрать и отправить (можно маски `*.log`) |

## Запуск

- Двойной клик по `StressRunner.exe` → меню: выбираешь профиль, он гоняет тесты.
- Или из командной строки сразу профиль:
  ```bat
  StressRunner.exe run "Полная проверка сборки"
  ```
- Пункт меню **d** — дослать на сайт прогоны, которые не ушли (например не было интернета).

## Где результаты

- Локально: файл `stressrunner.db` рядом с exe (SQLite, можно открыть DB Browser for SQLite).
- На сайте: **Админка → Стресс-тесты** — список прогонов, по каждому тесту код
  завершения, время и скачиваемые файлы-отчёты.
