-- White-label брендинг PDF-отчётов партнёра (brand pack для StressRunner).

-- UUID партнёра: в brand pack partner_id обязан быть UUID (спека v1).
ALTER TABLE t_p72635010_quantum_fusion_resea.partner_companies
    ADD COLUMN IF NOT EXISTS public_uid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE t_p72635010_quantum_fusion_resea.partner_companies
    ADD COLUMN IF NOT EXISTS white_label_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.partner_brands (
    company_id       INTEGER PRIMARY KEY,
    brand_key        TEXT NOT NULL DEFAULT '',
    logo_base64      TEXT NOT NULL DEFAULT '',
    links            JSONB NOT NULL DEFAULT '[]'::jsonb,
    qr_url_template  TEXT NOT NULL DEFAULT '',
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 year'),
    revoked_at       TIMESTAMPTZ NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс verify-кодов: считаем HMAC при ingest, чтобы страница /v/{code}
-- находила прогон сразу, без перебора.
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_runs
    ADD COLUMN IF NOT EXISTS verify_code TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS stress_runs_verify_code_idx
    ON t_p72635010_quantum_fusion_resea.stress_runs (verify_code);
