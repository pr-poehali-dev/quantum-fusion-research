-- Фикс задвоения резерва QDVQ5641 (Xastra A700, group 60) в заказе PC00484.
-- Причина: гонка двух одновременных sync 20.07 12:19 создала одновременно
-- POSITIVE (id 1359, на партии 1084) и NEGATIVE (id 1367). Товара физически 0,
-- поэтому POSITIVE — фантом: висит на партии с qty=0, qty_reserved=1.
-- Лечение: закрываем фантомный POSITIVE и снимаем qty_reserved (в наличие НЕ
-- возвращаем — реального товара там нет). Корректный NEGATIVE оставляем.

-- 1) Закрыть фантомный POSITIVE-резерв.
UPDATE t_p72635010_quantum_fusion_resea.warehouse_reserves
SET status = 'RELEASED', updated_at = NOW()
WHERE id = 1359 AND order_id = 484 AND group_id = 60
  AND type = 'POSITIVE' AND status = 'ACTIVE';

-- 2) Снять висячий qty_reserved на партии 1084 (qty там 0, товара нет).
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty_reserved = GREATEST(0, qty_reserved - 1), updated_at = NOW()
WHERE id = 1084 AND group_id = 60 AND qty = 0 AND qty_reserved = 1;