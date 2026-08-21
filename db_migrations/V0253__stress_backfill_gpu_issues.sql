-- Восстанавливаем предупреждения об обслуживании GPU у уже сохранённых
-- прогонов: считаем по датчикам теми же порогами, что и программа
-- (Hot Spot >= 100 °C, память >= 90 °C, дельта Hot Spot - Core > 17 °C).
WITH peak AS (
  SELECT run_id,
         MAX(max_val) FILTER (WHERE split_part(key, '::', 1) = 'gpu_hotspot')  AS hotspot,
         MAX(max_val) FILTER (WHERE split_part(key, '::', 1) = 'gpu_temp')     AS core,
         MAX(max_val) FILTER (WHERE split_part(key, '::', 1) = 'gpu_mem_temp') AS mem
  FROM t_p72635010_quantum_fusion_resea.stress_metrics
  GROUP BY run_id
),
calc AS (
  SELECT run_id,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN hotspot >= 100 THEN
        'Hot Spot превысил 100 °C (макс. ' || ROUND(hotspot::numeric, 1) || ' °C). Алярм.' END,
      CASE WHEN mem >= 90 THEN
        'Память видеокарты нагрелась до ' || ROUND(mem::numeric, 1) || ' °C (порог 90 °C).' END,
      CASE WHEN hotspot IS NOT NULL AND core IS NOT NULL AND (hotspot - core) > 17 THEN
        'Разница Hot Spot и ядра ' || ROUND((hotspot - core)::numeric, 1)
        || ' °C (норма до 17 °C) — похоже на высохшую термопасту.' END
    ], NULL) AS issues,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN hotspot >= 100 THEN 'gpu_hotspot_high' END,
      CASE WHEN mem >= 90 THEN 'gpu_mem_temp_high' END,
      CASE WHEN hotspot IS NOT NULL AND core IS NOT NULL AND (hotspot - core) > 17
        THEN 'gpu_hotspot_delta_high' END
    ], NULL) AS codes
  FROM peak
)
UPDATE t_p72635010_quantum_fusion_resea.stress_runs r
SET gpu_maintenance = TRUE,
    gpu_issues = to_jsonb(c.issues),
    gpu_issue_codes = to_jsonb(c.codes)
FROM calc c
WHERE c.run_id = r.id
  AND array_length(c.issues, 1) > 0
  AND r.gpu_maintenance = FALSE;
