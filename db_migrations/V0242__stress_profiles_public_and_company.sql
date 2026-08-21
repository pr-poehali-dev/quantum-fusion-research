-- Профили стресс-тестов: гостевой канал (без пароля) и привязка к компании.
-- is_public — профиль виден гостю EXE (scope=guest), по умолчанию нет.
-- company_id — владелец профиля (партнёр); NULL = наш/общий профиль.
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_profiles
    ADD COLUMN IF NOT EXISTS is_public  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_stress_profiles_public
    ON t_p72635010_quantum_fusion_resea.stress_profiles (is_public)
    WHERE is_public;
CREATE INDEX IF NOT EXISTS idx_stress_profiles_company
    ON t_p72635010_quantum_fusion_resea.stress_profiles (company_id);

-- Имя профиля уникально в пределах владельца: upsert по имени при заливке пака.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stress_profiles_owner_name
    ON t_p72635010_quantum_fusion_resea.stress_profiles
    (COALESCE(company_id, 0), lower(name));
