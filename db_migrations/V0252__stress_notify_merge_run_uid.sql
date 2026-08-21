-- Слот склейки уведомлений должен принадлежать КОНКРЕТНОМУ прогону.
-- Иначе следующий прогон на том же стенде («стенд Даня», заказ 5205) попадал
-- в слот предыдущего и его уведомление считалось повтором — не отправлялось.
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_notify_merge
  ADD COLUMN IF NOT EXISTS run_uid TEXT NOT NULL DEFAULT '';

-- Старые слоты помечаем протухшими, чтобы они не глушили новые прогоны:
-- поиск слота ограничен окном по sent_at.
UPDATE t_p72635010_quantum_fusion_resea.stress_notify_merge
SET sent_at = NOW() - INTERVAL '10 years'
WHERE run_uid = '';
