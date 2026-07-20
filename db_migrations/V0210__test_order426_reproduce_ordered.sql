-- Проверка системного фикса: возвращаем заказу 426 статус CPU «заказан у
-- поставщика», чтобы убедиться, что теперь резерв всё равно встаёт из наличия.
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET cpu_status = 'ordered_transit', updated_at = NOW()
WHERE order_id = 426;