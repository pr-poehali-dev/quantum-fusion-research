-- Фикс рассинхрона сумм сборки #93: parts_total/total_price были 0,
-- хотя компоненты содержат цены. Пересчитываем из компонентов.
UPDATE t_p72635010_quantum_fusion_resea.pc_builds pcb
SET parts_total = sub.calc_parts,
    total_price = sub.calc_parts + COALESCE(pcb.assembly_fee, 0)
FROM (
    SELECT b.id,
           COALESCE(SUM( COALESCE((c->>'price')::numeric,0) * COALESCE((c->>'qty')::numeric,1) ),0) AS calc_parts
    FROM t_p72635010_quantum_fusion_resea.pc_builds b
    JOIN jsonb_array_elements(b.components) c ON true
    WHERE b.id = 93
    GROUP BY b.id
) sub
WHERE pcb.id = sub.id;