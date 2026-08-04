-- Сброс тестовых данных брендинга PowerTechStore (создавались при проверке
-- новых полей logo_url/verify_page_url) — партнёр настроит сам.
UPDATE t_p72635010_quantum_fusion_resea.partner_brands
   SET logo_base64 = '', links = '[]'::jsonb, qr_url_template = '',
       logo_url = '', verify_page_url = '', updated_at = NOW()
 WHERE company_id = 5;
