-- Чистка застрявших отрицательных резервов (qty_negative) от старых отменённых
-- заказов. Активных NEGATIVE-резервов в warehouse_reserves по этим партиям нет —
-- значит qty_negative «осиротел» (легаси старого бага). Обнуляем излишек.

-- Партии: убираем застрявший минус
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty_negative = GREATEST(0, qty_negative - 1), updated_at = NOW() WHERE id = 34;   -- ID-COOLING IS-55
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty_negative = GREATEST(0, qty_negative - 1), updated_at = NOW() WHERE id = 38;   -- ADATA XPG MARS 980
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty_negative = GREATEST(0, qty_negative - 2), updated_at = NOW() WHERE id = 185;  -- Jonsbo T9

-- Корзина закупки: приводим required_qty к фактической потребности
-- (сумма активных NEGATIVE-резервов группы = 0). Обнуляем по затронутым группам.
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket
  SET required_qty = 0, updated_at = NOW()
  WHERE group_id IN (9, 47, 85)
    AND NOT EXISTS (
      SELECT 1 FROM t_p72635010_quantum_fusion_resea.warehouse_reserves r
      WHERE r.group_id = warehouse_purchase_basket.group_id
        AND r.type = 'NEGATIVE' AND r.status = 'ACTIVE'
    );