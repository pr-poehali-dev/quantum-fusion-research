-- Возврат «застрявших» резервов в наличие. Легаси от старого бага синхронизации
-- (sync_order до v3.5 наращивал qty_reserved без записи в warehouse_reserves,
-- поэтому при отмене заказа release_order_reserves ничего не находил).
-- Приводим qty_reserved партии в соответствие с реальными ACTIVE POSITIVE-резервами:
-- излишек (stuck) возвращаем в свободный остаток qty.

-- 185 Jonsbo T9: stuck 1
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty = qty + 1, qty_reserved = qty_reserved - 1, updated_at = NOW() WHERE id = 185;
-- 186 Ryzen 7 9800x3d: stuck 3
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty = qty + 3, qty_reserved = qty_reserved - 3, updated_at = NOW() WHERE id = 186;
-- 187 ASRock B850I: stuck 2
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty = qty + 2, qty_reserved = qty_reserved - 2, updated_at = NOW() WHERE id = 187;
-- 188 1stPlayer SFX 750w: stuck 2
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty = qty + 2, qty_reserved = qty_reserved - 2, updated_at = NOW() WHERE id = 188;
-- 225 DDR5 KingBank 2x24Gb: stuck 1
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty = qty + 1, qty_reserved = qty_reserved - 1, updated_at = NOW() WHERE id = 225;
-- 238 KFA2 RTX 5070 Ti: stuck 1
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty = qty + 1, qty_reserved = qty_reserved - 1, updated_at = NOW() WHERE id = 238;