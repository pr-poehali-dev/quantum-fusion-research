-- Прямая ссылка Яндекс.Диска одноразовая и привязана к тому, кто её запросил,
-- поэтому у клиента она не открывается. Переводим уже сохранённые версии
-- на публичную страницу файла.
UPDATE t_p72635010_quantum_fusion_resea.stress_app_releases
SET file_url = source_link
WHERE source_link <> '' AND file_url <> source_link;
