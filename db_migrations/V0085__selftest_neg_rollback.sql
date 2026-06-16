-- Откат тестовых минусов и корзины (заказ 176). Резервы и сам заказ удалит
-- автоочистка _cleanup_selftest при следующем деплое reserves (метка __selftest).

-- Откат qty_negative в буфер-партиях
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty_negative = GREATEST(0, qty_negative - 1), updated_at = NOW() WHERE id = 9;   -- охлад
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty_negative = GREATEST(0, qty_negative - 1), updated_at = NOW() WHERE id = 21;  -- корпус
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
  SET qty_negative = GREATEST(0, qty_negative - 1), updated_at = NOW() WHERE id = 239; -- ОЗУ (буфер)

-- Откат корзины закупки (required_qty -1 по тем же группам)
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket
  SET required_qty = GREATEST(0, required_qty - 1), updated_at = NOW() WHERE group_id = 9;
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket
  SET required_qty = GREATEST(0, required_qty - 1), updated_at = NOW() WHERE group_id = 11;
UPDATE t_p72635010_quantum_fusion_resea.warehouse_purchase_basket
  SET required_qty = GREATEST(0, required_qty - 1), updated_at = NOW() WHERE group_id = 85;