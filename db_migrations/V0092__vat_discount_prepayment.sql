-- ── НДС, скидка на покупку, предоплата ──────────────────────────────────────

-- Глобальные настройки (key-value)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.app_settings (
    key         VARCHAR(60) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Значения по умолчанию
INSERT INTO t_p72635010_quantum_fusion_resea.app_settings (key, value) VALUES
    ('purchase_discount_percent', '0'),   -- % скидки на покупку
    ('default_prepayment_percent', '30')  -- % предоплаты по умолчанию
ON CONFLICT (key) DO NOTHING;

-- Приёмка: пометка «товар с НДС» и исходная цена с НДС (до скидки)
ALTER TABLE t_p72635010_quantum_fusion_resea.warehouse_supplies
    ADD COLUMN IF NOT EXISTS has_vat BOOLEAN,                 -- NULL = не указано; обяз. выбор на фронте
    ADD COLUMN IF NOT EXISTS price_with_vat NUMERIC(12,2);    -- введённая менеджером цена с НДС

-- Сборки: продажа с НДС
ALTER TABLE t_p72635010_quantum_fusion_resea.pc_builds
    ADD COLUMN IF NOT EXISTS sell_with_vat BOOLEAN NOT NULL DEFAULT FALSE;

-- Заказы: предоплата
ALTER TABLE t_p72635010_quantum_fusion_resea.orders
    ADD COLUMN IF NOT EXISTS prepayment_percent NUMERIC(5,2) DEFAULT 30,
    ADD COLUMN IF NOT EXISTS prepayment_amount NUMERIC(12,2);
