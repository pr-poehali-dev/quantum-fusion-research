-- Единая сквозная нумерация заказов: display_number = префикс + id(zfill5).
-- Префикс: PC (сборки), RMA (заказы-замены по гарантии), HW (остальное).
UPDATE t_p72635010_quantum_fusion_resea.orders o
SET display_number =
    CASE
        WHEN o.order_type = 'pc_build' THEN 'PC'
        WHEN EXISTS (
            SELECT 1 FROM t_p72635010_quantum_fusion_resea.warehouse_rma r
            WHERE r.replacement_order_id = o.id
        ) THEN 'RMA'
        ELSE 'HW'
    END || LPAD(o.id::text, 5, '0');
