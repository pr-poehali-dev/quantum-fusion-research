CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.basket_purchase_notified (
    notify_date DATE PRIMARY KEY,
    notified_at TIMESTAMP NOT NULL DEFAULT NOW(),
    positions INTEGER NOT NULL DEFAULT 0
);