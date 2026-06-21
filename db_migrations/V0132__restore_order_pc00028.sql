-- Восстановление заказа PC00028 (id 350): активный статус + привязка сборки #133.
UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'waiting_assembly', updated_at = NOW()
WHERE id = 350;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET order_id = 350, updated_at = NOW()
WHERE id = 43;

-- Сборка ушла под клиента — снимаем с витрины
UPDATE t_p72635010_quantum_fusion_resea.pc_builds
SET in_stock = FALSE
WHERE id = 133;