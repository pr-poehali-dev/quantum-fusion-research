-- Карточки тир-листа внутри статьи: массив [{title, image_url, rank}]
ALTER TABLE t_p72635010_quantum_fusion_resea.articles
  ADD COLUMN IF NOT EXISTS tier_cards JSONB NOT NULL DEFAULT '[]'::jsonb;
