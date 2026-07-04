-- Лечение осиротевших резервов выданных (done) заказов.
-- Причина: при выдаче заказа резервы NEGATIVE не закрывались (прямой SQL закрывал
-- только POSITIVE), а часть ресинков оставляла висящие ACTIVE-резервы.
-- Итог: фантомный qty_reserved/qty_negative на партиях. Приводим состояние к тому,
-- что должен был сделать fulfill_order_reserves: резервы -> FULFILLED, счётчики партий откатить.

-- 1) Откатываем qty_reserved на партиях по осиротевшим POSITIVE-резервам done-заказов
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_reserved = GREATEST(0, s.qty_reserved - agg.units), updated_at = NOW()
FROM (
  SELECT r.supply_id, SUM(r.qty) AS units
  FROM t_p72635010_quantum_fusion_resea.warehouse_reserves r
  JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = r.order_id
  WHERE r.status='ACTIVE' AND o.status='done' AND r.type='POSITIVE' AND r.supply_id IS NOT NULL
  GROUP BY r.supply_id
) agg
WHERE s.id = agg.supply_id;

-- 2) Откатываем qty_negative на партиях по осиротевшим NEGATIVE-резервам done-заказов
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_negative = GREATEST(0, s.qty_negative - agg.units), updated_at = NOW()
FROM (
  SELECT r.supply_id, SUM(r.qty) AS units
  FROM t_p72635010_quantum_fusion_resea.warehouse_reserves r
  JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = r.order_id
  WHERE r.status='ACTIVE' AND o.status='done' AND r.type='NEGATIVE' AND r.supply_id IS NOT NULL
  GROUP BY r.supply_id
) agg
WHERE s.id = agg.supply_id;

-- 3) Закрываем сами резервы как FULFILLED (товар выдан клиенту)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves r
SET status='FULFILLED', updated_at=NOW()
FROM t_p72635010_quantum_fusion_resea.orders o
WHERE o.id = r.order_id AND r.status='ACTIVE' AND o.status='done';
