-- Splash-экран партнёра (загрузочный экран 720×720 в StressRunner при старте).
-- НЕ входит в RSA-подпись v1 канона (см. docs) — можно менять/докачивать без
-- перевыпуска pack.stbrand. Хранится тем же способом, что и logo: inline PNG
-- base64 (для офлайна) + прямая ссылка (для докачки по сети).
ALTER TABLE t_p72635010_quantum_fusion_resea.partner_brands
    ADD COLUMN IF NOT EXISTS splash_base64 TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS splash_url TEXT NOT NULL DEFAULT '';
