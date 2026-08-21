-- Версии, залитые в наше хранилище, хранили техническое имя файла
-- (uuid.exe) и пустой s3_key — из-за этого клиент сохранял файл под
-- нечитаемым именем. Восстанавливаем ключ из адреса и человекочитаемое имя.
UPDATE t_p72635010_quantum_fusion_resea.stress_app_releases
SET s3_key = split_part(split_part(file_url, '/bucket/', 2), '?', 1)
WHERE s3_key = '' AND file_url LIKE '%/bucket/%';

UPDATE t_p72635010_quantum_fusion_resea.stress_app_releases
SET file_name = 'StressTester_Setup_'
    || regexp_replace(regexp_replace(version, '^[vV]', ''), '[^0-9A-Za-z._-]', '_', 'g')
    || '.exe'
WHERE file_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
