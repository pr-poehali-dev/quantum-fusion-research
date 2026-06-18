-- Фикс зависших резервов: ACTIVE-резервы на завершённых/отменённых заказах
-- держали qty_reserved на партиях, завышая резерв в превью склада.

-- 1) Снимаем qty_reserved с партий, на которых висят зависшие POSITIVE-резервы
--    завершённых (done) заказов (товар уже выдан клиенту).
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_reserved = GREATEST(0, s.qty_reserved - sub.qty_sum),
    updated_at = NOW()
FROM (
    SELECT r.supply_id, SUM(r.qty) AS qty_sum
    FROM t_p72635010_quantum_fusion_resea.warehouse_reserves r
    JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = r.order_id
    WHERE r.status = 'ACTIVE' AND r.type = 'POSITIVE'
      AND o.status = 'done' AND r.supply_id IS NOT NULL
    GROUP BY r.supply_id
) sub
WHERE s.id = sub.supply_id;

-- 2) Закрываем сами зависшие резервы: done -> FULFILLED, cancelled -> RELEASED
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves r
SET status = CASE WHEN o.status = 'cancelled' THEN 'RELEASED' ELSE 'FULFILLED' END,
    updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.orders o
WHERE r.order_id = o.id AND r.status = 'ACTIVE'
  AND o.status IN ('done', 'cancelled');
