-- Папки для группировки прогонов стресс-тестов
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_folders (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Новая папка',
    order_id INTEGER NULL,          -- номинальная привязка к заказу/партии (orders.id)
    order_ref TEXT NOT NULL DEFAULT '',  -- денормализованный номер заказа для показа
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Привязка прогона к папке (NULL = без папки)
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_runs
    ADD COLUMN IF NOT EXISTS folder_id INTEGER NULL;

CREATE INDEX IF NOT EXISTS idx_stress_runs_folder
    ON t_p72635010_quantum_fusion_resea.stress_runs (folder_id);