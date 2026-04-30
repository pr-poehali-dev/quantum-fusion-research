INSERT INTO categories (name, slug, description, sort_order) VALUES
  ('Видеокарты', 'gpu', 'Игровые и профессиональные GPU', 1),
  ('Процессоры', 'cpu', 'Intel и AMD процессоры', 2),
  ('Оперативная память', 'ram', 'DDR4 и DDR5 модули', 3),
  ('Материнские платы', 'motherboard', 'ATX, mATX, ITX платформы', 4),
  ('Накопители', 'storage', 'SSD NVMe и SATA', 5),
  ('Блоки питания', 'psu', 'Сертифицированные БП', 6),
  ('Корпуса', 'case', 'ATX и compact корпуса', 7),
  ('Готовые сборки', 'builds', 'ПК под заказ под ключ', 8)
ON CONFLICT (slug) DO NOTHING