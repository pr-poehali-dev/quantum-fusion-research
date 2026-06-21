-- Заказ HW00003 (id 352) фактически выдан (item issued), но висел в new.
-- Переводим в done (уйдёт в архив).
UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'done', updated_at = NOW()
WHERE id = 352;