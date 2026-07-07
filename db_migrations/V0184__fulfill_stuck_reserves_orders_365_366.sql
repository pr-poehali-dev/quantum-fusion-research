-- Разовая починка: заказы #365 и #366 были выданы клиенту через WIP (стадия «Архив»),
-- но из-за отсутствия обработки стадии «Архив» их активные резервы не списались,
-- а статус заказа остался активным. Повторяем логику fulfill_order_reserves:
-- POSITIVE: qty_reserved -= qty (товар ушёл клиенту, в наличие НЕ возвращается),
-- резерв -> FULFILLED, движение issued. Затем статус заказов -> done.

-- 1. Движения выдачи (issued) по каждому активному POSITIVE-резерву
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_movements
    (group_id, supply_id, order_id, type, qty_delta, note, created_at)
SELECT r.group_id, r.supply_id, r.order_id, 'issued', -r.qty,
       'Выдача клиенту (заказ #' || r.order_id || ') — разовая починка зависших резервов', NOW()
FROM t_p72635010_quantum_fusion_resea.warehouse_reserves r
WHERE r.order_id IN (365, 366) AND r.status = 'ACTIVE' AND r.type = 'POSITIVE';

-- 2. Уменьшаем qty_reserved на партиях по сумме активных POSITIVE-резервов заказа
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_reserved = GREATEST(0, s.qty_reserved - agg.total_qty),
    updated_at = NOW()
FROM (
    SELECT supply_id, SUM(qty) AS total_qty
    FROM t_p72635010_quantum_fusion_resea.warehouse_reserves
    WHERE order_id IN (365, 366) AND status = 'ACTIVE' AND type = 'POSITIVE'
    GROUP BY supply_id
) agg
WHERE s.id = agg.supply_id;

-- 3. Помечаем резервы как FULFILLED (и POSITIVE, и любые оставшиеся ACTIVE этих заказов)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'FULFILLED', updated_at = NOW()
WHERE order_id IN (365, 366) AND status = 'ACTIVE';

-- 4. Переводим заказы в статус «Выдан» (done)
UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'done', updated_at = NOW()
WHERE id IN (365, 366);
