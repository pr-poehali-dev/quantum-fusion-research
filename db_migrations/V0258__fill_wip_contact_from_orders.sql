-- Контакт клиента не переносился из заказа в карточку сборки: менеджер видел
-- пустое поле «Контакт клиента» и был вынужден искать телефон в заказе.
-- Заполняем задним числом в том же формате, что используется при покупке
-- ПК из наличия: «Имя · телефон · почта».
UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET contact = LEFT(
      CONCAT_WS(' · ',
        NULLIF(TRIM(o.customer_name), ''),
        NULLIF(TRIM(o.customer_phone), ''),
        NULLIF(TRIM(o.customer_email), '')
      ), 128),
    updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.orders o
WHERE o.id = w.order_id
  AND COALESCE(NULLIF(TRIM(w.contact), ''), '') = ''
  AND COALESCE(NULLIF(TRIM(o.customer_name), ''), '') <> ''
  AND TRIM(o.customer_phone) <> '-';
