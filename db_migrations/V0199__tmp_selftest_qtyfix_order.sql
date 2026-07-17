-- Временный тестовый заказ для проверки фикса резерва (qty>1). Будет удалён.
INSERT INTO t_p72635010_quantum_fusion_resea.orders
  (order_type, customer_name, customer_phone, total, status, items, prepayment_confirmed, created_at, updated_at)
VALUES
  ('parts', '__selftest_qtyfix', '000', 0, 'new', '[]'::jsonb, TRUE, NOW(), NOW());