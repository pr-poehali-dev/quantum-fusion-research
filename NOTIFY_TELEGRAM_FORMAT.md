# StressRunner → Telegram: формат уведомлений

Документ для разработки **backend/stress** (`action=notify`).  
StressRunner (EXE) шлёт JSON POST; сайт собирает HTML-текст и вызывает `tg_notify.notify_stress()`.

**Реализация на сайте:** `backend/stress/index.py` → `notify()`, `_format_notify_core()`, `_notify_headline()`.  
**Реализация в EXE:** `desktop/StressRunner/StressNotifyPayload.cs`, `StressNotifyHeadline.cs`.

---

## API

| Параметр | Значение |
|----------|----------|
| URL | `{ingest_url}?action=notify` (тот же base URL, что и ingest) |
| Метод | `POST` |
| Auth | Заголовок `Authorization: Bearer {STRESS_INGEST_TOKEN}` |
| Content-Type | `application/json` |
| Ответ | `{ "ok": true, "telegram_sent": true/false, ... }` |

Telegram: `parse_mode=HTML`, все пользовательские строки **экранировать** (`html.escape` / `_esc()`).

---

## Структура сообщения (визуально)

```
{headline}                    ← первая строка, жирным (<b>)

🖥 Стенд: {stand_name}
📦 Заказ: {order_number}      ← только если поле не пустое
📋 Профиль: {profile_name}

Тесты:
{emoji} {test.name} — {detail?}
...

📝 {note}                     ← примечание профиля, если есть

{блоки события: итог, GPU, ошибка, heartbeat…}

🔗 {SITE_BASE_URL}/admin/stress
```

**Правило:** заголовок (`headline`) формирует **EXE** и кладёт в JSON. Сайт выводит его как есть (с escape), с **fallback** если поля нет (старые клиенты).

---

## Общие поля payload

| Поле | Тип | Описание |
|------|-----|----------|
| `event` | string | Тип события (см. ниже) |
| `headline` | string | Первая строка Telegram (с эмодзи) |
| `stand_name` | string | Имя стенда / ПК из `settings.machine_name` |
| `machine` | string | Дубль `stand_name` (legacy) |
| `order_number` | string \| null | Номер заказа (тестовый стенд) |
| `profile_name` | string | Имя профиля **без** префикса «Заказ …» |
| `profile` | string | Дубль `profile_name` (legacy) |
| `note` | string \| null | Примечание профиля |
| `tests` | array | Список тестов профиля (см. ниже) |

### Элемент `tests[]`

```json
{
  "name": "FurMark — 10 мин",
  "status": "ok",
  "detail": "133394 MIPS"
}
```

| `status` | Смайл в TG | Смысл |
|----------|------------|--------|
| `ok` | ✅ | тест успешно завершён |
| `error` | 💥 | ошибка теста (код выхода, fail бенчмарка и т.д.) |
| `crash` | 💥 | краш / перезагрузка ПК / сбой системы |
| `warning` | ⚠️ | предупреждение (резерв; hotspot на уровне теста) |
| `skipped` | ⏭ | не выполнен после сбоя |
| `pending` | ⏳ | ещё не запускался |
| `running` | ▶️ | выполняется (резерв) |
| `problem` | 💥 | legacy-алиас для `error` |

`detail` — опционально: score бенчмарка, «код 1», «возобновлён после перезагрузки», усечённый `score_text`.

---

## События (`event`)

### 1. `test_stand_started`

Старт прогона на тестовом стенде (заказ введён).

**Доп. поля:** `gpu` (строка, модель видеокарты).

**`tests`:** все тесты профиля со статусом `pending`.

**headline (EXE):**
```
▶️ Старт прогона
```

