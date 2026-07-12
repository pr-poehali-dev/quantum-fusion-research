-- Старое описание промокода было plain-text с переносами \n. Теперь описание —
-- HTML (rich text). Оборачиваем переносы в <br>, чтобы отображалось корректно.
UPDATE promos
SET description = REPLACE(description, chr(10), '<br>')
WHERE id = 1 AND description IS NOT NULL AND description NOT LIKE '%<%';
