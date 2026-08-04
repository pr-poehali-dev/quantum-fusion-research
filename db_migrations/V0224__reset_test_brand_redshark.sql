-- Очистка тестовых данных брендинга (создавались при проверке функционала),
-- чтобы у партнёра сработало автозаполнение из профиля компании.
UPDATE t_p72635010_quantum_fusion_resea.partner_brands
   SET logo_base64 = '', links = '[]'::jsonb, qr_url_template = '',
       revoked_at = NULL, updated_at = NOW()
 WHERE company_id = 3;
