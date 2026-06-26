-- Расплющиваем вложенность комментариев: ответы на ответы перевешиваем на корень ветки.
-- Фронт отображает только ответы первого уровня (parent_id = корневой комментарий),
-- поэтому глубоко вложенные старые комментарии не показывались.
WITH RECURSIVE roots AS (
    -- стартуем с корневых комментариев
    SELECT id, id AS root_id
    FROM t_p72635010_quantum_fusion_resea.build_comments
    WHERE parent_id IS NULL
    UNION ALL
    -- спускаемся вниз, неся с собой root_id корня
    SELECT c.id, r.root_id
    FROM t_p72635010_quantum_fusion_resea.build_comments c
    JOIN roots r ON c.parent_id = r.id
)
UPDATE t_p72635010_quantum_fusion_resea.build_comments bc
SET parent_id = roots.root_id
FROM roots
WHERE bc.id = roots.id
  AND bc.parent_id IS NOT NULL
  AND bc.parent_id <> roots.root_id;
