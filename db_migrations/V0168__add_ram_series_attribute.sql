-- Серия для ОЗУ (для блочной сборки названия и подсказок прошлых значений).
INSERT INTO t_p72635010_quantum_fusion_resea.spec_attributes
    (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order, applies_to)
SELECT sc.id, 'series', 'Серия', 'text', '[]'::jsonb, NULL, false, false, 21, 'all'
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.code = 'ram'
  AND NOT EXISTS (
    SELECT 1 FROM t_p72635010_quantum_fusion_resea.spec_attributes sa
    WHERE sa.category_id = sc.id AND sa.code = 'series'
  );
