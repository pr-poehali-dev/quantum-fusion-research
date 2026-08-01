-- Ссылки на соцсети партнёра (по одной на строку), редактирует сам партнёр в ЛК
ALTER TABLE t_p72635010_quantum_fusion_resea.partner_companies
    ADD COLUMN IF NOT EXISTS social_links TEXT NOT NULL DEFAULT '';