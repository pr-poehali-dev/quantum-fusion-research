CREATE TABLE IF NOT EXISTS configurator_components (
  id SERIAL PRIMARY KEY,
  slot VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(100),
  price NUMERIC(12,2) NOT NULL,
  specs JSONB,
  in_stock BOOLEAN,
  sort_order INT,
  created_at TIMESTAMP
)