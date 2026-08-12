ALTER TABLE t_p72635010_quantum_fusion_resea.order_build_groups
  ADD COLUMN IF NOT EXISTS assembly_type varchar(20) NOT NULL DEFAULT 'percent';

COMMENT ON COLUMN t_p72635010_quantum_fusion_resea.order_build_groups.assembly_type IS
  'percent — assembly_fee считается автоматически (7% от parts_total); manual — задана вручную менеджером и не пересчитывается';
