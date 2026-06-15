-- Зачистка тестового мусора со склада (группы/товары/партии/корзина от __selftest__)

-- 1. Обнуляем остатки и резервы на тестовых партиях
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = 0, qty_reserved = 0, qty_negative = 0, updated_at = NOW()
WHERE group_id IN (
  SELECT id FROM t_p72635010_quantum_fusion_resea.warehouse_groups WHERE name = '__selftest_grp__'
);

-- 2. Обнуляем корзину закупки тестовых групп
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket
SET required_qty = 0, status = 'NEW', updated_at = NOW()
WHERE group_id IN (
  SELECT id FROM t_p72635010_quantum_fusion_resea.warehouse_groups WHERE name = '__selftest_grp__'
);

-- 3. Архивируем тестовые складские группы (уйдут из активного склада)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_groups
SET is_archived = true, updated_at = NOW()
WHERE name = '__selftest_grp__';

-- 4. Прячем тестовые товары из каталога
UPDATE t_p72635010_quantum_fusion_resea.products
SET in_stock = false, stock_qty = 0
WHERE name = '__selftest_prod__';