CREATE TABLE cable_configs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  cpu_type VARCHAR(20) NOT NULL DEFAULT '8-pin',
  gpu_type VARCHAR(20) NOT NULL DEFAULT '8-pin',
  pin_colors JSONB NOT NULL DEFAULT '{}',
  client_token VARCHAR(64) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_cable_configs_client_token ON cable_configs(client_token);
