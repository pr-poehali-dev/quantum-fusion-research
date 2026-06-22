-- Справочник брендов (производителей) + привязка к карточке товара.
-- brand_id у products NULLABLE — не ломает существующие товары, склад и совместимость.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.brands (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    slug        VARCHAR(120) NOT NULL UNIQUE,
    logo_url    TEXT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE t_p72635010_quantum_fusion_resea.products
    ADD COLUMN IF NOT EXISTS brand_id INTEGER NULL;

CREATE INDEX IF NOT EXISTS idx_products_brand_id
    ON t_p72635010_quantum_fusion_resea.products(brand_id);