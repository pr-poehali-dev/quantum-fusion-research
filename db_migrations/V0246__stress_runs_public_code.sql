-- Публичная короткая ссылка на отчёт: /tests/<код>.
-- Нужна КАЖДОМУ прогону, а не только партнёрскому (verify_code считается
-- по brand_key партнёра и у наших прогонов пустой).
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_runs
    ADD COLUMN IF NOT EXISTS public_code VARCHAR(16);

-- Коды для уже накопленных прогонов. Алфавит без похожих символов
-- (нет 0/O, 1/l/I), длина 6 — как у ссылок на сборки.
WITH alphabet AS (
    SELECT 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789' AS chars
),
gen AS (
    SELECT r.id,
           string_agg(
               substr(a.chars, 1 + floor(random() * length(a.chars))::int, 1),
               ''
           ) AS code
    FROM t_p72635010_quantum_fusion_resea.stress_runs r
    CROSS JOIN alphabet a
    CROSS JOIN generate_series(1, 6) gs
    WHERE r.public_code IS NULL
    GROUP BY r.id
)
UPDATE t_p72635010_quantum_fusion_resea.stress_runs sr
SET public_code = gen.code
FROM gen
WHERE sr.id = gen.id AND sr.public_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stress_runs_public_code
    ON t_p72635010_quantum_fusion_resea.stress_runs (public_code);
