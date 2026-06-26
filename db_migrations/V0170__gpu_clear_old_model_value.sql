-- Очищаем «Модель» (id 64) у видеокарт — теперь это поле под вендорское
-- исполнение, а чип уже скопирован в «Серия / чип». Через простой UPDATE.
UPDATE t_p72635010_quantum_fusion_resea.product_spec_values
SET value = '', value_json = NULL, updated_at = NOW()
WHERE attribute_id = 64
  AND product_id IN (
    SELECT p.id FROM t_p72635010_quantum_fusion_resea.products p
    JOIN t_p72635010_quantum_fusion_resea.categories c ON c.id = p.category_id
    WHERE c.slug = 'gpu'
  );
