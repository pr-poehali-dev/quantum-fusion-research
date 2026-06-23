-- Несколько типов (категорий) у одной статьи. categories — массив кодов.
-- Старое поле category оставляем как «основную» (первый элемент) для совместимости.
ALTER TABLE t_p72635010_quantum_fusion_resea.articles
  ADD COLUMN IF NOT EXISTS categories JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Перенос текущей одиночной категории в массив для существующих статей
UPDATE t_p72635010_quantum_fusion_resea.articles
SET categories = to_jsonb(ARRAY[category])
WHERE (categories = '[]'::jsonb OR categories IS NULL)
  AND category IS NOT NULL AND category <> '';
