-- Тир-лист: ранг товара в своей категории (S/A/B/C/D/F) и позиция внутри ряда
ALTER TABLE t_p72635010_quantum_fusion_resea.products
  ADD COLUMN IF NOT EXISTS tier_rank VARCHAR(2) NULL,
  ADD COLUMN IF NOT EXISTS tier_pos  INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_tier
  ON t_p72635010_quantum_fusion_resea.products (category_id, tier_rank, tier_pos);
