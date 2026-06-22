-- Доп. привязка товара без явного бренда в названии (RTX PRO 6000 → NVIDIA).
UPDATE t_p72635010_quantum_fusion_resea.products
SET brand_id = (SELECT id FROM t_p72635010_quantum_fusion_resea.brands WHERE slug = 'nvidia')
WHERE id = 148 AND brand_id IS NULL;