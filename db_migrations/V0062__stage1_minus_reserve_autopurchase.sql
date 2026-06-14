CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.warehouse_reserves (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.orders(id),
    group_id    INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.warehouse_groups(id),
    supply_id   INTEGER REFERENCES t_p72635010_quantum_fusion_resea.warehouse_supplies(id),
    slot        VARCHAR(50),
    qty         INTEGER NOT NULL,
    type        VARCHAR(10) NOT NULL CHECK (type IN ('POSITIVE','NEGATIVE')),
    status      VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FULFILLED','RELEASED')),
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wh_reserves_order ON t_p72635010_quantum_fusion_resea.warehouse_reserves(order_id);
CREATE INDEX IF NOT EXISTS idx_wh_reserves_group ON t_p72635010_quantum_fusion_resea.warehouse_reserves(group_id, status);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.warehouse_purchase_basket (
    id            SERIAL PRIMARY KEY,
    group_id      INTEGER NOT NULL UNIQUE REFERENCES t_p72635010_quantum_fusion_resea.warehouse_groups(id),
    required_qty  INTEGER NOT NULL DEFAULT 0,
    status        VARCHAR(12) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','ORDERED','RECEIVED')),
    note          TEXT,
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wh_basket_status ON t_p72635010_quantum_fusion_resea.warehouse_purchase_basket(status);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.warehouse_stock_log (
    id          SERIAL PRIMARY KEY,
    group_id    INTEGER,
    order_id    INTEGER,
    event       VARCHAR(40) NOT NULL,
    delta       INTEGER,
    payload     JSONB,
    created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wh_stocklog_created ON t_p72635010_quantum_fusion_resea.warehouse_stock_log(created_at);
CREATE INDEX IF NOT EXISTS idx_wh_stocklog_group ON t_p72635010_quantum_fusion_resea.warehouse_stock_log(group_id);
