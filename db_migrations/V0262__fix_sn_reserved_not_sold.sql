-- Исправление ошибки миграции V0261.
--
-- ЧТО БЫЛО НЕ ТАК: V0261 считала «продано = серийники сверх qty», но qty —
-- это только СВОБОДНЫЙ остаток. Товар в резерве (qty_reserved) физически
-- лежит на складе и ещё не выдан клиенту, а его пометили проданным.
--
-- ВЕРНЫЙ ИНВАРИАНТ: на складе числится столько серийников, сколько штук
-- реально лежит = qty + qty_reserved.
--
-- Возвращаем на склад только те, что помечены 'sold' БЕЗ привязки к заказу:
-- серийник с order_id — реально выданный, его трогать нельзя.

WITH нехватка AS (
    SELECT s.id AS supply_id,
           (s.qty + s.qty_reserved)
             - COUNT(*) FILTER (WHERE sn.status = 'in_stock') AS вернуть
    FROM warehouse_supplies s
    JOIN sn_archive sn ON sn.supply_id = s.id
    GROUP BY s.id, s.qty, s.qty_reserved
    HAVING (s.qty + s.qty_reserved)
             > COUNT(*) FILTER (WHERE sn.status = 'in_stock')
),
к_возврату AS (
    SELECT sn.id
    FROM нехватка n
    JOIN LATERAL (
        SELECT id FROM sn_archive
        WHERE supply_id = n.supply_id
          AND status = 'sold'
          AND order_id IS NULL
        ORDER BY id DESC          -- возвращаем последние гашёные
        LIMIT n.вернуть
    ) sn ON TRUE
)
UPDATE sn_archive
SET status = 'in_stock', updated_at = NOW()
WHERE id IN (SELECT id FROM к_возврату);
