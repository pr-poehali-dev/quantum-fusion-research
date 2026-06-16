-- ── Модуль «Финансы»: типы операций и лог движения средств ──────────────────

-- Типы операций (расход/приход). Системные удалять нельзя.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.finance_types (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    -- 'expense' | 'income' | 'collection' (инкассация — изъятие в офис)
    direction   VARCHAR(20)  NOT NULL,
    is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
    sort_order  INTEGER      NOT NULL DEFAULT 100,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Лог движения средств (касса)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.finance_transactions (
    id          SERIAL PRIMARY KEY,
    -- 'income' | 'expense' | 'collection'
    kind        VARCHAR(20)  NOT NULL,
    type_id     INTEGER REFERENCES t_p72635010_quantum_fusion_resea.finance_types(id),
    amount      NUMERIC(12,2) NOT NULL,
    note        TEXT,
    -- влияет ли на P&L (прибыль). collection (инкассация) — FALSE
    affects_pnl BOOLEAN      NOT NULL DEFAULT TRUE,
    user_id     INTEGER REFERENCES t_p72635010_quantum_fusion_resea.users(id),
    occurred_at TIMESTAMP    NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fin_tx_occurred ON t_p72635010_quantum_fusion_resea.finance_transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_tx_kind ON t_p72635010_quantum_fusion_resea.finance_transactions(kind);

-- Системные типы по умолчанию
INSERT INTO t_p72635010_quantum_fusion_resea.finance_types (name, direction, is_system, sort_order) VALUES
    ('Расходы на офис',   'expense',    TRUE, 10),
    ('Расходы на товары', 'expense',    TRUE, 20),
    ('Зарплата',          'expense',    TRUE, 30),
    ('Чаевые',            'income',     TRUE, 10),
    ('Оказание услуги',   'income',     TRUE, 20),
    ('Инкассация в офис', 'collection', TRUE, 10);
