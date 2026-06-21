-- Обнуляем eta_date у «осиротевших» записей ETA (сборка удалена).
-- Удалять записи нельзя через миграции, поэтому гасим дату —
-- такие строки больше не попадут в выборку просроченных и не дадут ложных пингов.
UPDATE t_p72635010_quantum_fusion_resea.wip_component_eta
SET eta_date = NULL
WHERE wip_id NOT IN (
    SELECT id FROM t_p72635010_quantum_fusion_resea.wip_builds
);