-- Привести сборку #133 и её заказ-затычку 350 к чистому состоянию «В наличии».
-- Сборка снова в наличии и в свободной продаже; заказ-затычка пустой.
UPDATE t_p72635010_quantum_fusion_resea.pc_builds SET in_stock = TRUE WHERE id = 133;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET for_sale = TRUE, order_id = 350, contact = '', updated_at = NOW()
WHERE id = 43;

UPDATE t_p72635010_quantum_fusion_resea.orders
SET customer_name = 'Сборка PC00028', customer_phone = '-', customer_email = NULL,
    status = 'waiting_assembly', updated_at = NOW()
WHERE id = 350;