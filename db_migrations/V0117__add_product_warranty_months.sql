-- Гарантия товара в месяцах (по умолчанию 0)
ALTER TABLE t_p72635010_quantum_fusion_resea.products
ADD COLUMN IF NOT EXISTS warranty_months integer NOT NULL DEFAULT 0;