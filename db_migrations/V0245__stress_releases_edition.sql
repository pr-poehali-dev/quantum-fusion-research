-- Полная и Lite-сборка — это одна версия программы, а не два разных релиза.
-- Номер версии храним очищенным ("1.0.6.0"), а признак сборки — отдельно.
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_app_releases
    ADD COLUMN IF NOT EXISTS edition TEXT NOT NULL DEFAULT 'full';

-- Уже добавленные записи: Lite узнаём по названию версии или имени файла.
UPDATE t_p72635010_quantum_fusion_resea.stress_app_releases
SET edition = 'lite'
WHERE version ILIKE '%lite%' OR file_name ILIKE '%lite%';

-- Чистим номер версии от слов "Lite"/"v" — по нему идёт сверка сборок.
UPDATE t_p72635010_quantum_fusion_resea.stress_app_releases
SET version = btrim(regexp_replace(regexp_replace(version, '(?i)(lite|light|full)', '', 'g'),
                                   '^[vV]?[\s._-]*', ''), ' -_.');

CREATE INDEX IF NOT EXISTS idx_stress_app_releases_version
    ON t_p72635010_quantum_fusion_resea.stress_app_releases (version);
