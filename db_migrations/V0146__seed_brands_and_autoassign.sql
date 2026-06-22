-- Наполнение справочника брендов и привязка товаров (автопарсинг по названию).
-- Регистронезависимо, по вхождению подстроки. Дубли написания схлопнуты.
INSERT INTO t_p72635010_quantum_fusion_resea.brands (name, slug, sort_order) VALUES
  ('AMD', 'amd', 0),
  ('Intel', 'intel', 0),
  ('NVIDIA', 'nvidia', 0),
  ('ASUS', 'asus', 0),
  ('ASRock', 'asrock', 0),
  ('MSI', 'msi', 0),
  ('GIGABYTE', 'gigabyte', 0),
  ('Maxsun', 'maxsun', 0),
  ('Palit', 'palit', 0),
  ('KFA2', 'kfa2', 0),
  ('G.Skill', 'gskill', 0),
  ('KingBank', 'kingbank', 0),
  ('Kingston', 'kingston', 0),
  ('ADATA', 'adata', 0),
  ('Seagate', 'seagate', 0),
  ('Exegate', 'exegate', 0),
  ('1StPlayer', '1stplayer', 0),
  ('Cougar', 'cougar', 0),
  ('Jonsbo', 'jonsbo', 0),
  ('Lian Li', 'lian-li', 0),
  ('Xastra', 'xastra', 0),
  ('Super Flower', 'super-flower', 0),
  ('Thermalright', 'thermalright', 0),
  ('Arctic', 'arctic', 0),
  ('ID-COOLING', 'id-cooling', 0),
  ('Pentawave', 'pentawave', 0)
ON CONFLICT (slug) DO NOTHING;

-- Привязка по вхождению названия бренда в название товара (только где brand_id пуст).
-- Многословные/специфичные бренды идут так, чтобы не перехватывались общими.
UPDATE t_p72635010_quantum_fusion_resea.products p
SET brand_id = b.id
FROM t_p72635010_quantum_fusion_resea.brands b
WHERE p.brand_id IS NULL
  AND p.is_archived = FALSE
  AND (
    (b.slug = 'amd'          AND p.name ILIKE '%AMD %') OR
    (b.slug = 'intel'        AND p.name ILIKE 'Intel %') OR
    (b.slug = 'nvidia'       AND p.name ILIKE 'NVIDIA %') OR
    (b.slug = 'asus'         AND p.name ILIKE 'ASUS %') OR
    (b.slug = 'asrock'       AND p.name ILIKE '%asrock%') OR
    (b.slug = 'msi'          AND p.name ILIKE 'MSI %') OR
    (b.slug = 'gigabyte'     AND p.name ILIKE '%gigabyte%') OR
    (b.slug = 'maxsun'       AND p.name ILIKE '%maxsun%') OR
    (b.slug = 'palit'        AND p.name ILIKE '%palit%') OR
    (b.slug = 'kfa2'         AND p.name ILIKE '%kfa2%') OR
    (b.slug = 'gskill'       AND p.name ILIKE '%g.skill%') OR
    (b.slug = 'kingbank'     AND p.name ILIKE '%kingbank%') OR
    (b.slug = 'kingston'     AND p.name ILIKE '%kingston%') OR
    (b.slug = 'adata'        AND p.name ILIKE '%adata%') OR
    (b.slug = 'seagate'      AND p.name ILIKE '%seagate%') OR
    (b.slug = 'exegate'      AND p.name ILIKE '%exegate%') OR
    (b.slug = '1stplayer'    AND p.name ILIKE '%1stplayer%') OR
    (b.slug = 'cougar'       AND p.name ILIKE '%cougar%') OR
    (b.slug = 'jonsbo'       AND p.name ILIKE '%jonsbo%') OR
    (b.slug = 'lian-li'      AND p.name ILIKE '%lian li%') OR
    (b.slug = 'xastra'       AND p.name ILIKE '%xastra%') OR
    (b.slug = 'super-flower' AND p.name ILIKE '%super flower%') OR
    (b.slug = 'thermalright' AND p.name ILIKE '%thermalright%') OR
    (b.slug = 'arctic'       AND p.name ILIKE '%arctic%') OR
    (b.slug = 'id-cooling'   AND p.name ILIKE '%id-cooling%') OR
    (b.slug = 'pentawave'    AND p.name ILIKE '%pentawave%')
  );