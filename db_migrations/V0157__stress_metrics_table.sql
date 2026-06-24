CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_metrics (
    id        SERIAL PRIMARY KEY,
    run_id    INTEGER NOT NULL,
    key       TEXT NOT NULL DEFAULT '',
    label     TEXT NOT NULL DEFAULT '',
    unit      TEXT NOT NULL DEFAULT '',
    min_val   DOUBLE PRECISION,
    max_val   DOUBLE PRECISION,
    avg_val   DOUBLE PRECISION,
    samples   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stress_metrics_run ON t_p72635010_quantum_fusion_resea.stress_metrics(run_id);