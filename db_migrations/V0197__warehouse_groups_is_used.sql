-- Б/У складская ячейка (группа): отдельная позиция для бывшего в употреблении товара.
-- Для Б/У приёмки создаётся своя группа + своя карточка товара, партия идёт в эту группу.
ALTER TABLE t_p72635010_quantum_fusion_resea.warehouse_groups
  ADD COLUMN IF NOT EXISTS is_used BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN t_p72635010_quantum_fusion_resea.warehouse_groups.is_used
  IS 'Группа-ячейка Б/У (бывший в употреблении экземпляр). Показывается на складе с бейджем Б/У.';