**Пример payload:**
```json
{
  "event": "test_stand_started",
  "headline": "▶️ Старт прогона",
  "stand_name": "Стенд-1",
  "machine": "Стенд-1",
  "order_number": "12345",
  "profile_name": "прогон 50 минут основной",
  "profile": "прогон 50 минут основной",
  "note": "Стандартный прогон",
  "gpu": "NVIDIA GeForce RTX 5090",
  "tests": [
    { "name": "OCCT CPU", "status": "pending" },
    { "name": "FurMark — 10 мин", "status": "pending" }
  ]
}
```

**Хвост сообщения:** `🎮 GPU: …` (если `gpu` задан).

---

### 2. `test_failed`

Один тест упал **во время** прогона (мгновенное уведомление).

**Доп. поля:**

| Поле | Описание |
|------|----------|
| `test_name` | Имя упавшего теста |
| `exit_code` | int \| null |
| `duration_sec` | float \| null |
| `error_detail` | string \| null — фрагмент score/лога |

**headline (EXE):**
```
💥 Упал тест [3/6]: FurMark — 10 мин
💥 Упал тест: MemTest Vulkan
```

**Хвост:** блок `❌ {test_name}` + `error_detail`.

---

### 3. `gpu_maintenance_required`

После прогона: температуры GPU вне нормы (тесты могли пройти).

**Доп. поля:**

| Поле | Описание |
|------|----------|
| `issues` | string[] — человекочитаемые сообщения |
| `gpu_issue_codes` | string[] — машинные коды |

**Коды GPU (`gpu_issue_codes`):**

| Код | headline |
|-----|----------|
| `gpu_hotspot_delta_high` | ⚠️ Высокий Hot Spot — требуется обслуживание GPU |
| `gpu_mem_temp_high` | ⚠️ Перегрев памяти GPU — требуется обслуживание |
| *(другое)* | ⚠️ Проблема с температурой GPU |

Пороги (EXE): память NVIDIA > 90 °C; Δ(Hot Spot − Core) > 17 °C.

**Хвост:** список `issues` буллетами.

---

### 4. `run_finished`

Прогон завершён, отчёт **успешно** загружен через ingest.

**Доп. поля:**

| Поле | Описание |
|------|----------|
| `passed` | int — успешных тестов |
| `total` | int — запланировано |
| `gpu_maintenance` | bool |
| `gpu_issues` | string[] |
| `gpu_issue_codes` | string[] |

**headline (EXE) — все варианты:**

```
✅ Прогон завершён — всё в порядке

💥 Упал тест: FurMark — 10 мин
💥 Сбой на тесте: OCCT CPU
💥 Ошибки в 2 тестах: FurMark, MemTest
💥 Ошибки в 4 тестах: FurMark, MemTest, Cinebench (+1)

⚠️ Высокий Hot Spot — требуется обслуживание GPU
⚠️ Перегрев памяти GPU — требуется обслуживание
⚠️ Проблема с температурой GPU

💥 Упал тест FurMark · ⚠️ высокий Hot Spot
💥 Ошибки в 2 тестах · ⚠️ перегрев памяти GPU
💥 Ошибки в 3 тестах · ⚠️ проблема GPU

⚠️ Прогон отменён пользователем
```

**Хвост:**
- `📊 Итог: {passed}/{total} успешно[, ошибок: N]`
- если `gpu_maintenance`: блок `🌡 GPU — обслуживание:` + `gpu_issues`

**Не шлётся** если `run.status == "crashed"` (см. `run_interrupted`).

---

### 5. `upload_failed`

Прогон локально сохранён, на сайт **не** отправился.

**Доп. поля:** `passed`, `total`.

**headline (EXE):**
```
⚠️ Отчёт не загружен на сайт
⚠️ Отчёт не загружен · 💥 были ошибки в тестах
⚠️ Отчёт не загружен · ⚠️ проблема GPU
⚠️ Отчёт не загружен · 💥 ошибки в тестах · ⚠️ проблема GPU
```

**Хвост:** `📊 Прогон: …` + «Данные сохранены локально на ПК.»

---

### 6. `run_interrupted`

Перезагрузка ПК во время прогона (партнёрский auto-report).

**Доп. поля:**

