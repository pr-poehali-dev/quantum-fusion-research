ALTER TABLE t_p72635010_quantum_fusion_resea.pc_builds
ADD COLUMN IF NOT EXISTS lock_prices BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN t_p72635010_quantum_fusion_resea.pc_builds.lock_prices IS
'Если TRUE — цены комплектующих зафиксированы (используется components.price). Если FALSE (по умолчанию) — цены синхронизируются с каталогом (current_price).';