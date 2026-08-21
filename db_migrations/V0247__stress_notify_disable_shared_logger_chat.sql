-- Логи стресс-тестов: убираем «общий логгер» из чужих компаний.
-- Канал 5134086758 (личный логгер) остаётся только у нашей компании BeGraphics
-- (is_own = true). У остальных компаний он отключается, чтобы одно событие
-- не светилось одновременно у нас и в партнёрском чате.
UPDATE t_p72635010_quantum_fusion_resea.stress_notify_chats c
SET enabled = FALSE, updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.partner_companies pc
WHERE c.company_id = pc.id
  AND c.chat_id IN ('5134086758', '-5134086758')
  AND COALESCE(pc.is_own, FALSE) = FALSE;
