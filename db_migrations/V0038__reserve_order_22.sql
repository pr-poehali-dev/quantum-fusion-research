UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies SET qty_reserved = qty_reserved + 3 WHERE id = 1;

INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_movements (group_id, supply_id, order_id, type, qty_delta, note, created_at)
VALUES (68, 1, 22, 'reserved', 3, 'Авторезерв по заказу #22', NOW());