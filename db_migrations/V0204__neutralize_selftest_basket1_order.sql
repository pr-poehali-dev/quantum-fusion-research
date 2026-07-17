-- Нейтрализуем тест-заказ #529 после проверки минус-резерва/корзины (п.1).
UPDATE t_p72635010_quantum_fusion_resea.orders
SET status='cancelled', total=0, items='[]'::jsonb,
    customer_name='__selftest_basket1_done', updated_at=NOW()
WHERE id=529 AND customer_name='__selftest_basket1';