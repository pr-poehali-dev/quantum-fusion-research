-- SEO мета для статей (title/description можно переопределить вручную).
ALTER TABLE t_p72635010_quantum_fusion_resea.articles
    ADD COLUMN IF NOT EXISTS meta_title TEXT,
    ADD COLUMN IF NOT EXISTS meta_description TEXT;
