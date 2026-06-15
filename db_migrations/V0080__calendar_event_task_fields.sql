-- Тип, статус и происхождение для событий календаря.
-- kind: 'event' (событие) | 'task' (задача)
-- status (только для task): 'new' | 'in_progress' | 'done'
-- origin_id: id первой задачи в цепочке переносов (для xN и анти-дублей)
-- origin_date: дата первого дня задачи (для подсчёта дней простоя)
ALTER TABLE t_p72635010_quantum_fusion_resea.calendar_events
    ADD COLUMN IF NOT EXISTS kind        VARCHAR(16) NOT NULL DEFAULT 'event',
    ADD COLUMN IF NOT EXISTS status      VARCHAR(16) NOT NULL DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS origin_id   INTEGER,
    ADD COLUMN IF NOT EXISTS origin_date DATE;

CREATE INDEX IF NOT EXISTS idx_calendar_events_origin
    ON t_p72635010_quantum_fusion_resea.calendar_events (origin_id);