-- Упорядочиваем показ характеристик в имени (sort_order) как в прежних шаблонах.
-- Плоские UPDATE (без DO-блока — Simple Query Protocol).
-- gpu: series, vram_gb, model, color
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a SET sort_order = CASE a.code
  WHEN 'series' THEN 0 WHEN 'vram_gb' THEN 1 WHEN 'model' THEN 2 WHEN 'color' THEN 3 END
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id=a.category_id AND sc.product_category_slug='gpu' AND a.show_in_name=TRUE
  AND a.code IN ('series','vram_gb','model','color');

-- psu: series, 80plus, watt, atx_standard, color
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a SET sort_order = CASE a.code
  WHEN 'series' THEN 0 WHEN '80plus' THEN 1 WHEN 'watt' THEN 2 WHEN 'atx_standard' THEN 3 WHEN 'color' THEN 4 END
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id=a.category_id AND sc.product_category_slug='psu' AND a.show_in_name=TRUE
  AND a.code IN ('series','80plus','watt','atx_standard','color');

-- cpu: lineup, model, edition
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a SET sort_order = CASE a.code
  WHEN 'lineup' THEN 0 WHEN 'model' THEN 1 WHEN 'edition' THEN 2 END
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id=a.category_id AND sc.product_category_slug='cpu' AND a.show_in_name=TRUE
  AND a.code IN ('lineup','model','edition');

-- motherboard: chipset, series, model, color
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a SET sort_order = CASE a.code
  WHEN 'chipset' THEN 0 WHEN 'series' THEN 1 WHEN 'model' THEN 2 WHEN 'color' THEN 3 END
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id=a.category_id AND sc.product_category_slug='motherboard' AND a.show_in_name=TRUE
  AND a.code IN ('chipset','series','model','color');

-- ram: series, mem_type, freq, cl-timing, color
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a SET sort_order = CASE a.code
  WHEN 'series' THEN 0 WHEN 'mem_type' THEN 1 WHEN 'freq' THEN 2 WHEN 'cl-timing' THEN 3 WHEN 'color' THEN 4 END
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id=a.category_id AND sc.product_category_slug='ram' AND a.show_in_name=TRUE
  AND a.code IN ('series','mem_type','freq','cl-timing','color');

-- storage: model, capacity_gb
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a SET sort_order = CASE a.code
  WHEN 'model' THEN 0 WHEN 'capacity_gb' THEN 1 END
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id=a.category_id AND sc.product_category_slug='storage' AND a.show_in_name=TRUE
  AND a.code IN ('model','capacity_gb');

-- case: model, color
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a SET sort_order = CASE a.code
  WHEN 'model' THEN 0 WHEN 'color' THEN 1 END
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id=a.category_id AND sc.product_category_slug='case' AND a.show_in_name=TRUE
  AND a.code IN ('model','color');

-- cooling: cooler_type, model, color, rad_size
UPDATE t_p72635010_quantum_fusion_resea.spec_attributes a SET sort_order = CASE a.code
  WHEN 'cooler_type' THEN 0 WHEN 'model' THEN 1 WHEN 'color' THEN 2 WHEN 'rad_size' THEN 3 END
FROM t_p72635010_quantum_fusion_resea.spec_categories sc
WHERE sc.id=a.category_id AND sc.product_category_slug='cooling' AND a.show_in_name=TRUE
  AND a.code IN ('cooler_type','model','color','rad_size');