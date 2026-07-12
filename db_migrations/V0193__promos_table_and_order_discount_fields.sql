-- Промокоды: система скидок в корзине
CREATE TABLE IF NOT EXISTS promos (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(255),
  description TEXT,
  -- Тип действия скидки:
  -- 'cart'      — на всю корзину
  -- 'category'  — на позиции выбранных категорий/товаров
  -- 'build'     — на сборку ПК (subtype: hardware | assembly)
  -- 'combo'     — набор/комбо: нужны все слоты, скидка при наличии
  -- 'first'     — только первый заказ покупателя
  scope VARCHAR(20) NOT NULL DEFAULT 'cart',
  build_part VARCHAR(20) DEFAULT 'all',        -- для scope=build: all|hardware|assembly
  category_ids JSONB DEFAULT '[]'::jsonb,       -- для scope=category: id категорий
  product_ids JSONB DEFAULT '[]'::jsonb,        -- для scope=category: id товаров
  combo_slots JSONB DEFAULT '[]'::jsonb,        -- для scope=combo: [{category_ids:[], product_ids:[]}]
  -- Величина скидки:
  discount_type VARCHAR(10) NOT NULL DEFAULT 'percent',  -- percent | amount
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_discount NUMERIC(12,2),                   -- потолок скидки в рублях (для percent)
  -- Лимиты:
  min_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_uses INTEGER,                             -- NULL = без лимита
  used_count INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMP,
  expires_at TIMESTAMP,
  -- Публикация:
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,     -- показывать в акциях на сайте
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promos_code ON promos (LOWER(code));
CREATE INDEX IF NOT EXISTS idx_promos_public ON promos (is_public, is_active);

-- Скидка в заказе
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_id INTEGER REFERENCES promos(id);
