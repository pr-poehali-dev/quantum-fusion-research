CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.price_run_stats (
    source_name   text PRIMARY KEY,
    price_changes integer NOT NULL DEFAULT 0,
    new_products  integer NOT NULL DEFAULT 0,
    processed     integer NOT NULL DEFAULT 0,
    updated_at    timestamptz NOT NULL DEFAULT now()
);