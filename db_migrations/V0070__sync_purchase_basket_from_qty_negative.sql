-- Синхронизация warehouse_purchase_basket из warehouse_supplies.qty_negative
-- Для всех групп где есть отрицательный резерв но нет записи в корзине
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_purchase_basket (group_id, required_qty, status, created_at, updated_at)
SELECT 
  s.group_id,
  SUM(s.qty_negative) as required_qty,
  'NEW' as status,
  NOW(),
  NOW()
FROM t_p72635010_quantum_fusion_resea.warehouse_supplies s
WHERE s.qty_negative > 0
GROUP BY s.group_id
ON CONFLICT (group_id) DO UPDATE 
  SET required_qty = EXCLUDED.required_qty,
      updated_at = NOW()
  WHERE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket.required_qty = 0
     OR t_p72635010_quantum_fusion_resea.warehouse_purchase_basket.required_qty IS NULL;
