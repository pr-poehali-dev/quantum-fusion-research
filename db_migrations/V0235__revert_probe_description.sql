-- Откат тестовой пометки, оставленной при диагностике сохранения сборок.
UPDATE t_p72635010_quantum_fusion_resea.pc_builds
SET description = NULL
WHERE id = 167 AND description = '__probe__';