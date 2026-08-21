-- Уровень публичного доступа профиля для гостей StressRunner:
--   none — не показываем гостям (по умолчанию);
--   lite — доступен и в облегчённой сборке (часть тестов там отсутствует);
--   full — только в полной сборке.
-- Полная сборка получает и lite-, и full-профили; lite — только lite.
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_profiles
    ADD COLUMN IF NOT EXISTS public_level TEXT NOT NULL DEFAULT 'none';

-- Уже отмеченные публичными профили считаем доступными полной сборке.
UPDATE t_p72635010_quantum_fusion_resea.stress_profiles
SET public_level = 'full'
WHERE is_public AND public_level = 'none';

CREATE INDEX IF NOT EXISTS idx_stress_profiles_public_level
    ON t_p72635010_quantum_fusion_resea.stress_profiles (public_level)
    WHERE public_level <> 'none';
