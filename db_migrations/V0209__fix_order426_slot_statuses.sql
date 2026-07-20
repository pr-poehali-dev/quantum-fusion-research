-- Точечный фикс заказа 426: CPU (GUNO0091) и RAM (VNKQ8265) реально есть на
-- складе, но слоты ошибочно помечены как «заказан у поставщика»
-- (ordered_transit/ordered_delay), из-за чего build_order_lines исключал их из
-- резерва. Возвращаем статусы в ready, чтобы резерв встал на наличие.
UPDATE t_p72635010_quantum_fusion_resea.wip_builds
SET cpu_status = 'ready',
    ram_status = 'ready',
    updated_at = NOW()
WHERE order_id = 426;