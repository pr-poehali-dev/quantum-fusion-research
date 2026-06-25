-- Разделение чипсета материнки на AMD/Intel (по образцу СЖО: applies_to).
-- Платформа определяется автоматически по сокету (фронт), а характеристики
-- "Чипсет AMD" / "Чипсет Intel" показываются раздельно через applies_to.

-- 1. Новые атрибуты чипсета по платформам
INSERT INTO t_p72635010_quantum_fusion_resea.spec_attributes
  (category_id, code, name, field_type, options, applies_to, affects_compat, is_required, sort_order)
VALUES
  (2, 'chipset_amd', 'Чипсет AMD', 'select',
    '["X870E","X870","X670E","X670","B850","B650","B840","A620","A520"]'::jsonb,
    'amd', false, false, 4),
  (2, 'chipset_intel', 'Чипсет Intel', 'select',
    '["Z890","Z790","B860","B760","H810","Z690","B660"]'::jsonb,
    'intel', false, false, 5);

-- 2. Перенос значений из общего chipset (id=9) в новые атрибуты по платформе
-- AMD чипсеты
INSERT INTO t_p72635010_quantum_fusion_resea.product_spec_values (product_id, attribute_id, value)
SELECT v.product_id,
       (SELECT id FROM t_p72635010_quantum_fusion_resea.spec_attributes WHERE code='chipset_amd'),
       v.value
FROM t_p72635010_quantum_fusion_resea.product_spec_values v
WHERE v.attribute_id = 9 AND v.value <> ''
  AND UPPER(v.value) IN ('X870E','X870','X670E','X670','B850','B650','B840','A620','A520');

-- Intel чипсеты
INSERT INTO t_p72635010_quantum_fusion_resea.product_spec_values (product_id, attribute_id, value)
SELECT v.product_id,
       (SELECT id FROM t_p72635010_quantum_fusion_resea.spec_attributes WHERE code='chipset_intel'),
       v.value
FROM t_p72635010_quantum_fusion_resea.product_spec_values v
WHERE v.attribute_id = 9 AND v.value <> ''
  AND UPPER(v.value) IN ('Z890','Z790','B860','B760','H810','Z690','B660');

-- 3. Старый общий "Чипсет" уводим в конец и помечаем как служебный (скрываем через applies_to=hidden)
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes
SET applies_to = 'hidden', sort_order = 99
WHERE id = 9;
