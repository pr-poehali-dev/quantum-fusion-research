-- Возвращаем заказу 426 достоверный статус CPU: товар в наличии, не в пути.
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET cpu_status = 'ready', updated_at = NOW()
WHERE order_id = 426;