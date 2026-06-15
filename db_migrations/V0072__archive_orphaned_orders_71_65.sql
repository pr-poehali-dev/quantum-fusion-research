-- Архивация осиротевших заказов 71 и 65 (потеряли WIP-сборку из-за старого бага удаления)
UPDATE t_p72635010_quantum_fusion_resea.orders
SET status = 'archived', updated_at = NOW()
WHERE id IN (71, 65) AND status = 'new';

UPDATE t_p72635010_quantum_fusion_resea.pc_builds
SET status = 'archive'
WHERE id IN (110, 111) AND status = 'client';