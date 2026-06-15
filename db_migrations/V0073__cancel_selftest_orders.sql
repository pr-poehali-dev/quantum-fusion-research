UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'cancelled', updated_at = NOW()
WHERE (customer_name LIKE '\_\_selftest%' OR customer_name LIKE '\_\_SELFTEST%')
  AND status = 'new';

UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'RELEASED', updated_at = NOW()
WHERE status = 'ACTIVE' AND order_id IN (
  SELECT id FROM t_p72635010_quantum_fusion_resea.orders
  WHERE customer_name LIKE '\_\_selftest%' OR customer_name LIKE '\_\_SELFTEST%'
);