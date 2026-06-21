-- Стартовые правила связей между характеристиками (карта совместимости)
-- helper для получения attribute_id по (category_code, attr_code)

WITH a AS (
  SELECT sa.id, sc.code AS cat, sa.code AS attr
  FROM spec_attributes sa JOIN spec_categories sc ON sc.id = sa.category_id
)
INSERT INTO spec_links (name, from_attribute_id, to_attribute_id, rule, note)
SELECT 'Сокет процессора = сокет платы',
       (SELECT id FROM a WHERE cat='cpu' AND attr='socket'),
       (SELECT id FROM a WHERE cat='motherboard' AND attr='socket'),
       'eq', 'Процессор и плата должны иметь одинаковый сокет'
UNION ALL
SELECT 'Тип памяти процессора = тип памяти платы',
       (SELECT id FROM a WHERE cat='cpu' AND attr='mem_type'),
       (SELECT id FROM a WHERE cat='motherboard' AND attr='mem_type'),
       'eq', NULL
UNION ALL
SELECT 'Тип памяти ОЗУ = тип памяти платы',
       (SELECT id FROM a WHERE cat='ram' AND attr='mem_type'),
       (SELECT id FROM a WHERE cat='motherboard' AND attr='mem_type'),
       'eq', NULL
UNION ALL
SELECT 'Видеокарта влезает в корпус по длине',
       (SELECT id FROM a WHERE cat='gpu' AND attr='length_mm'),
       (SELECT id FROM a WHERE cat='case' AND attr='max_gpu_length_mm'),
       'lte', 'Длина видеокарты <= макс. длины корпуса'
UNION ALL
SELECT 'Кулер влезает в корпус по высоте',
       (SELECT id FROM a WHERE cat='cooling' AND attr='height_mm'),
       (SELECT id FROM a WHERE cat='case' AND attr='max_cooler_height_mm'),
       'lte', NULL
UNION ALL
SELECT 'Кулер поддерживает сокет процессора',
       (SELECT id FROM a WHERE cat='cpu' AND attr='socket'),
       (SELECT id FROM a WHERE cat='cooling' AND attr='sockets'),
       'contains', 'Сокет CPU должен входить в список поддерживаемых кулером'
UNION ALL
SELECT 'Корпус поддерживает форм-фактор платы',
       (SELECT id FROM a WHERE cat='motherboard' AND attr='form_factor'),
       (SELECT id FROM a WHERE cat='case' AND attr='mb_form_factors'),
       'contains', NULL
UNION ALL
SELECT 'Форм-фактор БП подходит корпусу',
       (SELECT id FROM a WHERE cat='psu' AND attr='form_factor'),
       (SELECT id FROM a WHERE cat='case' AND attr='psu_form_factor'),
       'eq', NULL;
