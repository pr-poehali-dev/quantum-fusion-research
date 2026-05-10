ALTER TABLE t_p72635010_quantum_fusion_resea.wip_builds
  ADD COLUMN IF NOT EXISTS client_token VARCHAR(64),
  ADD COLUMN IF NOT EXISTS build_id INT;