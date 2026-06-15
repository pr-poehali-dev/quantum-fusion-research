-- ETA (ожидаемая дата прихода) по каждой железке конкретной сборки.
-- Дата индивидуальна для пары (wip_id, slot), чтобы одинаковые товары
-- в разных заказах имели независимые сроки.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.wip_component_eta (
    id          SERIAL PRIMARY KEY,
    wip_id      INTEGER NOT NULL,
    slot        VARCHAR(50) NOT NULL,
    eta_date    DATE,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE (wip_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_wip_component_eta_wip
    ON t_p72635010_quantum_fusion_resea.wip_component_eta (wip_id);