-- Отчёты о нехватке датчиков с тестового стенда (sensor feedback).
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_sensor_feedback (
    id             SERIAL PRIMARY KEY,
    stand_name     TEXT        NOT NULL DEFAULT '',
    order_number   TEXT        NOT NULL DEFAULT '',
    profile_name   TEXT        NOT NULL DEFAULT '',
    app_version    TEXT        NOT NULL DEFAULT '',
    hwinfo_active  BOOLEAN     NOT NULL DEFAULT TRUE,
    slots_ok       INTEGER     NOT NULL DEFAULT 0,
    slots_missing  INTEGER     NOT NULL DEFAULT 0,
    slots_na       INTEGER     NOT NULL DEFAULT 0,
    missing_labels JSONB       NOT NULL DEFAULT '[]'::jsonb,
    note           TEXT        NOT NULL DEFAULT '',
    file_name      TEXT        NOT NULL DEFAULT '',
    file_url       TEXT        NOT NULL DEFAULT '',
    file_size      BIGINT      NOT NULL DEFAULT 0,
    sha256         TEXT        NOT NULL DEFAULT '',
    company_id     INTEGER,
    is_resolved    BOOLEAN     NOT NULL DEFAULT FALSE,
    exported_at    TIMESTAMP,
    created_at     TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensor_feedback_created
    ON t_p72635010_quantum_fusion_resea.stress_sensor_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_feedback_stand
    ON t_p72635010_quantum_fusion_resea.stress_sensor_feedback (stand_name);
