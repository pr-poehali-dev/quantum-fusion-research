-- Brand pack v2: прямая ссылка на логотип и адрес страницы проверки.
-- logo_url позволяет не тащить большой PNG внутри пака,
-- verify_page_url — базовый адрес страницы /v.
ALTER TABLE t_p72635010_quantum_fusion_resea.partner_brands
    ADD COLUMN IF NOT EXISTS logo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE t_p72635010_quantum_fusion_resea.partner_brands
    ADD COLUMN IF NOT EXISTS verify_page_url TEXT NOT NULL DEFAULT '';
