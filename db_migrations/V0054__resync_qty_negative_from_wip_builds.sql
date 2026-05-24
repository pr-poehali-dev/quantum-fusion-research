-- Пересчитываем qty_negative: суммируем нехватку только по активным wip_builds где статус = need_order
-- Для каждой поставки через product_id группы
UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies s
SET qty_negative = COALESCE((
    SELECT SUM(need_per_order) FROM (
        SELECT GREATEST(0,
            COALESCE((
                SELECT SUM((comp->>'qty')::int)
                FROM jsonb_array_elements(pb.components::jsonb) comp
                WHERE (comp->>'source_id')::int = g.product_id
            ), 0) -
            COALESCE((
                SELECT SUM(m2.qty_delta)
                FROM t_p72635010_quantum_fusion_resea.warehouse_movements m2
                JOIN t_p72635010_quantum_fusion_resea.warehouse_groups wg2 ON wg2.id = m2.group_id
                WHERE wg2.product_id = g.product_id AND m2.order_id = wb.order_id AND m2.type IN ('reserved','unreserved')
            ), 0)
        ) AS need_per_order
        FROM t_p72635010_quantum_fusion_resea.wip_builds wb
        JOIN t_p72635010_quantum_fusion_resea.orders o ON o.id = wb.order_id
        LEFT JOIN t_p72635010_quantum_fusion_resea.pc_builds pb ON pb.id = wb.build_id
        WHERE o.status NOT IN ('cancelled','done')
          AND (
            (wb.cpu_status = 'need_order' AND EXISTS (SELECT 1 FROM t_p72635010_quantum_fusion_resea.products p2 WHERE p2.id = g.product_id AND LOWER(wb.cpu) = LOWER(p2.name))) OR
            (wb.gpu_status = 'need_order' AND EXISTS (SELECT 1 FROM t_p72635010_quantum_fusion_resea.products p2 WHERE p2.id = g.product_id AND LOWER(wb.gpu) = LOWER(p2.name))) OR
            (wb.ram_status = 'need_order' AND EXISTS (SELECT 1 FROM t_p72635010_quantum_fusion_resea.products p2 WHERE p2.id = g.product_id AND LOWER(wb.ram) = LOWER(p2.name))) OR
            (wb.storage_status = 'need_order' AND EXISTS (SELECT 1 FROM t_p72635010_quantum_fusion_resea.products p2 WHERE p2.id = g.product_id AND LOWER(wb.storage) = LOWER(p2.name))) OR
            (wb.psu_status = 'need_order' AND EXISTS (SELECT 1 FROM t_p72635010_quantum_fusion_resea.products p2 WHERE p2.id = g.product_id AND LOWER(wb.psu) = LOWER(p2.name))) OR
            (wb.case_status = 'need_order' AND EXISTS (SELECT 1 FROM t_p72635010_quantum_fusion_resea.products p2 WHERE p2.id = g.product_id AND LOWER(wb.case_name) = LOWER(p2.name))) OR
            (wb.motherboard_status = 'need_order' AND EXISTS (SELECT 1 FROM t_p72635010_quantum_fusion_resea.products p2 WHERE p2.id = g.product_id AND LOWER(wb.motherboard) = LOWER(p2.name))) OR
            (wb.cooling_status = 'need_order' AND EXISTS (SELECT 1 FROM t_p72635010_quantum_fusion_resea.products p2 WHERE p2.id = g.product_id AND LOWER(wb.cooling) = LOWER(p2.name)))
          )
    ) sub
), 0)
FROM t_p72635010_quantum_fusion_resea.warehouse_groups g
WHERE g.id = s.group_id AND s.qty_negative > 0;
