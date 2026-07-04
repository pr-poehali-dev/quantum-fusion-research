-- Финальная синхронизация счётчиков партий с живыми ACTIVE POSITIVE-резервами.
-- Инвариант: физически_на_партии = qty (свободно) + qty_reserved (под заказы).
-- Приводим qty_reserved к числу живых резервов, забирая недостающее из qty.
-- Если физики не хватает (total < живых резервов) — reserved = total, qty = 0
-- (реальный дефицит останется виден: резервов больше, чем физтоваров — это
--  корректно отражает, что часть карточек нужно до-закупить).

UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_reserved = LEAST(s.qty + s.qty_reserved, agg.units),
    qty = GREATEST(0, (s.qty + s.qty_reserved) - agg.units),
    updated_at = NOW()
FROM (
  SELECT supply_id, SUM(qty) AS units
  FROM t_p72635010_quantum_fusion_resea.warehouse_reserves
  WHERE status='ACTIVE' AND type='POSITIVE' AND supply_id IS NOT NULL
  GROUP BY supply_id
) agg
WHERE s.id = agg.supply_id
  AND s.qty_reserved <> agg.units;
