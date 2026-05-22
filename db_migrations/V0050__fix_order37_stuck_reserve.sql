-- Снимаем зависший резерв заказа #37 (supply_id=13, qty=1)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = qty + 1, qty_reserved = GREATEST(0, qty_reserved - 1)
WHERE id = 13;

INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_movements
  (group_id, supply_id, order_id, type, qty_delta, note, created_at)
VALUES
  (3, 13, 37, 'unreserved', -1, 'Снят резерв при отмене заказа #37 (ручная корректировка)', NOW());
