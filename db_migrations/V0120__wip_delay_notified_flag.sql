-- Флаг: было ли реально отправлено Telegram-уведомление по этому событию задержки.
-- Запись в журнал делается при пометке задержки (в одной транзакции с UPDATE статуса),
-- а отправка идёт ОТДЕЛЬНО (крон/ручной вызов) и проставляет notified_at.
-- Так уведомление уходит строго один раз, не завися от таймаутов Telegram.
ALTER TABLE t_p72635010_quantum_fusion_resea.wip_delay_notified
    ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP;