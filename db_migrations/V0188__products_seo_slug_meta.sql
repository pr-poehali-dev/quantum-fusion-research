-- SEO для товаров: slug (ЧПУ-транслит), meta_title, meta_description.
-- Транслит выполнен inline (без функций) — совместимо с Simple Query Protocol.

ALTER TABLE t_p72635010_quantum_fusion_resea.products
    ADD COLUMN IF NOT EXISTS slug TEXT,
    ADD COLUMN IF NOT EXISTS meta_title TEXT,
    ADD COLUMN IF NOT EXISTS meta_description TEXT;

-- Шаг 1: базовый слаг из названия (транслит вложенными replace + чистка)
WITH t AS (
    SELECT id,
        trim(both '-' from
          regexp_replace(
            replace(replace(replace(replace(replace(replace(replace(replace(replace(
            replace(replace(replace(replace(replace(replace(replace(replace(replace(
            replace(replace(replace(replace(replace(replace(replace(replace(replace(
            replace(replace(replace(replace(replace(replace(
                lower(name),
                'а','a'),'б','b'),'в','v'),'г','g'),'д','d'),'е','e'),'ё','yo'),
                'ж','zh'),'з','z'),'и','i'),'й','j'),'к','k'),'л','l'),'м','m'),
                'н','n'),'о','o'),'п','p'),'р','r'),'с','s'),'т','t'),'у','u'),
                'ф','f'),'х','kh'),'ц','ts'),'ч','ch'),'ш','sh'),'щ','sch'),
                'ъ',''),'ы','y'),'ь',''),'э','e'),'ю','yu'),'я','ya'),
            '[^a-z0-9]+', '-', 'g')
        ) AS b
    FROM t_p72635010_quantum_fusion_resea.products
    WHERE slug IS NULL OR slug = ''
)
UPDATE t_p72635010_quantum_fusion_resea.products p
SET slug = CASE WHEN t.b = '' OR t.b IS NULL THEN 'p-' || p.id ELSE t.b END
FROM t WHERE p.id = t.id;

-- Шаг 2: разруливаем дубли — всем, кроме первого (по id), добавляем -{id}
WITH d AS (
    SELECT id, slug,
           ROW_NUMBER() OVER (PARTITION BY slug ORDER BY id) AS rn
    FROM t_p72635010_quantum_fusion_resea.products
    WHERE slug IS NOT NULL AND slug <> ''
)
UPDATE t_p72635010_quantum_fusion_resea.products p
SET slug = p.slug || '-' || p.id
FROM d
WHERE p.id = d.id AND d.rn > 1;

-- Уникальный индекс на slug (только непустые)
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_slug
    ON t_p72635010_quantum_fusion_resea.products (slug)
    WHERE slug IS NOT NULL AND slug <> '';
