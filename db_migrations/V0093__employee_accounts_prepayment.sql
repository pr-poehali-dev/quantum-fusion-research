-- Счета сотрудников + подтверждение предоплаты

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.employee_accounts (
    employee_id INTEGER PRIMARY KEY
        REFERENCES t_p72635010_quantum_fusion_resea.employees(id),
    balance     NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.employee_account_tx (
    id          SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL
        REFERENCES t_p72635010_quantum_fusion_resea.employees(id),
    amount      NUMERIC(12,2) NOT NULL,
    note        TEXT,
    order_id    INTEGER,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_acc_tx_emp
    ON t_p72635010_quantum_fusion_resea.employee_account_tx(employee_id);

INSERT INTO t_p72635010_quantum_fusion_resea.employee_accounts (employee_id, balance)
SELECT id, 0 FROM t_p72635010_quantum_fusion_resea.employees
ON CONFLICT (employee_id) DO NOTHING;

ALTER TABLE t_p72635010_quantum_fusion_resea.orders
    ADD COLUMN IF NOT EXISTS prepayment_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE t_p72635010_quantum_fusion_resea.finance_transactions
    ADD COLUMN IF NOT EXISTS employee_id INTEGER,
    ADD COLUMN IF NOT EXISTS order_id INTEGER;

INSERT INTO t_p72635010_quantum_fusion_resea.finance_types (name, direction, is_system, sort_order)
SELECT 'Предоплата', 'income', TRUE, 5
WHERE NOT EXISTS (
    SELECT 1 FROM t_p72635010_quantum_fusion_resea.finance_types WHERE name = 'Предоплата'
);
