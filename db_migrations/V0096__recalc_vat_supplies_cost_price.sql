-- Пересчёт себестоимости НДС-заходов по правильной формуле:
-- cost_price = price_with_vat × (1 − purchase_discount_percent/100).
-- Раньше ошибочно делили на (1+НДС%). Берём текущую скидку из настроек.
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET cost_price = ROUND(
        s.price_with_vat * (1 - (
            SELECT COALESCE(NULLIF(value, '')::numeric, 0)
            FROM t_p72635010_quantum_fusion_resea.app_settings
            WHERE key = 'purchase_discount_percent'
        ) / 100.0), 2),
    updated_at = NOW()
WHERE s.has_vat = TRUE
  AND s.price_with_vat IS NOT NULL;
