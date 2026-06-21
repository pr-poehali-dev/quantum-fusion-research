-- Подготовка сборки #133 к тесту автоподвязки: очищаем резерв заказа 350,
-- отвязываем сборку, возвращаем в наличие. Эквивалент action=clear_reservation.
-- Все 8 ACTIVE резервов заказа 350 — POSITIVE: возвращаем qty в их supply.

-- 1) Возврат товара в наличие по каждому активному POSITIVE-резерву заказа 350
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty = s.qty + r.qty,
    qty_reserved = GREATEST(0, s.qty_reserved - r.qty),
    updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.warehouse_reserves r
WHERE r.order_id = 350 AND r.status = 'ACTIVE' AND r.type = 'POSITIVE'
  AND s.id = r.supply_id;

-- 2) Помечаем резервы как снятые
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'RELEASED', updated_at = NOW()
WHERE order_id = 350 AND status = 'ACTIVE';

-- 3) Возвращаем сборку #133 в наличие (до отвязки order_id)
UPDATE t_p72635010_quantum_fusion_resea.pc_builds
SET in_stock = TRUE
WHERE id = 133;

-- 4) Очищаем данные клиента и отвязываем заказ от WIP-сборки
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET contact = '', order_id = NULL, updated_at = NOW()
WHERE order_id = 350;

-- 5) Отменяем сам заказ 350 (резерв снят, сборка свободна)
UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'cancelled', updated_at = NOW()
WHERE id = 350;