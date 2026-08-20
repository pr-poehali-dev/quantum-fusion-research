-- Публичная ссылка на файл (Яндекс.Диск и т.п.). Прямая ссылка Яндекса
-- живёт недолго, поэтому храним исходную и получаем свежую при скачивании.
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_app_releases
    ADD COLUMN IF NOT EXISTS source_link TEXT NOT NULL DEFAULT '';
