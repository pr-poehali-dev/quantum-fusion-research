-- Исправляем supply_id=13: по старой логике qty не вычиталось при резерве
-- Приход был 4 штуки, активных резервов 4 (заказы #29, #33, #34)
-- По новой логике: qty = свободно = 0, qty_reserved = 4

UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = 0, qty_reserved = 4
WHERE id = 13;
