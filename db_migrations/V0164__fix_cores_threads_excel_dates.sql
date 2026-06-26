-- Фикс испорченных Excel-значений в характеристике «Ядра/потоки»:
-- 8/16, 6/12, 4/8 Excel превратил в даты при импорте.
UPDATE t_p72635010_quantum_fusion_resea.product_spec_values psv
SET value = CASE psv.value
    WHEN '04.авг' THEN '4/8'
    WHEN '06.дек' THEN '6/12'
    WHEN 'авг.16' THEN '8/16'
    ELSE psv.value
END
FROM t_p72635010_quantum_fusion_resea.spec_attributes sa
WHERE sa.id = psv.attribute_id
  AND (sa.name ILIKE '%ядра%' OR sa.name ILIKE '%поток%')
  AND psv.value IN ('04.авг', '06.дек', 'авг.16');
