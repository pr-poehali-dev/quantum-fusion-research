
-- Снимаем все активные резервы (POSITIVE и NEGATIVE)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'RELEASED', updated_at = NOW()
WHERE status = 'ACTIVE';

-- Обнуляем qty_reserved и qty_negative во всех поставках
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty_reserved = 0, qty_negative = 0;

-- Очищаем корзину закупки
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket
SET required_qty = 0, status = 'RECEIVED', updated_at = NOW()
WHERE required_qty > 0;
