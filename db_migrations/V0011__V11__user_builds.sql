CREATE TABLE IF NOT EXISTS user_builds (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  components JSONB NOT NULL,
  parts_total NUMERIC(12,2),
  assembly_fee NUMERIC(12,2),
  total_price NUMERIC(12,2),
  share_token VARCHAR(32) UNIQUE,
  is_public BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)