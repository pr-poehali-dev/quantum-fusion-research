-- Генеральная чистка фантомных резервов и корзины закупки после отмены заказов.

-- 1. Вернуть склад по POSITIVE-резервам отменённых заказов
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty = s.qty + agg.pos_qty,
    qty_reserved = GREATEST(0, s.qty_reserved - agg.pos_qty),
    updated_at = NOW()
FROM (
  SELECT r.supply_id, SUM(r.qty) AS pos_qty
  FROM t_p72635010_quantum_fusion_resea.warehouse_reserves r
  JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = r.order_id
  WHERE r.status='ACTIVE' AND r.type='POSITIVE' AND r.supply_id IS NOT NULL
    AND o.status IN ('archived','cancelled')
  GROUP BY r.supply_id
) agg
WHERE s.id = agg.supply_id;

-- 2. Снять qty_negative по NEGATIVE-резервам отменённых заказов
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_negative = GREATEST(0, s.qty_negative - agg.neg_qty),
    updated_at = NOW()
FROM (
  SELECT r.supply_id, SUM(r.qty) AS neg_qty
  FROM t_p72635010_quantum_fusion_resea.warehouse_reserves r
  JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = r.order_id
  WHERE r.status='ACTIVE' AND r.type='NEGATIVE' AND r.supply_id IS NOT NULL
    AND o.status IN ('archived','cancelled')
  GROUP BY r.supply_id
) agg
WHERE s.id = agg.supply_id;

-- 3. Пометить активные резервы отменённых заказов как RELEASED
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves r
SET status='RELEASED', updated_at=NOW()
FROM t_p72635010_quantum_fusion_resea.orders o
WHERE o.id = r.order_id AND r.status='ACTIVE' AND o.status IN ('archived','cancelled');

-- 4. Пересчитать корзину закупки по реальной потребности (неотменённые заказы)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket b
SET required_qty = COALESCE(real.needed, 0),
    status = CASE WHEN COALESCE(real.needed,0) <= 0 THEN 'RECEIVED' ELSE b.status END,
    updated_at = NOW()
FROM (
  SELECT b2.group_id,
    (SELECT COALESCE(SUM(r.qty),0)
     FROM t_p72635010_quantum_fusion_resea.warehouse_reserves r
     JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id=r.order_id
     WHERE r.group_id=b2.group_id AND r.type='NEGATIVE' AND r.status='ACTIVE'
       AND o.status NOT IN ('archived','cancelled')) AS needed
  FROM t_p72635010_quantum_fusion_resea.warehouse_purchase_basket b2
) real
WHERE b.group_id = real.group_id;