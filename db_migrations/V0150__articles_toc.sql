-- Оглавление статьи: массив пунктов [{title, anchor}]
ALTER TABLE t_p72635010_quantum_fusion_resea.articles
  ADD COLUMN IF NOT EXISTS toc JSONB NOT NULL DEFAULT '[]'::jsonb;
