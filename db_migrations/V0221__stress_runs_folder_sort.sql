-- Ручной порядок прогонов внутри папки (drag&drop). Определяет порядок страниц в отчёте.
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_runs
    ADD COLUMN IF NOT EXISTS folder_sort INTEGER NOT NULL DEFAULT 0;

-- Инициализация: внутри каждой папки задаём порядок по дате создания (новые выше),
-- чтобы существующие папки не «схлопнулись» в одинаковый 0.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY folder_id ORDER BY created_at DESC) AS rn
  FROM t_p72635010_quantum_fusion_resea.stress_runs
  WHERE folder_id IS NOT NULL
)
UPDATE t_p72635010_quantum_fusion_resea.stress_runs sr
SET folder_sort = ranked.rn
FROM ranked
WHERE sr.id = ranked.id;