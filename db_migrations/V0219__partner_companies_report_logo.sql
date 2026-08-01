-- Логотип партнёра для правого верхнего угла его отчётов стресс-тестов
ALTER TABLE t_p72635010_quantum_fusion_resea.partner_companies
    ADD COLUMN IF NOT EXISTS report_logo_url TEXT NOT NULL DEFAULT '';