-- Пересчёт себестоимости (cost_price) для всех НДС-поставок, где скидка
-- закупки не была применена (cost_price == price_with_vat).
-- Скидка берётся из app_settings.purchase_discount_percent (сейчас 18%).
-- price_with_vat остаётся как введено (для отчётности).
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET cost_price = ROUND(
      s.price_with_vat * (1 - (
        SELECT COALESCE(NULLIF(value,'')::numeric, 0)
        FROM t_p72635010_quantum_fusion_resea.app_settings
        WHERE key = 'purchase_discount_percent'
      ) / 100), 2),
    updated_at = NOW()
WHERE s.has_vat = TRUE
  AND s.price_with_vat IS NOT NULL
  AND ROUND(s.cost_price, 2) = ROUND(s.price_with_vat, 2);