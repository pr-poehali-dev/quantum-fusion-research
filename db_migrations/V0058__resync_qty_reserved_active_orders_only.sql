-- Пересчитываем qty_reserved по активным заказам и восстанавливаем qty
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET
  qty = (s.qty + s.qty_reserved) - COALESCE(real.real_reserved, 0),
  qty_reserved = COALESCE(real.real_reserved, 0)
FROM (
  SELECT m.supply_id, GREATEST(0, SUM(m.qty_delta)) AS real_reserved
  FROM t_p72635010_quantum_fusion_resea.warehouse_movements m
  JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = m.order_id
  WHERE m.type IN ('reserved', 'unreserved')
    AND o.status NOT IN ('cancelled', 'done')
  GROUP BY m.supply_id
) real
WHERE s.id = real.supply_id
  AND s.qty_reserved != COALESCE(real.real_reserved, 0);

-- Поставки с qty_reserved > 0 но без активных заказов — сбрасываем
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty = qty + qty_reserved, qty_reserved = 0
WHERE s.qty_reserved > 0
  AND s.id NOT IN (
    SELECT DISTINCT m.supply_id
    FROM t_p72635010_quantum_fusion_resea.warehouse_movements m
    JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = m.order_id
    WHERE m.type IN ('reserved','unreserved')
      AND o.status NOT IN ('cancelled','done')
      AND m.supply_id IS NOT NULL
  );
