-- П.3: галочка «показывать в названии» для характеристик + суффикс в имени.
-- Мастер карточки товара теперь строит имя из реальных характеристик категории.
ALTER TABLE t_p72635010_quantum_fusion_resea.spec_attributes
  ADD COLUMN IF NOT EXISTS show_in_name BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE t_p72635010_quantum_fusion_resea.spec_attributes
  ADD COLUMN IF NOT EXISTS name_suffix VARCHAR(16);

-- Сид: включаем show_in_name у характеристик, которые сейчас участвуют в имени
-- (перенос текущего поведения хардкод-шаблонов на данные).
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a
SET show_in_name = TRUE
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id = a.category_id AND (
  (sc.product_category_slug = 'gpu'         AND a.code IN ('series','vram_gb','model','color')) OR
  (sc.product_category_slug = 'psu'         AND a.code IN ('series','80plus','watt','atx_standard','color')) OR
  (sc.product_category_slug = 'cpu'         AND a.code IN ('lineup','model','edition')) OR
  (sc.product_category_slug = 'motherboard' AND a.code IN ('chipset','series','model','color')) OR
  (sc.product_category_slug = 'ram'         AND a.code IN ('series','mem_type','freq','cl-timing','color')) OR
  (sc.product_category_slug = 'storage'     AND a.code IN ('model','capacity_gb')) OR
  (sc.product_category_slug = 'case'        AND a.code IN ('model','color')) OR
  (sc.product_category_slug = 'cooling'     AND a.code IN ('cooler_type','model','color','rad_size'))
);

-- Суффиксы для числовых полей в имени.
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a
SET name_suffix = 'Gb'
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id = a.category_id AND sc.product_category_slug = 'gpu' AND a.code = 'vram_gb';

UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a
SET name_suffix = 'mhz'
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id = a.category_id AND sc.product_category_slug = 'ram' AND a.code = 'freq';