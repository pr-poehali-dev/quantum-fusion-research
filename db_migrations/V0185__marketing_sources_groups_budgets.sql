-- Система источников клиентов (каналов привлечения), их групп, помесячных
-- рекламных бюджетов и привязки источника к заказам.

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.marketing_source_groups (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT DEFAULT '#64748b',
    sort_order  INTEGER DEFAULT 0,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.marketing_sources (
    id          SERIAL PRIMARY KEY,
    group_id    INTEGER REFERENCES t_p72635010_quantum_fusion_resea.marketing_source_groups(id),
    name        TEXT NOT NULL,
    utm_source  TEXT,
    utm_medium  TEXT,
    is_paid     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_sources_group ON t_p72635010_quantum_fusion_resea.marketing_sources(group_id);
CREATE INDEX IF NOT EXISTS idx_marketing_sources_utm ON t_p72635010_quantum_fusion_resea.marketing_sources(utm_source, utm_medium);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.marketing_budgets (
    id            SERIAL PRIMARY KEY,
    group_id      INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.marketing_source_groups(id),
    period_month  DATE NOT NULL,
    amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    leads_manual  INTEGER,
    note          TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_marketing_budgets_period ON t_p72635010_quantum_fusion_resea.marketing_budgets(period_month);

ALTER TABLE t_p72635010_quantum_fusion_resea.orders
    ADD COLUMN IF NOT EXISTS source_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.marketing_sources(id),
    ADD COLUMN IF NOT EXISTS utm_source   TEXT,
    ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
    ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_source ON t_p72635010_quantum_fusion_resea.orders(source_id);

ALTER TABLE t_p72635010_quantum_fusion_resea.quiz_requests
    ADD COLUMN IF NOT EXISTS source_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.marketing_sources(id),
    ADD COLUMN IF NOT EXISTS utm_source   TEXT,
    ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
    ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

INSERT INTO t_p72635010_quantum_fusion_resea.marketing_source_groups (name, color, sort_order)
VALUES
    ('Платная реклама', '#ef4444', 1),
    ('Бесплатные',      '#22c55e', 2),
    ('Сарафан',         '#3b82f6', 3),
    ('Прочее',          '#64748b', 9);

INSERT INTO t_p72635010_quantum_fusion_resea.marketing_sources (group_id, name, utm_source, is_paid, is_active, sort_order)
VALUES
    ((SELECT id FROM t_p72635010_quantum_fusion_resea.marketing_source_groups WHERE name='Платная реклама'), 'Яндекс Директ', 'yandex',   TRUE,  TRUE, 1),
    ((SELECT id FROM t_p72635010_quantum_fusion_resea.marketing_source_groups WHERE name='Платная реклама'), 'Avito (продвижение)', 'avito', TRUE, TRUE, 2),
    ((SELECT id FROM t_p72635010_quantum_fusion_resea.marketing_source_groups WHERE name='Бесплатные'), 'Avito (бесплатно)', 'avito_free', FALSE, TRUE, 3),
    ((SELECT id FROM t_p72635010_quantum_fusion_resea.marketing_source_groups WHERE name='Бесплатные'), 'Поиск / SEO', 'google', FALSE, TRUE, 4),
    ((SELECT id FROM t_p72635010_quantum_fusion_resea.marketing_source_groups WHERE name='Бесплатные'), 'Telegram', 'telegram', FALSE, TRUE, 5),
    ((SELECT id FROM t_p72635010_quantum_fusion_resea.marketing_source_groups WHERE name='Сарафан'), 'Рекомендация', NULL, FALSE, TRUE, 6),
    ((SELECT id FROM t_p72635010_quantum_fusion_resea.marketing_source_groups WHERE name='Прочее'), 'Другое', NULL, FALSE, TRUE, 9);
