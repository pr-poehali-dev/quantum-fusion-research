-- Журнал отправленных уведомлений о задержке железа.
-- Гарантирует РОВНО ОДНО уведомление на событие (wip_id + slot + eta_date),
-- даже при повторных открытиях корзины или повторных тестовых вызовах.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.wip_delay_notified (
    wip_id    INTEGER NOT NULL,
    slot      TEXT    NOT NULL,
    eta_date  DATE    NOT NULL,
    sent_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (wip_id, slot, eta_date)
);