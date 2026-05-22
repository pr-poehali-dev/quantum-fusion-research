-- Сброс зависших резервов: нет ни одного активного заказа,
-- поэтому qty_reserved и qty_negative должны быть 0,
-- а qty восстанавливается (qty + qty_reserved)

UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET
  qty = qty + qty_reserved,
  qty_reserved = 0,
  qty_negative = 0
WHERE qty_reserved > 0 OR qty_negative > 0;
