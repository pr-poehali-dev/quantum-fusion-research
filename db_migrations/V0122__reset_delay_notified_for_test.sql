-- Сброс флага уведомления у текущих задержек, чтобы проверить рассылку
-- (создание задачи Гоше+Саеду и отправку пинга) на реальных данных.
UPDATE t_p72635010_quantum_fusion_resea.wip_delay_notified
SET notified_at = NULL
WHERE eta_date = DATE '2026-06-20';