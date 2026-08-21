-- Объединение финальных уведомлений прогона в ОДНО сообщение.
-- Программа шлёт алерт (перезагрузка ПК / перегрев GPU / отчёт не загружен),
-- а следом ingest шлёт итог, который уже содержит весь текст алерта. Вместо
-- второго сообщения будем РЕДАКТИРОВАТЬ первое — для этого нужно помнить
-- message_id и «вес» отправленного события (итог важнее алерта).
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_notify_sent
  ADD COLUMN IF NOT EXISTS message_id BIGINT,
  ADD COLUMN IF NOT EXISTS rank SMALLINT NOT NULL DEFAULT 0;
