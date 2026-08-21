-- Номер заказа у прогона стресс-теста отдельным полем.
-- Раньше он приезжал приклеенным к имени стенда («Заказ 5206 · стенд Даня»)
-- и к профилю. После чистки подписей его стало некуда сохранять — храним явно.
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_runs
  ADD COLUMN IF NOT EXISTS order_number TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS stress_runs_order_idx
  ON t_p72635010_quantum_fusion_resea.stress_runs (order_number)
  WHERE order_number <> '';

-- Восстанавливаем номера у уже сохранённых прогонов и чистим их названия:
-- «Заказ 5206 · стенд Даня» → стенд «стенд Даня», заказ «5206».
UPDATE t_p72635010_quantum_fusion_resea.stress_runs
SET order_number = COALESCE(
      NULLIF(substring(machine_name from '^[Зз]аказ\s*№?\s*([0-9A-Za-z-]+)'), ''),
      NULLIF(substring(profile_name from '^[Зз]аказ\s*№?\s*([0-9A-Za-z-]+)'), ''),
      '')
WHERE order_number = ''
  AND (machine_name ~ '^[Зз]аказ\s' OR profile_name ~ '^[Зз]аказ\s');

-- Стенд: срезаем префикс «Заказ N · », оставляя настоящее имя.
UPDATE t_p72635010_quantum_fusion_resea.stress_runs
SET machine_name = regexp_replace(
      machine_name, '^[Зз]аказ\s*№?\s*[0-9A-Za-z-]+\s*(·|\||-|—|:)\s*', '')
WHERE machine_name ~ '^[Зз]аказ\s*№?\s*[0-9A-Za-z-]+\s*(·|\||-|—|:)\s*';

-- Профиль: то же самое.
UPDATE t_p72635010_quantum_fusion_resea.stress_runs
SET profile_name = regexp_replace(
      profile_name, '^[Зз]аказ\s*№?\s*[0-9A-Za-z-]+\s*(·|\||-|—|:)\s*', '')
WHERE profile_name ~ '^[Зз]аказ\s*№?\s*[0-9A-Za-z-]+\s*(·|\||-|—|:)\s*';
