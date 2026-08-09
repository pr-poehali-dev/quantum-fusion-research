ALTER TABLE t_p72635010_quantum_fusion_resea.order_build_groups
  ADD COLUMN IF NOT EXISTS wants_assembly boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assembly_fee numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN t_p72635010_quantum_fusion_resea.order_build_groups.wants_assembly IS
  'Нужна ли профессиональная сборка BeGraphics для этого варианта партии (аналог wantAssembly в Конфигураторе)';
COMMENT ON COLUMN t_p72635010_quantum_fusion_resea.order_build_groups.assembly_fee IS
  'Оплата за сборку ЗА 1 ПК варианта (7% от parts_total, как в Актуальных сборках). Уже включена в total_price.';
