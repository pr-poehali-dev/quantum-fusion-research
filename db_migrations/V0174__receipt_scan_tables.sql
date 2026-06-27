-- Приёмка по счёту через локальную VLM (OCR).

-- 1. Задачи на распознавание (очередь для воркера на сервере с GPU)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.receipt_jobs (
    id           SERIAL PRIMARY KEY,
    status       VARCHAR(20) NOT NULL DEFAULT 'NEW',
    image_url    TEXT NOT NULL,
    raw_result   JSONB,
    matched      JSONB,
    error        TEXT,
    created_at   TIMESTAMP DEFAULT NOW(),
    started_at   TIMESTAMP,
    finished_at  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_receipt_jobs_status ON t_p72635010_quantum_fusion_resea.receipt_jobs(status, created_at);

-- 2. Черновики листа приёмки (чтобы не потерять прогресс при создании нового SKU)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.receipt_drafts (
    id           SERIAL PRIMARY KEY,
    job_id       INTEGER,
    store_id     INTEGER,
    rows         JSONB NOT NULL DEFAULT '[]',
    status       VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipt_drafts_status ON t_p72635010_quantum_fusion_resea.receipt_drafts(status, updated_at);

-- 3. Память сопоставлений: сырое название с чека -> конкретный SKU
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.receipt_match_memory (
    id           SERIAL PRIMARY KEY,
    raw_norm     TEXT NOT NULL,
    group_id     INTEGER NOT NULL,
    hits         INTEGER NOT NULL DEFAULT 1,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW(),
    UNIQUE (raw_norm, group_id)
);
CREATE INDEX IF NOT EXISTS idx_receipt_match_memory_norm ON t_p72635010_quantum_fusion_resea.receipt_match_memory(raw_norm);
