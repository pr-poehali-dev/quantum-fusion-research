CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.telegram_link_codes (
    code VARCHAR(8) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
    used BOOLEAN NOT NULL DEFAULT FALSE
);