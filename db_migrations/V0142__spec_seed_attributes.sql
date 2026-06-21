-- Стартовые характеристики (поля) по категориям
-- helper: id категории по code через подзапрос

-- CPU
INSERT INTO spec_attributes (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order)
SELECT id, 'socket', 'Сокет', 'select', '["AM5","AM4","LGA1700","LGA1851","LGA1200","sTR5","sWRX8"]'::jsonb, NULL, TRUE, TRUE, 1 FROM spec_categories WHERE code='cpu'
UNION ALL SELECT id, 'mem_type', 'Тип памяти', 'select', '["DDR5","DDR4"]'::jsonb, NULL, TRUE, TRUE, 2 FROM spec_categories WHERE code='cpu'
UNION ALL SELECT id, 'tdp_watt', 'TDP', 'number', '[]'::jsonb, 'Вт', TRUE, TRUE, 3 FROM spec_categories WHERE code='cpu'
UNION ALL SELECT id, 'cores', 'Ядра', 'number', '[]'::jsonb, NULL, FALSE, FALSE, 4 FROM spec_categories WHERE code='cpu'
UNION ALL SELECT id, 'has_igpu', 'Встроенная графика', 'bool', '[]'::jsonb, NULL, FALSE, FALSE, 5 FROM spec_categories WHERE code='cpu';

-- Motherboard
INSERT INTO spec_attributes (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order)
SELECT id, 'socket', 'Сокет', 'select', '["AM5","AM4","LGA1700","LGA1851","LGA1200","sTR5","sWRX8"]'::jsonb, NULL, TRUE, TRUE, 1 FROM spec_categories WHERE code='motherboard'
UNION ALL SELECT id, 'mem_type', 'Тип памяти', 'select', '["DDR5","DDR4"]'::jsonb, NULL, TRUE, TRUE, 2 FROM spec_categories WHERE code='motherboard'
UNION ALL SELECT id, 'form_factor', 'Форм-фактор', 'select', '["ATX","mATX","Mini-ITX","E-ATX"]'::jsonb, NULL, TRUE, TRUE, 3 FROM spec_categories WHERE code='motherboard'
UNION ALL SELECT id, 'chipset', 'Чипсет', 'text', '[]'::jsonb, NULL, FALSE, FALSE, 4 FROM spec_categories WHERE code='motherboard'
UNION ALL SELECT id, 'mem_slots', 'Слотов памяти', 'number', '[]'::jsonb, NULL, FALSE, TRUE, 5 FROM spec_categories WHERE code='motherboard'
UNION ALL SELECT id, 'm2_slots', 'Слотов M.2', 'number', '[]'::jsonb, NULL, FALSE, FALSE, 6 FROM spec_categories WHERE code='motherboard';

-- RAM
INSERT INTO spec_attributes (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order)
SELECT id, 'mem_type', 'Тип памяти', 'select', '["DDR5","DDR4"]'::jsonb, NULL, TRUE, TRUE, 1 FROM spec_categories WHERE code='ram'
UNION ALL SELECT id, 'ram_form', 'Формат', 'select', '["DIMM","SO-DIMM"]'::jsonb, NULL, TRUE, TRUE, 2 FROM spec_categories WHERE code='ram'
UNION ALL SELECT id, 'modules', 'Кол-во планок', 'number', '[]'::jsonb, NULL, FALSE, TRUE, 3 FROM spec_categories WHERE code='ram'
UNION ALL SELECT id, 'capacity_gb', 'Объём комплекта', 'number', '[]'::jsonb, 'ГБ', FALSE, TRUE, 4 FROM spec_categories WHERE code='ram'
UNION ALL SELECT id, 'freq', 'Частота', 'number', '[]'::jsonb, 'МГц', FALSE, FALSE, 5 FROM spec_categories WHERE code='ram';

