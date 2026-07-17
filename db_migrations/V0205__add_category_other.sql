-- П.4 баг-репорта: категория «Прочее» для нетипичных товаров (ноутбуки и пр.).
-- Появляется на этапе создания карточки товара; шаблона названия нет → ручной ввод.
INSERT INTO t_p72635010_quantum_fusion_resea.categories (name, slug, description, sort_order)
SELECT 'Прочее', 'other', 'Нетипичные товары: ноутбуки, периферия и прочее', 999
WHERE NOT EXISTS (
  SELECT 1 FROM t_p72635010_quantum_fusion_resea.categories WHERE slug = 'other'
);