-- Пересчёт qty и qty_reserved по активным заказам для всех поставок
-- Новая логика: qty = физический остаток (без зарезервированных), qty_reserved = сколько в резерве
-- При резерве qty уменьшается, qty_reserved растёт

-- Для каждой поставки считаем сумму активных резервов (по движениям, только незакрытые заказы)
-- и приводим qty к виду: qty = qty_original - net_reserved
-- где qty_original = qty + qty_reserved (восстанавливаем из текущего состояния по старой логике)

UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET
  qty = (s.qty + s.qty_reserved) - COALESCE(net.net_reserved, 0),
  qty_reserved = COALESCE(net.net_reserved, 0)
FROM (
  SELECT
    m.supply_id,
    GREATEST(0, SUM(m.qty_delta)) AS net_reserved
  FROM t_p72635010_quantum_fusion_resea.warehouse_movements m
  JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = m.order_id
  WHERE m.type IN ('reserved', 'unreserved')
    AND o.status NOT IN ('cancelled', 'done')
  GROUP BY m.supply_id
) net
WHERE s.id = net.supply_id;
