-- Фикс заказа #227: убрать висячие дубли POSITIVE-резервов (оставить 1 активный)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'RELEASED', updated_at = NOW()
WHERE order_id = 227
  AND supply_id = 186
  AND type = 'POSITIVE'
  AND status = 'ACTIVE'
  AND id <> (
    SELECT MIN(id) FROM t_p72635010_quantum_fusion_resea.warehouse_reserves
    WHERE order_id = 227 AND supply_id = 186 AND type = 'POSITIVE' AND status = 'ACTIVE'
  );
