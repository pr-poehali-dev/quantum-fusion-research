-- Чистка задвоенных резервов заказа #229.
-- Снимаем все активные NEGATIVE-резервы заказа и возвращаем qty_negative на складе,
-- чтобы затем пересоздать резервы через sync_order корректно.

-- 1. Уменьшаем qty_negative по каждой партии на сумму снимаемых резервов заказа 229
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_negative = GREATEST(0, s.qty_negative - agg.total_qty),
    updated_at = NOW()
FROM (
  SELECT supply_id, SUM(qty) AS total_qty
  FROM t_p72635010_quantum_fusion_resea.warehouse_reserves
  WHERE order_id = 229 AND type = 'NEGATIVE' AND status = 'ACTIVE' AND supply_id IS NOT NULL
  GROUP BY supply_id
) agg
WHERE s.id = agg.supply_id;

-- 2. Помечаем эти резервы как RELEASED
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'RELEASED', updated_at = NOW()
WHERE order_id = 229 AND type = 'NEGATIVE' AND status = 'ACTIVE';