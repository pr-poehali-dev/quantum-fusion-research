-- ОЗУ: group 11, buffer supply 239 → NEGATIVE-резерв + корзина
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_reserves
  (order_id, group_id, supply_id, slot, qty, type, status)
  VALUES (176, 11, 239, 'ram', 1, 'NEGATIVE', 'ACTIVE');
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_purchase_basket (group_id, required_qty, status)
  VALUES (11, 1, 'NEW')
  ON CONFLICT (group_id) DO UPDATE SET
    required_qty = t_p72635010_quantum_fusion_resea.warehouse_purchase_basket.required_qty + 1,
    updated_at = NOW();

-- КОРПУС: group 85, buffer supply 21 (store_id NULL) → NEGATIVE-резерв + корзина
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty_negative = qty_negative + 1, updated_at = NOW() WHERE id = 21;
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_reserves
  (order_id, group_id, supply_id, slot, qty, type, status)
  VALUES (176, 85, 21, 'case', 1, 'NEGATIVE', 'ACTIVE');
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_purchase_basket (group_id, required_qty, status)
  VALUES (85, 1, 'NEW')
  ON CONFLICT (group_id) DO UPDATE SET
    required_qty = t_p72635010_quantum_fusion_resea.warehouse_purchase_basket.required_qty + 1,
    updated_at = NOW();