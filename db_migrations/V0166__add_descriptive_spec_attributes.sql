-- Недостающие описательные характеристики для блочной формы товара.
-- Не влияют на совместимость (affects_compat=false). Вставляем только если кода ещё нет.

INSERT INTO t_p72635010_quantum_fusion_resea.spec_attributes
    (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order, applies_to)
SELECT v.category_id, v.code, v.name, v.field_type, v.options::jsonb, v.unit, false, false, v.sort_order, 'all'
FROM (VALUES
    -- CPU
    (1, 'series', 'Серия', 'text', '[]', NULL, 20),
    -- Материнская плата
    (2, 'color', 'Цвет', 'select', '["Чёрный","Белый","Серебристый","Чёрно-белый","RGB"]', NULL, 20),
    (2, 'series', 'Серия', 'text', '[]', NULL, 21),
    -- ОЗУ
    (3, 'color', 'Цвет', 'select', '["Чёрный","Белый","Серебристый","Серый","RGB"]', NULL, 20),
    -- Видеокарта
    (4, 'series', 'Серия / чип', 'text', '[]', NULL, 20),
    (4, 'color', 'Цвет', 'select', '["Чёрный","Белый","Серебристый","RGB"]', NULL, 21),
    -- Накопитель
    (5, 'storage_type', 'Тип', 'select', '["SSD","HDD","SSD M.2","SSHD"]', NULL, 0),
    (5, 'form_factor', 'Форм-фактор', 'select', '["2.5\"","3.5\"","M.2 2280","M.2 2230","M.2 2242"]', NULL, 3),
    -- Блок питания
    (6, 'series', 'Серия', 'text', '[]', NULL, 0),
    (6, 'color', 'Цвет', 'select', '["Чёрный","Белый","Серебристый","RGB"]', NULL, 3),
    -- Корпус
    (7, 'color', 'Цвет', 'select', '["Чёрный","Белый","Серый","Серебристый","RGB"]', NULL, 0),
    (7, 'series', 'Серия', 'text', '[]', NULL, 6),
    -- Охлаждение
    (8, 'cooler_type', 'Тип охлаждения', 'select', '["Воздушное","СЖО (жидкостное)"]', NULL, 0),
    (8, 'series', 'Серия', 'text', '[]', NULL, 20)
) AS v(category_id, code, name, field_type, options, unit, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM t_p72635010_quantum_fusion_resea.spec_attributes sa
    WHERE sa.category_id = v.category_id AND sa.code = v.code
);
