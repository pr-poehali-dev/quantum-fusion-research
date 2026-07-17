-- Тест-заказ для проверки минус-резерва и корзины закупки (п.1). Нейтрализуем после.
INSERT INTO t_p72635010_quantum_fusion_resea.orders
  (order_type, customer_name, customer_phone, total, status, items, prepayment_confirmed, created_at, updated_at)
VALUES
  ('parts', '__selftest_basket1', '000', 0, 'processing', '[]'::jsonb, TRUE, NOW(), NOW());