-- v7.38: гриф «в наличии» = «в свободную продажу» сразу (не дожидаясь этапа «Готов»).
-- Приводим существующие каталожные сборки, помеченные for_sale, к новому правилу.
UPDATE t_p72635010_quantum_fusion_resea.pc_builds b
SET in_stock = TRUE
FROM t_p72635010_quantum_fusion_resea.wip_builds w
WHERE w.build_id = b.id
  AND w.for_sale = TRUE
  AND w.stage <> 'Забрали'
  AND b.status = 'catalog'
  AND b.in_stock = FALSE;