-- Источники цен (конкуренты / сайты для мониторинга)
CREATE TABLE IF NOT EXISTS price_sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT now()
);

-- Входящие наблюдения от парсера (приходят ТОЛЬКО по изменениям цен)
CREATE TABLE IF NOT EXISTS price_observations (
    id SERIAL PRIMARY KEY,
    source_id INTEGER REFERENCES price_sources(id),
    source_name VARCHAR(255),
    ext_name VARCHAR(500) NOT NULL,        -- название товара у конкурента
    ext_sku VARCHAR(255),                  -- артикул, если парсер прислал
    price NUMERIC(12,2) NOT NULL,          -- цена конкурента
    in_stock BOOLEAN,
    url TEXT,                              -- ссылка на товар у конкурента
    matched_product_id INTEGER REFERENCES products(id),
    match_score NUMERIC(5,2),              -- степень совпадения по названию (0..100)
    created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_obs_created ON price_observations(created_at);
CREATE INDEX IF NOT EXISTS idx_price_obs_matched ON price_observations(matched_product_id);

-- Предложения на утро: что показать менеджеру для подтверждения
-- kind = 'price_change' (есть наш товар) | 'new_product' (товара у нас нет)
CREATE TABLE IF NOT EXISTS price_suggestions (
    id SERIAL PRIMARY KEY,
    kind VARCHAR(20) NOT NULL DEFAULT 'price_change',
    observation_id INTEGER REFERENCES price_observations(id),
    product_id INTEGER REFERENCES products(id),
    source_name VARCHAR(255),
    ext_name VARCHAR(500),
    ext_url TEXT,
    market_price NUMERIC(12,2),            -- цена конкурента
    current_price NUMERIC(12,2),           -- наша текущая цена (если товар наш)
    suggested_price NUMERIC(12,2),         -- рекомендованная: market * 0.93, округл. до 250
    status VARCHAR(20) NOT NULL DEFAULT 'new',  -- new | accepted | rejected
    decided_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_sugg_status ON price_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_price_sugg_created ON price_suggestions(created_at);