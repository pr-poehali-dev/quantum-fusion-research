-- Фикс двойного учёта резерва по заказу #367 (товар Maxsun B850, партия 726).
-- Причина: при приёмке дублирующие этапы авторезерва создали лишний NEGATIVE-резерв
-- на тот же заказ, из-за чего партия одновременно имела qty_reserved=1 и qty_negative=1,
-- а WIP показывал "Заказать" при уже принятом и зарезервированном товаре.

-- 1. Гасим лишний (дублирующий) NEGATIVE-резерв заказа #367 -> RELEASED (не активен).
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'RELEASED', updated_at = NOW()
WHERE id = 751 AND order_id = 367 AND type = 'NEGATIVE' AND status = 'ACTIVE';

-- 2. Приводим партию 726 к корректному состоянию: 1 шт зарезервирована, нехватки нет.
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty = 0, qty_reserved = 1, qty_negative = 0, updated_at = NOW()
WHERE id = 726;

-- 3. Компонент в WIP заказа #367 фактически получен и зарезервирован -> ready.
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET motherboard_status = 'ready', updated_at = NOW()
WHERE order_id = 367 AND motherboard_status = 'need_order';

-- 4. Синхронизируем корзину закупки: нехватки по группе больше нет.
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket
SET required_qty = 0, updated_at = NOW()
WHERE group_id = 691;
