-- Присвоить PC-номера заказам-сборкам (order_type='pc_build'), у которых
-- display_number был NULL и они ошибочно показывались как HW.
-- Нумеруем по порядку id, начиная со следующего свободного PC-номера.
WITH base AS (
  SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(display_number, '\D', '', 'g'), '') AS INTEGER)), 0) AS maxnum
  FROM t_p72635010_quantum_fusion_resea.orders
  WHERE display_number LIKE 'PC%'
),
to_fix AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM t_p72635010_quantum_fusion_resea.orders
  WHERE order_type = 'pc_build'
    AND (display_number IS NULL OR display_number LIKE 'HW%')
)
UPDATE t_p72635010_quantum_fusion_resea.orders o
SET display_number = 'PC' || LPAD((base.maxnum + to_fix.rn)::text, 5, '0')
FROM to_fix, base
WHERE o.id = to_fix.id;