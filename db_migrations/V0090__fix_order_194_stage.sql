-- Заказ 194: status='done' (выдан), но stage завис на 'Готов, можно забрать'.
-- Приводим в соответствие — выдан, значит «Забрали».
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET stage = 'Забрали', updated_at = NOW()
WHERE order_id = 194 AND stage <> 'Забрали';