| Поле | Описание |
|------|----------|
| `interrupted_test` | string — тест, на котором прервалось |
| `passed`, `completed`, `planned_total` | int |
| `company` | string \| null |
| `run_uid` | string |

**headline (EXE):**
```
💥 Перезагрузка ПК — прерван: FurMark — 10 мин
```

**`tests`:** выполненные + `crash` на прерванном + `skipped` на остальных.

**Хвост:** `⚡ Прервано на: {interrupted_test}`.

После notify EXE может отправить ingest с `status: "crashed"`.

---

### 7. `heartbeat_stale`

**Источник: сайт** (`check_stale_heartbeats`), не EXE.  
Нет heartbeat дольше `grace_sec` после `next_heartbeat_at`.

**Поля (формирует `check_stale_heartbeats`):**

| Поле | Описание |
|------|----------|
| `machine`, `profile` | из `stress_run_live` |
| `company_name`, `order_number` | опционально |
| `current_test_index`, `current_test_name`, `planned_total` | прогресс |
| `failed_count`, `has_errors` | ошибки в прогоне |
| `missed_minutes` | int — на сколько просрочили |
| `remaining_sec` | int |

**headline (fallback на сайте):**
```
💥 Нет отбивки — проверьте ПК
```

**Хвост:** просрочка + последний тест.  
Поле `tests` обычно **нет** — только `profile` в core-блоке.

---

## Пример полного сообщения (`run_finished`)

```
💥 Упал тест FurMark · ⚠️ высокий Hot Spot

🖥 Стенд: Стенд-1
📦 Заказ: 12345
📋 Профиль: прогон 50 минут основной

Тесты:
✅ OCCT CPU — 10м 0с
💥 FurMark — код 1
⏭ Cinebench R23 — не выполнен — сбой системы
⏭ MemTest — не выполнен — сбой системы

📝 Стандартный прогон

📊 Итог: 1/4 успешно, ошибок: 3

🌡 GPU — обслуживание:
• Разница Hot Spot − Core превысила 17 °C (Δ 19.2 °C: core 72.0 °C, hotspot 91.2 °C). Требуется обслуживание GPU.

🔗 https://example.com/admin/stress
```

---

## HTML / Telegram

- Оборачивать `headline` в `<b>…</b>`.
- Экранировать: `<`, `>`, `&` во всех полях из JSON.
- Ссылка на админку: env `SITE_BASE_URL` + `/admin/stress`.
- Не использовать Markdown — только HTML.

---

## Fallback-логика заголовка (сайт)

```python
def _notify_headline(body, fallback):
    headline = (body.get("headline") or "").strip()
    if headline:
        return html.escape(headline)
    return fallback
```

Если меняете формулировки заголовков — **править в EXE** (`StressNotifyHeadline.cs`), не только на сайте.  
Сайт должен принимать любой `headline` и не ломаться без него.

---

## Чеклист при изменениях

- [ ] Новое поле в JSON → обновить `_format_notify_core()` или ветку `event` в `notify()`.
- [ ] Новый `tests[].status` → добавить в `_TEST_STATUS_EMOJI`.
- [ ] Новый тип GPU-проблемы → код в `GpuMaintenanceAnalyzer` (EXE) + строка в `StressNotifyHeadline.FormatGpu`.
- [ ] Пример JSON добавить в этот файл.
- [ ] EXE и сайт деплоить **вместе**, если меняется контракт полей.

---

## Связанные файлы

| Компонент | Путь |
|-----------|------|
| Notify handler | `backend/stress/index.py` |
| Telegram send | `backend/stress/tg_notify.py` |
| Live runs / stale | `backend/stress/index.py` → `heartbeat`, `check_stale_heartbeats` |
| EXE payload | `desktop/StressRunner/StressNotifyPayload.cs` |
| EXE headlines | `desktop/StressRunner/StressNotifyHeadline.cs` |
| GPU codes | `desktop/StressRunner/GpuMaintenanceAnalyzer.cs` |
