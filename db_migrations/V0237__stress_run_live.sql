-- Heartbeat длительных прогонов StressRunner («сейчас на стенде»).
-- В спецификации EXE эта миграция названа V0183__stress_run_live.sql,
-- но V0183 в нашем проекте уже занят (sync_wip_component_names),
-- поэтому тот же DDL применяется под следующим свободным номером.
-- Схема таблицы и имена полей — 1:1 по спецификации, менять нельзя:
-- EXE шлёт payload с этими именами.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_run_live (
    run_uid                   TEXT PRIMARY KEY,
    machine_name              TEXT DEFAULT '',
    profile_name              TEXT DEFAULT '',
    company_name              TEXT DEFAULT '',
    order_number              TEXT DEFAULT '',
    started_at                TIMESTAMPTZ,
    heartbeat_at              TIMESTAMPTZ,
    next_heartbeat_at         TIMESTAMPTZ,
    heartbeat_interval_sec    INTEGER DEFAULT 3600,
    -- grace_sec приходит от EXE: сколько сайту ждать после next_heartbeat_at.
    -- Это контракт, хардкодить 15 минут на стороне сайта НЕЛЬЗЯ.
    grace_sec                 INTEGER DEFAULT 900,
    current_test_index        INTEGER DEFAULT 0,
    current_test_name         TEXT DEFAULT '',
    planned_total             INTEGER DEFAULT 0,
    completed_count           INTEGER DEFAULT 0,
    failed_count              INTEGER DEFAULT 0,
    has_errors                BOOLEAN DEFAULT FALSE,
    failed_tests              JSONB DEFAULT '[]'::jsonb,
    remaining_sec             INTEGER DEFAULT 0,
    current_test_remaining_sec INTEGER DEFAULT 0,
    -- Защита от спама: алерт о просрочке шлём один раз, до следующей отбивки.
    stale_alert_sent          BOOLEAN DEFAULT FALSE,
    stale_alert_at            TIMESTAMPTZ,
    payload                   JSONB DEFAULT '{}'::jsonb,
    partner_company_id        INTEGER,
    updated_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс под запрос cron-проверки просроченных отбивок.
CREATE INDEX IF NOT EXISTS idx_stress_run_live_stale
    ON t_p72635010_quantum_fusion_resea.stress_run_live (stale_alert_sent, next_heartbeat_at);