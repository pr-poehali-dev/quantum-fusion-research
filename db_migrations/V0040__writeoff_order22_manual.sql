UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies SET qty = qty - 3 WHERE id = 1 AND qty >= 3;

INSERT INTO t_p72635010_quantum_fusion_resea.warehouse_movements (group_id, supply_id, order_id, type, qty_delta, cost_price, sale_price, margin, note, created_at)
VALUES (68, 1, 22, 'sale', -3, 5000, 9000, 12000, 'Продажа 3 шт. по заказу #22', NOW());

UPDATE t_p72635010_quantum_fusion_resea.products SET stock_qty = (SELECT COALESCE(SUM(s.qty), 0) FROM t_p72635010_quantum_fusion_resea.warehouse_supplies s JOIN t_p72635010_quantum_fusion_resea.warehouse_groups g ON g.id = s.group_id WHERE g.product_id = products.id), in_stock = (SELECT COALESCE(SUM(s.qty), 0) > 0 FROM t_p72635010_quantum_fusion_resea.warehouse_supplies s JOIN t_p72635010_quantum_fusion_resea.warehouse_groups g ON g.id = s.group_id WHERE g.product_id = products.id) WHERE id = 150;