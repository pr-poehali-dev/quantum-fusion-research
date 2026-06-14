-- Синхронизация статусов заказов со стадиями wip_builds
-- Привязка: orders.id = wip_builds.order_number::int (через LPAD)
-- Заказы где wip = "Отменён" → status = 'cancelled'
UPDATE t_p72635010_quantum_fusion_resea.orders o
SET status = 'cancelled', updated_at = NOW()
WHERE o.id IN (
    SELECT o2.id
    FROM t_p72635010_quantum_fusion_resea.orders o2
    JOIN t_p72635010_quantum_fusion_resea.wip_builds wb
      ON LPAD(o2.id::text, 5, '0') = wb.order_number
    WHERE wb.stage = 'Отменён'
      AND o2.status NOT IN ('cancelled', 'done')
);
