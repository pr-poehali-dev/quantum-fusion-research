-- Фикс заказа #227: убрать дублирующую возвращённую позицию (товар встречался дважды)
UPDATE t_p72635010_quantum_fusion_resea.orders
SET items = '[{"id": 20, "name": "AMD Ryzen 7 9800х3d", "price": 35000.0, "quantity": 1, "item_type": "product", "item_status": "reserved"}, {"id": 151, "name": "Cougar Flo", "price": 4500.0, "quantity": 1, "item_type": "product", "item_status": "need_order"}]'::jsonb,
    total = 39500,
    updated_at = NOW()
WHERE id = 227;
