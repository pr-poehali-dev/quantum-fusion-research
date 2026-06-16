-- Воспроизведение боевой логики reserve_line() для тестового заказа 176.
-- Все 3 позиции в дефиците (free<=0) → создаём NEGATIVE-резервы, наращиваем
-- qty_negative в буфер-партиях (store_id IS NULL) и пополняем корзину закупки.

-- ОХЛАД: group 9, buffer supply 9
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty_negative = qty_negative + 1, updated_at = NOW() WHERE id = 9;
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_reserves
  (order_id, group_id, supply_id, slot, qty, type, status)
  VALUES (176, 9, 9, 'cooling', 1, 'NEGATIVE', 'ACTIVE');
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_purchase_basket (group_id, required_qty, status)
  VALUES (9, 1, 'NEW')
  ON CONFLICT (group_id) DO UPDATE SET
    required_qty = t_p72635010_quantum_fusion_resea.warehouse_purchase_basket.required_qty + 1,
    updated_at = NOW();

-- ОЗУ: group 11 — буфер-партии нет, создаём (store_id NULL)
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_supplies
  (group_id, store_id, qty, qty_reserved, qty_negative, cost_price)
  VALUES (11, NULL, 0, 0, 1, 0)
  RETURNING id;