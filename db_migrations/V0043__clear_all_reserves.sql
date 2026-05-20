UPDATE t_p72635010_quantum_fusion_resea.warehouse_supplies
SET qty_reserved = 0, qty_negative = 0
WHERE qty_reserved > 0 OR qty_negative > 0;