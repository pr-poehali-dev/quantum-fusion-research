-- Заказ 193: все компоненты ready, но этап завис на «Ожидание железа»
-- (приёмка через UI склада не пересчитывала этап до фикса). Переводим вручную.
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET stage = 'Ожидание сборки', updated_at = NOW()
WHERE order_id = 193 AND stage = 'Ожидание железа';

UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'waiting_assembly', updated_at = NOW()
WHERE id = 193;