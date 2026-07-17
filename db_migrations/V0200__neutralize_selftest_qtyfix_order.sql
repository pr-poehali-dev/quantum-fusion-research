-- Нейтрализуем временный тест-заказ #507 (удаление заказов появится в след. этапе,
-- пункт 7 репорта). Помечаем отменённым и обнуляем, чтобы не мешал в списках.
UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'cancelled', total = 0, items = '[]'::jsonb,
    customer_name = '__selftest_qtyfix_done', updated_at = NOW()
WHERE id = 507 AND customer_name = '__selftest_qtyfix';