-- GPU
INSERT INTO spec_attributes (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order)
SELECT id, 'length_mm', 'Длина', 'number', '[]'::jsonb, 'мм', TRUE, TRUE, 1 FROM spec_categories WHERE code='gpu'
UNION ALL SELECT id, 'tdp_watt', 'Потребление (TGP)', 'number', '[]'::jsonb, 'Вт', TRUE, TRUE, 2 FROM spec_categories WHERE code='gpu'
UNION ALL SELECT id, 'power_connector', 'Разъём питания', 'select', '["8pin","2x8pin","3x8pin","12VHPWR","12V-2x6"]'::jsonb, NULL, FALSE, FALSE, 3 FROM spec_categories WHERE code='gpu';

-- PSU
INSERT INTO spec_attributes (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order)
SELECT id, 'watt', 'Мощность', 'number', '[]'::jsonb, 'Вт', TRUE, TRUE, 1 FROM spec_categories WHERE code='psu'
UNION ALL SELECT id, 'form_factor', 'Форм-фактор', 'select', '["ATX","SFX","SFX-L"]'::jsonb, NULL, TRUE, TRUE, 2 FROM spec_categories WHERE code='psu'
UNION ALL SELECT id, 'connectors', 'Разъёмы', 'multiselect', '["8pin","2x8pin","3x8pin","12VHPWR","12V-2x6"]'::jsonb, NULL, FALSE, FALSE, 3 FROM spec_categories WHERE code='psu';

-- Case
INSERT INTO spec_attributes (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order)
SELECT id, 'mb_form_factors', 'Поддержка плат', 'multiselect', '["ATX","mATX","Mini-ITX","E-ATX"]'::jsonb, NULL, TRUE, TRUE, 1 FROM spec_categories WHERE code='case'
UNION ALL SELECT id, 'max_gpu_length_mm', 'Макс. длина видеокарты', 'number', '[]'::jsonb, 'мм', TRUE, TRUE, 2 FROM spec_categories WHERE code='case'
UNION ALL SELECT id, 'max_cooler_height_mm', 'Макс. высота кулера', 'number', '[]'::jsonb, 'мм', TRUE, FALSE, 3 FROM spec_categories WHERE code='case'
UNION ALL SELECT id, 'psu_form_factor', 'Форм-фактор БП', 'select', '["ATX","SFX","SFX-L"]'::jsonb, NULL, TRUE, FALSE, 4 FROM spec_categories WHERE code='case';

-- Cooling
INSERT INTO spec_attributes (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order)
SELECT id, 'sockets', 'Поддерживаемые сокеты', 'multiselect', '["AM5","AM4","LGA1700","LGA1851","LGA1200","sTR5","sWRX8"]'::jsonb, NULL, TRUE, TRUE, 1 FROM spec_categories WHERE code='cooling'
UNION ALL SELECT id, 'cooler_type', 'Тип', 'select', '["Воздушное","СЖО"]'::jsonb, NULL, FALSE, TRUE, 2 FROM spec_categories WHERE code='cooling'
UNION ALL SELECT id, 'height_mm', 'Высота (башня)', 'number', '[]'::jsonb, 'мм', TRUE, FALSE, 3 FROM spec_categories WHERE code='cooling'
UNION ALL SELECT id, 'tdp_rating', 'Рассеивание TDP', 'number', '[]'::jsonb, 'Вт', FALSE, FALSE, 4 FROM spec_categories WHERE code='cooling';

-- Storage
INSERT INTO spec_attributes (category_id, code, name, field_type, options, unit, affects_compat, is_required, sort_order)
SELECT id, 'interface', 'Интерфейс', 'select', '["M.2 NVMe","M.2 SATA","SATA"]'::jsonb, NULL, TRUE, TRUE, 1 FROM spec_categories WHERE code='storage'
UNION ALL SELECT id, 'capacity_gb', 'Объём', 'number', '[]'::jsonb, 'ГБ', FALSE, FALSE, 2 FROM spec_categories WHERE code='storage';
