-- Перепривязка двух "висящих" POSITIVE-резервов заказа #362 (Сборка PC00003)
-- на партии той же группы, где реально есть свободный товар (FIFO).
-- Раньше резервы указывали на опустевшие партии (551/533), хотя товар лежит
-- на других партиях группы. Переносим резерв + двигаем счётчики партий.

-- group 63: резерв 612 -> партия 520 (FIFO, qty=5)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = qty - 1, qty_reserved = qty_reserved + 1, updated_at = NOW()
WHERE id = 520;
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET supply_id = 520, updated_at = NOW()
WHERE id = 612 AND status='ACTIVE';

-- group 64: резерв 610 -> партия 2 (FIFO, qty=2)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = qty - 1, qty_reserved = qty_reserved + 1, updated_at = NOW()
WHERE id = 2;
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET supply_id = 2, updated_at = NOW()
WHERE id = 610 AND status='ACTIVE';
