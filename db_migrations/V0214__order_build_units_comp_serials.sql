-- Серийники комплектующих по каждому ПК партии: map slot -> серийный номер.
-- Один серийник на компонент-позицию (qty>1 всё равно одно поле).
ALTER TABLE t_p72635010_quantum_fusion_resea.order_build_units
  ADD COLUMN IF NOT EXISTS comp_serials JSONB NOT NULL DEFAULT '{}'::jsonb;
