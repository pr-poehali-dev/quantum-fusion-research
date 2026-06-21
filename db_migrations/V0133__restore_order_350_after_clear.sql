-- Восстановить заказ PC00028 в состояние «активный, без резерва»:
-- заказ активен, сборка #133 привязана, for_sale=FALSE (не в резерве), не на витрине.
UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'waiting_assembly', updated_at = NOW()
WHERE id = 350;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET order_id = 350, for_sale = FALSE, updated_at = NOW()
WHERE id = 43;

UPDATE t_p72635010_quantum_fusion_resea.pc_builds
SET in_stock = FALSE
WHERE id = 133;