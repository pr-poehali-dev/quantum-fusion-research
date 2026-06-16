-- Заказ 194 выдан клиенту (status='done'), но 8 POSITIVE-резервов остались
-- ACTIVE и висели в qty_reserved (до фикса fulfill_order_reserves). Списываем
-- их по логике выдачи: qty_reserved -= qty, qty НЕ меняем (товар ушёл клиенту),
-- резервы → FULFILLED.

-- Уменьшаем qty_reserved в партиях на величину POSITIVE-резервов заказа 194
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_reserved = GREATEST(0, s.qty_reserved - sub.q), updated_at = NOW()
FROM (
  SELECT supply_id, SUM(qty) AS q
  FROM t_p72635010_quantum_fusion_resea.warehouse_reserves
  WHERE order_id = 194 AND status = 'ACTIVE' AND type = 'POSITIVE'
  GROUP BY supply_id
) sub
WHERE s.id = sub.supply_id;

-- Закрываем резервы заказа 194 как FULFILLED
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'FULFILLED', updated_at = NOW()
WHERE order_id = 194 AND status = 'ACTIVE';

-- Лог выдачи
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_stock_log (group_id, order_id, event, delta, payload)
VALUES (NULL, 194, 'fulfill_order', 8, '{"manual_fix": true, "reason": "Списание резервов выданного заказа #194"}'::jsonb);