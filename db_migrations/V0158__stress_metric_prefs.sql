CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_metric_prefs (
    id          SERIAL PRIMARY KEY,
    metric_key  TEXT NOT NULL,
    label_orig  TEXT NOT NULL DEFAULT '',
    label_custom TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT '',
    visible     BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (metric_key, label_orig)
);
CREATE INDEX IF NOT EXISTS idx_metric_prefs_order ON t_p72635010_quantum_fusion_resea.stress_metric_prefs(sort_order);