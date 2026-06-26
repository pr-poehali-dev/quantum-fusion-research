-- Недостающие характеристики для блочной сборки названия товара (мастер группы).
-- Не влияют на совместимость. Вставляем только если кода ещё нет в категории.

INSERT INTO t_p72635010_quantum_fusion_resea.spec_attributes
    (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order, applies_to)
SELECT v.category_id, v.code, v.name, v.field_type, v.options::jsonb, v.unit, false, false, v.sort_order, 'all'
FROM (VALUES
    -- CPU: линейка, модель, исполнение
    (1, 'lineup', 'Линейка', 'text', '[]', NULL, 21),
    (1, 'model', 'Модель', 'text', '[]', NULL, 22),
    (1, 'edition', 'Исполнение', 'select', '["BOX","OEM"]', NULL, 23),
    -- Материнка: модель
    (2, 'model', 'Модель', 'text', '[]', NULL, 22),
    -- ОЗУ: объём одной планки (новая); кол-во планок уже есть (modules), объём комплекта есть (capacity_gb)
    (3, 'module_capacity_gb', 'Объём 1 планки', 'select', '["8","16","24","32","48"]', 'ГБ', 6),
    -- Видеокарта: модель GPU, видеопамять
    (4, 'model', 'Модель', 'text', '[]', NULL, 19),
    (4, 'vram_gb', 'Видеопамять', 'text', '[]', NULL, 22),
    -- Накопитель: модель
    (5, 'model', 'Модель', 'text', '[]', NULL, 0),
    -- БП: стандарт (ATX 3.1 и т.п.)
    (6, 'atx_standard', 'Стандарт', 'select', '["ATX 3.1","ATX 3.0","ATX 2.x","-"]', NULL, 2),
    -- Корпус: модель
    (7, 'model', 'Модель', 'text', '[]', NULL, 1),
    -- Охлаждение: модель, цвет
    (8, 'model', 'Модель', 'text', '[]', NULL, 1),
    (8, 'color', 'Цвет', 'select', '["Чёрный","Белый","Серебристый","RGB"]', NULL, 21)
) AS v(category_id, code, name, field_type, options, unit, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM t_p72635010_quantum_fusion_resea.spec_attributes sa
    WHERE sa.category_id = v.category_id AND sa.code = v.code
);
