CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.warehouse_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_categories (name)
SELECT DISTINCT category FROM t_p72635010_quantum_fusion_resea.warehouse_groups
WHERE category IS NOT NULL AND category != ''
ON CONFLICT (name) DO NOTHING;