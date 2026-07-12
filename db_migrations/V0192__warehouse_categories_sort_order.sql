ALTER TABLE t_p72635010_quantum_fusion_resea.warehouse_categories
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY name) * 10 AS rn
    FROM t_p72635010_quantum_fusion_resea.warehouse_categories
)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_categories c
SET sort_order = o.rn
FROM ordered o
WHERE c.id = o.id;