-- Управляющий тип охлаждения: к какому подтипу относится характеристика.
-- all  — показывать всегда (по умолчанию, не ломает другие категории);
-- air  — только для воздушного охлаждения (cooler_type='Воздушное');
-- liquid — только для жидкостного (cooler_type='СЖО').
ALTER TABLE t_p72635010_quantum_fusion_resea.spec_attributes
  ADD COLUMN IF NOT EXISTS applies_to VARCHAR(10) NOT NULL DEFAULT 'all';

-- Воздушное охлаждение: высота башни
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes
SET applies_to = 'air'
WHERE code IN ('height_mm')
  AND category_id = (SELECT id FROM t_p72635010_quantum_fusion_resea.spec_categories WHERE code = 'cooling');

-- Жидкостное охлаждение (СЖО): радиатор, помпа, экран
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes
SET applies_to = 'liquid'
WHERE code IN ('rad_size', 'pump_tier', 'pump_noise', 'screen')
  AND category_id = (SELECT id FROM t_p72635010_quantum_fusion_resea.spec_categories WHERE code = 'cooling');
