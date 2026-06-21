-- PC00028 (id 350) выдан (orders.status=done), но WIP остался «Готов».
-- Синхронизируем: WIP → «Забрали», сборка снята с витрины (продана).
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET stage = 'Забрали', issued_at = CURRENT_DATE, updated_at = NOW()
WHERE order_id = 350;

UPDATE t_p72635010_quantum_fusion_resea.pc_builds
SET in_stock = FALSE
WHERE id = 133;