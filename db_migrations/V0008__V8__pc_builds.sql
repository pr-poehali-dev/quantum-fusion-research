CREATE TABLE IF NOT EXISTS pc_builds (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  image_urls JSONB,
  components JSONB NOT NULL,
  parts_total NUMERIC(12,2) NOT NULL,
  assembly_type VARCHAR(20),
  assembly_fee NUMERIC(12,2),
  total_price NUMERIC(12,2) NOT NULL,
  status VARCHAR(20),
  is_featured BOOLEAN,
  sort_order INT,
  created_at TIMESTAMP
)