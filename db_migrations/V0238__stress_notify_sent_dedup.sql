-- Журнал отправленных Telegram-уведомлений стресс-тестов.
-- Нужен, чтобы одно и то же сообщение не ушло в чат дважды
-- (десктоп шлёт итог и через ingest, и через notify).
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_notify_sent (
    id         BIGSERIAL PRIMARY KEY,
    chat_id    TEXT NOT NULL,
    dedup_hash TEXT NOT NULL,
    event      TEXT NOT NULL DEFAULT '',
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS stress_notify_sent_uniq
    ON t_p72635010_quantum_fusion_resea.stress_notify_sent (chat_id, dedup_hash);
CREATE INDEX IF NOT EXISTS stress_notify_sent_time_idx
    ON t_p72635010_quantum_fusion_resea.stress_notify_sent (sent_at);
