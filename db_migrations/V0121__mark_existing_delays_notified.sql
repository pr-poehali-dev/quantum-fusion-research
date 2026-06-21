-- Старые события задержки уже многократно уведомлены — гасим, чтобы не слать снова.
UPDATE t_p72635010_quantum_fusion_resea.wip_delay_notified
SET notified_at = NOW()
WHERE notified_at IS NULL;