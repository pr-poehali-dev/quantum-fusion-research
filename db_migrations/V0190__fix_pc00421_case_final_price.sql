-- Разовый фикс данных заказа PC00421 (id=421): у корпуса "Lian Li Vision
-- Compact White" (slot='case', id=592) поле final_price ошибочно = 3500
-- (прилипло от соседней позиции slot='case' из-за старого бага set_price).
-- Сбрасываем final_price этой позиции в null → цена возьмётся из price (11532),
-- и пересчитываем total. Правим строго позицию с id=592 и slot='case'.

WITH src AS (
    SELECT id, items FROM t_p72635010_quantum_fusion_resea.orders WHERE id = 421
),
rebuilt AS (
    SELECT s.id,
        (
            SELECT jsonb_agg(
                CASE
                    WHEN (elem->>'id') = '592' AND (elem->>'slot') = 'case'
                    THEN elem - 'final_price'
                    ELSE elem
                END
                ORDER BY ord
            )
            FROM jsonb_array_elements(s.items) WITH ORDINALITY AS t(elem, ord)
        ) AS new_items
    FROM src s
)
UPDATE t_p72635010_quantum_fusion_resea.orders o
SET items = r.new_items,
    total = (
        SELECT COALESCE(SUM(
            COALESCE( NULLIF(e->>'final_price','')::numeric, (e->>'price')::numeric, 0)
            * COALESCE((e->>'quantity')::int, 1)
        ), 0)
        FROM jsonb_array_elements(r.new_items) e
        WHERE COALESCE(e->>'item_status','') <> 'returned'
    ),
    updated_at = NOW()
FROM rebuilt r
WHERE o.id = r.id;
