ALTER TABLE t_p72635010_quantum_fusion_resea.user_builds
    ADD COLUMN IF NOT EXISTS short_code VARCHAR(16);

-- Генерируем 6-символьные коды для существующих сборок (алфавит без похожих символов).
WITH alphabet AS (
    SELECT 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789' AS chars
),
gen AS (
    SELECT b.id,
           string_agg(
               substr(a.chars, 1 + floor(random() * length(a.chars))::int, 1),
               ''
           ) AS code
    FROM t_p72635010_quantum_fusion_resea.user_builds b
    CROSS JOIN alphabet a
    CROSS JOIN generate_series(1, 6) gs
    WHERE b.short_code IS NULL
    GROUP BY b.id
)
UPDATE t_p72635010_quantum_fusion_resea.user_builds ub
SET short_code = gen.code
FROM gen
WHERE ub.id = gen.id AND ub.short_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_builds_short_code
    ON t_p72635010_quantum_fusion_resea.user_builds(short_code);
