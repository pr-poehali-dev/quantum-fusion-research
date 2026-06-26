-- Видеокарта: переносим чип GPU из «Модель» (id 64) в «Серия / чип» (id 56),
-- если в series ещё нет значения. (Только копирование.)
INSERT INTO t_p72635010_quantum_fusion_resea.product_spec_values (product_id, attribute_id, value, value_json, updated_at)
SELECT m.product_id, 56, m.value, NULL, NOW()
FROM t_p72635010_quantum_fusion_resea.product_spec_values m
JOIN t_p72635010_quantum_fusion_resea.products p ON p.id = m.product_id
JOIN t_p72635010_quantum_fusion_resea.categories c ON c.id = p.category_id
WHERE m.attribute_id = 64
  AND c.slug = 'gpu'
  AND m.value IS NOT NULL AND m.value <> ''
  AND NOT EXISTS (
    SELECT 1 FROM t_p72635010_quantum_fusion_resea.product_spec_values s
    WHERE s.product_id = m.product_id AND s.attribute_id = 56
  );
