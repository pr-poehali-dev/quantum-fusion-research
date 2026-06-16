-- Ручная починка заказа 142: партия 238 (KFA2 RTX 5070 Ti, group 12) пришла,
-- но из-за бага приёмки резерв не поставился, gpu_status остался ordered_transit,
-- корзина осталась ORDERED. Привязываем 1 шт под заказ 142.

-- 1) POSITIVE-резерв 1 шт на заказ 142 из партии 238
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_reserves
    (order_id, group_id, supply_id, slot, qty, type, status)
VALUES (142, 12, 238, 'gpu', 1, 'POSITIVE', 'ACTIVE');

-- 2) Списываем 1 шт из свободного остатка партии в резерв
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = qty - 1, qty_reserved = qty_reserved + 1, updated_at = NOW()
WHERE id = 238;

-- 3) WIP-сборка заказа 142: видеокарта получена
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET gpu_status = 'ready', updated_at = NOW()
WHERE order_id = 142;

-- 4) Обнуляем ETA по слоту gpu (статус ready перекрывает «едет»)
UPDATE t_p72635010_quantum_fusion_resea.wip_component_eta
SET eta_date = NULL, updated_at = NOW()
WHERE wip_id = 26 AND slot = 'gpu';

-- 5) Корзина закупки по группе 12 → получено
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket
SET status = 'RECEIVED', updated_at = NOW()
WHERE group_id = 12;

-- 6) Лог движения
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_movements
    (group_id, supply_id, order_id, type, qty_delta, note, created_at)
VALUES (12, 238, 142, 'reserved', 1, 'Ручная привязка приёмки к заказу #142 (фикс бага)', NOW());