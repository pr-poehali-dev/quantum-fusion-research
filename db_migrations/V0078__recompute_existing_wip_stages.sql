-- Разовый пересчёт этапа существующих сборок по новой логике авто-статусов:
-- все железки заказаны (ordered_*/ready, есть ordered) и этап ещё "Заказ" → "Ожидание железа".
-- все готовы (ready/pending) → "Ожидание сборки".
WITH agg AS (
  SELECT id,
    stage,
    order_id,
    -- список статусов заполненных слотов
    ARRAY_REMOVE(ARRAY[
      CASE WHEN cpu IS NOT NULL THEN cpu_status END,
      CASE WHEN motherboard IS NOT NULL THEN motherboard_status END,
      CASE WHEN ram IS NOT NULL THEN ram_status END,
      CASE WHEN gpu IS NOT NULL THEN gpu_status END,
      CASE WHEN storage IS NOT NULL THEN storage_status END,
      CASE WHEN psu IS NOT NULL THEN psu_status END,
      CASE WHEN case_name IS NOT NULL THEN case_status END,
      CASE WHEN cooling IS NOT NULL THEN cooling_status END,
      CASE WHEN extra IS NOT NULL THEN extra_status END
    ], NULL) AS statuses
  FROM t_p72635010_quantum_fusion_resea.wip_builds
  WHERE stage IN ('Заказ','Ожидание железа','Ожидание сборки')
),
calc AS (
  SELECT id, stage, order_id,
    NOT EXISTS (SELECT 1 FROM unnest(statuses) s WHERE s NOT IN ('ready','pending')) AS all_ready,
    NOT EXISTS (SELECT 1 FROM unnest(statuses) s WHERE s NOT IN ('ready','pending','ordered_transit','ordered_delay')) AS all_ord_or_ready,
    EXISTS (SELECT 1 FROM unnest(statuses) s WHERE s IN ('ordered_transit','ordered_delay')) AS has_ordered
  FROM agg
  WHERE array_length(statuses,1) > 0
)
UPDATE t_p72635010_quantum_fusion_resea.wip_builds wb
SET stage = CASE
      WHEN c.all_ready THEN 'Ожидание сборки'
      WHEN c.all_ord_or_ready AND c.has_ordered THEN 'Ожидание железа'
      ELSE wb.stage END,
    updated_at = NOW()
FROM calc c
WHERE wb.id = c.id
  AND (
    (c.all_ready AND wb.stage <> 'Ожидание сборки')
    OR (NOT c.all_ready AND c.all_ord_or_ready AND c.has_ordered AND wb.stage <> 'Ожидание железа')
  );