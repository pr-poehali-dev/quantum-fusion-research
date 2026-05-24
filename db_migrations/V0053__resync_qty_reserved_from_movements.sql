-- Пересчитываем qty_reserved для всех поставок через реальные активные движения
-- qty_reserved = сумма (reserved - unreserved) по активным заказам
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_reserved = COALESCE((
    SELECT GREATEST(0, SUM(m.qty_delta))
    FROM t_p72635010_quantum_fusion_resea.warehouse_movements m
    JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = m.order_id
    WHERE m.supply_id = s.id
      AND m.type IN ('reserved', 'unreserved')
      AND o.status NOT IN ('cancelled', 'done')
), 0)
WHERE s.qty_reserved > 0;
