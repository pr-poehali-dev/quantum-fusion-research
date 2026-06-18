-- Настраиваемая ставка НДС (для расчёта себестоимости при приёмке)
INSERT INTO t_p72635010_quantum_fusion_resea.app_settings (key, value) VALUES
    ('vat_percent', '20')
ON CONFLICT (key) DO NOTHING;

-- finance_transactions: поля для обобщения авто-расходов закупки
-- по дню + магазину. auto_supply=TRUE — авто-расход от приёмки товара.
ALTER TABLE t_p72635010_quantum_fusion_resea.finance_transactions
    ADD COLUMN IF NOT EXISTS store_id INTEGER,
    ADD COLUMN IF NOT EXISTS expense_date DATE,
    ADD COLUMN IF NOT EXISTS auto_supply BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS supply_count INTEGER NOT NULL DEFAULT 0;

-- Индекс для быстрого поиска агрегата по дню+магазину
CREATE INDEX IF NOT EXISTS idx_fintx_auto_supply
    ON t_p72635010_quantum_fusion_resea.finance_transactions(expense_date, store_id)
    WHERE auto_supply = TRUE;
