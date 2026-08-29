-- Подчистка контактов: в поле попали заглушки телефона («.», «-») и дубли,
-- когда имя и почта совпадают (клиент указал ник в обоих полях).
UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET contact = LEFT(
      CONCAT_WS(' · ',
        NULLIF(TRIM(o.customer_name), ''),
        CASE WHEN TRIM(COALESCE(o.customer_phone, '')) IN ('', '.', '-', '—')
             THEN NULL ELSE TRIM(o.customer_phone) END,
        CASE WHEN TRIM(COALESCE(o.customer_email, '')) IN ('', '.', '-', '—')
               OR LOWER(TRIM(COALESCE(o.customer_email, ''))) = LOWER(TRIM(COALESCE(o.customer_name, '')))
             THEN NULL ELSE TRIM(o.customer_email) END
      ), 128),
    updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.orders o
WHERE o.id = w.order_id
  AND w.contact LIKE '%·%'
  AND COALESCE(NULLIF(TRIM(o.customer_name), ''), '') <> '';
