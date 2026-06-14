-- Обнуление всех остатков и резервов на складе
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = 0, qty_reserved = 0, qty_negative = 0, updated_at = NOW();

-- Обнуление корзины закупки
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket
SET required_qty = 0, updated_at = NOW();

-- Снятие всех активных резервов
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'RELEASED', updated_at = NOW()
WHERE status = 'ACTIVE';
