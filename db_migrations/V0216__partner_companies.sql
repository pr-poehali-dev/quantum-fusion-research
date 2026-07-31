-- Партнёрские компании (доступ к B2B без пароля и/или ЛК стресс-тестов)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.partner_companies (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    tier TEXT NOT NULL DEFAULT 'basic',            -- basic | close | paid
    status TEXT NOT NULL DEFAULT 'active',          -- active | suspended
    trial_ends_at TIMESTAMPTZ NULL,                 -- окно полного доступа (триал)
    stress_ingest_token TEXT NOT NULL DEFAULT '',   -- токен для EXE (вводится вручную)
    -- Реквизиты для брендинга отчётов
    contact_name TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Уникальность ingest-токена (кроме пустых)
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_companies_token
    ON t_p72635010_quantum_fusion_resea.partner_companies (stress_ingest_token)
    WHERE stress_ingest_token <> '';

-- Привязка пользователя сайта к компании (несколько юзеров на компанию)
ALTER TABLE t_p72635010_quantum_fusion_resea.users
    ADD COLUMN IF NOT EXISTS partner_company_id INTEGER NULL;
CREATE INDEX IF NOT EXISTS idx_users_partner_company
    ON t_p72635010_quantum_fusion_resea.users (partner_company_id);

-- Привязка прогона стресс-теста к компании (по ingest-токену компании)
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_runs
    ADD COLUMN IF NOT EXISTS partner_company_id INTEGER NULL;
CREATE INDEX IF NOT EXISTS idx_stress_runs_partner_company
    ON t_p72635010_quantum_fusion_resea.stress_runs (partner_company_id);