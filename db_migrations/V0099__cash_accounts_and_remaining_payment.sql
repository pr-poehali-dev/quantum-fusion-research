-- Счета зачисления (касса, Авито, терминал) + поля оплаты остатка
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.cash_accounts (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    name VARCHAR(120) NOT NULL,
    color VARCHAR(20) DEFAULT '#22c55e',
    balance NUMERIC(14,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 100,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.cash_account_tx (
    id SERIAL PRIMARY KEY,
    cash_account_id INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.cash_accounts(id),
    amount NUMERIC(14,2) NOT NULL,
    note TEXT,
    order_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_tx_account ON t_p72635010_quantum_fusion_resea.cash_account_tx(cash_account_id);

ALTER TABLE t_p72635010_quantum_fusion_resea.finance_transactions ADD COLUMN IF NOT EXISTS cash_account_id INTEGER;

ALTER TABLE t_p72635010_quantum_fusion_resea.orders ADD COLUMN IF NOT EXISTS remaining_paid BOOLEAN DEFAULT FALSE;
ALTER TABLE t_p72635010_quantum_fusion_resea.orders ADD COLUMN IF NOT EXISTS remaining_paid_amount NUMERIC(14,2) DEFAULT 0;

INSERT INTO t_p72635010_quantum_fusion_resea.cash_accounts (code, name, color, sort_order) VALUES
    ('cash',     'Наличные (касса)', '#22c55e', 1),
    ('avito',    'Авито',            '#10b981', 2),
    ('terminal', 'Терминал',         '#3b82f6', 3)
ON CONFLICT (code) DO NOTHING;
