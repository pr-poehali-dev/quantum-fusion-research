-- Сборщик ПК: % сотрудника и привязка сборщика к сборке

-- % сборщика у каждого сотрудника (от полной цены ПК)
ALTER TABLE t_p72635010_quantum_fusion_resea.employees
    ADD COLUMN IF NOT EXISTS assembler_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Кто собирал ПК (сотрудник) + флаг, что начисление уже сделано
ALTER TABLE t_p72635010_quantum_fusion_resea.wip_builds
    ADD COLUMN IF NOT EXISTS assembled_by INTEGER;

-- Признак на заказе: сборщику уже начислено (чтобы не задвоить при done)
ALTER TABLE t_p72635010_quantum_fusion_resea.orders
    ADD COLUMN IF NOT EXISTS assembler_paid BOOLEAN NOT NULL DEFAULT FALSE;
