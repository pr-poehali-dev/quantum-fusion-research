-- Синхронизация архива: карточки товаров, чьи складские группы в архиве,
-- но сами карточки остались активными (баг рассинхронизации архивации).
UPDATE t_p72635010_quantum_fusion_resea.products p
SET is_archived = TRUE
FROM t_p72635010_quantum_fusion_resea.warehouse_groups wg
WHERE wg.is_archived = TRUE
  AND p.is_archived = FALSE
  AND (p.warehouse_group_id = wg.id OR wg.product_id = p.id);