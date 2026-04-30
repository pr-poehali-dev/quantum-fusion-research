CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50) NOT NULL,
  customer_email VARCHAR(255),
  order_type VARCHAR(20),
  items JSONB NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  comment TEXT,
  status VARCHAR(30),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)