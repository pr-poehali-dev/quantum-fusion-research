-- Нейтрализуем тест-заказ #508 после проверки фикса двойного возврата (п.5).
UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'cancelled', total = 0, items = '[]'::jsonb,
    customer_name = '__selftest_return5_done', updated_at = NOW()
WHERE id = 508 AND customer_name = '__selftest_return5';