ALTER TABLE t_p72635010_quantum_fusion_resea.warehouse_rma
    ADD COLUMN IF NOT EXISTS replacement_order_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.orders(id),
    ADD COLUMN IF NOT EXISTS replace_from_stock BOOLEAN NOT NULL DEFAULT FALSE;
