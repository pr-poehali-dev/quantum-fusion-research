-- SEO-поля для сборок ПК: у товаров и статей они уже есть, у сборок не было.
ALTER TABLE t_p72635010_quantum_fusion_resea.pc_builds
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS meta_title TEXT,
  ADD COLUMN IF NOT EXISTS meta_description TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pc_builds_slug_uniq
  ON t_p72635010_quantum_fusion_resea.pc_builds (slug)
  WHERE slug IS NOT NULL AND slug <> '';

-- Блок «вопрос-ответ» у статей: именно его цитируют ИИ-поисковики,
-- и из него же собирается разметка FAQPage для Google/Яндекса.
ALTER TABLE t_p72635010_quantum_fusion_resea.articles
  ADD COLUMN IF NOT EXISTS faq JSONB DEFAULT '[]'::jsonb;

-- Индексы для быстрого поиска ненаполненных SEO-полей в админке.
CREATE INDEX IF NOT EXISTS products_meta_title_idx
  ON t_p72635010_quantum_fusion_resea.products (id)
  WHERE meta_title IS NULL OR meta_title = '';