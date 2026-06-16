-- Тестовый заказ для проверки создания NEGATIVE-резервов (ОЗУ/корпус/охлад).
-- Метка __selftest в customer_name → попадёт под автоочистку reserves.
INSERT INTO t_p72635010_quantum_fusion_resea.orders
    (customer_name, customer_phone, order_type, items, total, status, created_at)
VALUES
    ('__selftest_neg_check', '+70000000000', 'parts',
     '[]'::jsonb, 0, 'new', NOW());