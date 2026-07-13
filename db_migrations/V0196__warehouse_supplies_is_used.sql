-- Пометка Б/У на партии приёмки: помечает конкретную поставку как бывшую в употреблении.
-- Товар остаётся в исходной группе склада, но партия отмечена как Б/У.
ALTER TABLE t_p72635010_quantum_fusion_resea.warehouse_supplies
  ADD COLUMN IF NOT EXISTS is_used BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN t_p72635010_quantum_fusion_resea.warehouse_supplies.is_used
  IS 'Партия принята как Б/У (бывшая в употреблении). Для такой приёмки создаётся отдельная карточка товара для сайта.';