-- Исправляем supply_id=27 (БП для заказа #43): qty должен быть 2, qty_reserved=1
-- По новой логике при резерве qty уменьшается
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = 2, qty_reserved = 1
WHERE id = 27;

-- Меняем статус БП в wip_build заказа #43 на ready
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET psu_status = 'ready', updated_at = NOW()
WHERE id = 16;

-- Добавляем движение reserved за заказ #43
INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_movements
  (group_id, supply_id, order_id, type, qty_delta, note, created_at)
VALUES (14, 27, 43, 'reserved', 1, 'Авторезерв при поставке: 1stPlayer Platinum SFX 750w', NOW());
