-- Предупреждения об обслуживании GPU (перегрев Hot Spot / памяти) сохраняем
-- вместе с прогоном. Раньше программа их присылала, но сайт использовал их
-- только для Telegram-уведомления — в отчётах и карточке прогона они пропадали.
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_runs
  ADD COLUMN IF NOT EXISTS gpu_maintenance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gpu_issues JSONB,
  ADD COLUMN IF NOT EXISTS gpu_issue_codes JSONB;

-- Быстрый отбор прогонов, где GPU просит обслуживания.
CREATE INDEX IF NOT EXISTS stress_runs_gpu_maint_idx
  ON t_p72635010_quantum_fusion_resea.stress_runs (created_at DESC)
  WHERE gpu_maintenance;
