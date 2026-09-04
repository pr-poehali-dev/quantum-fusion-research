-- Восстановление статусов серийников.
-- Раньше при выдаче заказа серийники не гасились: в архиве всё висело
-- «На складе», хотя товар давно продан. Приводим историю в порядок.
--
-- Логика: в партии не может быть «на складе» больше серийников, чем
-- реально осталось штук. Лишние (самые старые по дате внесения) помечаем
-- проданными.

-- 1) Помечаем проданными лишние серийники сверх остатка партии
WITH расхождения AS (
    SELECT a.supply_id,
           (a.sn_cnt - s.qty) AS продано
    FROM (SELECT supply_id, COUNT(*) AS sn_cnt
          FROM sn_archive
          WHERE status = 'in_stock' AND supply_id IS NOT NULL
          GROUP BY supply_id) a
    JOIN warehouse_supplies s ON s.id = a.supply_id
    WHERE a.sn_cnt > s.qty
),
к_гашению AS (
    SELECT sn.id
    FROM расхождения r
    JOIN LATERAL (
        SELECT id FROM sn_archive
        WHERE supply_id = r.supply_id AND status = 'in_stock'
        ORDER BY id ASC
        LIMIT r.продано
    ) sn ON TRUE
)
UPDATE sn_archive
SET status = 'sold', updated_at = NOW()
WHERE id IN (SELECT id FROM к_гашению);

-- 2) Привязываем к заказу там, где он однозначен: по партии проходила
--    ровно одна продажа с указанным заказом. Где заказов несколько —
--    оставляем без привязки, чтобы не приписать серийник чужому клиенту.
WITH однозначные AS (
    SELECT m.supply_id, MIN(m.order_id) AS order_id
    FROM warehouse_movements m
    WHERE m.type = 'sale' AND m.order_id IS NOT NULL
    GROUP BY m.supply_id
    HAVING COUNT(DISTINCT m.order_id) = 1
)
UPDATE sn_archive sn
SET order_id = o.order_id, updated_at = NOW()
FROM однозначные o
WHERE sn.supply_id = o.supply_id
  AND sn.status = 'sold'
  AND sn.order_id IS NULL;
