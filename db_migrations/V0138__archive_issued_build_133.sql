-- PC00001 (pc_builds id 133) выдан, но остался в каталоге (status='catalog').
-- Снимаем с витрины: writeoff_order не архивировал каталожную сборку (исправлено в коде).
UPDATE t_p72635010_quantum_fusion_resea.pc_builds
SET status = 'archive', in_stock = FALSE
WHERE id = 133;