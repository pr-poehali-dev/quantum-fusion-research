CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.warehouse_inventory_items (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.warehouse_inventories(id),
  group_id INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.warehouse_groups(id),
  qty_expected INTEGER NOT NULL DEFAULT 0,
  qty_actual INTEGER NULL,
  cell VARCHAR(64),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);