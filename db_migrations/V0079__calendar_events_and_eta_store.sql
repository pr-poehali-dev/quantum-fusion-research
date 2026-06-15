-- 1. Магазин для железки (откуда забирать) — теперь в БД, не только localStorage
ALTER TABLE t_p72635010_quantum_fusion_resea.wip_component_eta
    ADD COLUMN IF NOT EXISTS store_id INTEGER;

-- 2. События календаря (создаются вручную менеджером)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.calendar_events (
    id          SERIAL PRIMARY KEY,
    event_date  DATE NOT NULL,
    title       VARCHAR(255) NOT NULL,
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date
    ON t_p72635010_quantum_fusion_resea.calendar_events (event_date);

-- 3. Ответственные за событие (сотрудники из расписания)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.calendar_event_employees (
    event_id    INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    PRIMARY KEY (event_id, employee_id)
);