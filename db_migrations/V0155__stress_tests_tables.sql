CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_runs (
    id            SERIAL PRIMARY KEY,
    run_uid       TEXT UNIQUE NOT NULL,
    profile_name  TEXT NOT NULL DEFAULT '',
    machine_name  TEXT NOT NULL DEFAULT '',
    os_info       TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    total_tests   INTEGER NOT NULL DEFAULT 0,
    passed_tests  INTEGER NOT NULL DEFAULT 0,
    failed_tests  INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'completed',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_results (
    id            SERIAL PRIMARY KEY,
    run_id        INTEGER NOT NULL,
    test_name     TEXT NOT NULL DEFAULT '',
    command       TEXT NOT NULL DEFAULT '',
    exit_code     INTEGER,
    duration_sec  NUMERIC(12,3) NOT NULL DEFAULT 0,
    planned_sec   INTEGER NOT NULL DEFAULT 0,
    timed_out     BOOLEAN NOT NULL DEFAULT FALSE,
    success       BOOLEAN NOT NULL DEFAULT FALSE,
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_files (
    id            SERIAL PRIMARY KEY,
    result_id     INTEGER NOT NULL,
    file_name     TEXT NOT NULL DEFAULT '',
    file_url      TEXT NOT NULL DEFAULT '',
    file_size     INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stress_results_run ON t_p72635010_quantum_fusion_resea.stress_results(run_id);
CREATE INDEX IF NOT EXISTS idx_stress_files_result ON t_p72635010_quantum_fusion_resea.stress_files(result_id);
CREATE INDEX IF NOT EXISTS idx_stress_runs_created ON t_p72635010_quantum_fusion_resea.stress_runs(created_at DESC);