-- Снимаем зависшие резервы отменённого заказа #38
-- qty_reserved: supply_id=13, qty=4
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = qty + 4, qty_reserved = GREATEST(0, qty_reserved - 4)
WHERE id = 13;

INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_movements
  (group_id, supply_id, order_id, type, qty_delta, note, created_at)
VALUES (3, 13, 38, 'unreserved', -4, 'Снят резерв при отмене заказа #38 (ручная корректировка)', NOW());

-- qty_negative: снимаем по всем поставкам
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies SET qty_negative = 0 WHERE id IN (9,6,5,11,4,10);
