CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL,
  old_price NUMERIC(12,2),
  image_url TEXT,
  specs JSONB,
  in_stock BOOLEAN,
  is_featured BOOLEAN,
  sort_order INT,
  created_at TIMESTAMP
)