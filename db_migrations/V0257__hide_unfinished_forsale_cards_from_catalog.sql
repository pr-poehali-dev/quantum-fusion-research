-- Сборки «в свободную продажу» с неоформленной карточкой (нет фото и/или
-- служебное название вида «Заказ 00806») убираем из каталога в черновики.
-- Данные сохраняются: как только менеджер добавит фото и название, карточка
-- опубликуется сама. Клиентские (status='client') не трогаем.
UPDATE t_p72635010_quantum_fusion_resea.pc_builds pb
SET status = 'draft', in_stock = FALSE
WHERE pb.status = 'catalog'
  AND EXISTS (
    SELECT 1 FROM t_p72635010_quantum_fusion_resea.wip_builds w
    WHERE w.build_id = pb.id AND w.for_sale = TRUE
  )
  AND (
    COALESCE(jsonb_array_length(
      CASE WHEN jsonb_typeof(COALESCE(pb.image_urls::jsonb, '[]'::jsonb)) = 'array'
           THEN pb.image_urls::jsonb ELSE '[]'::jsonb END), 0) = 0
    OR LOWER(TRIM(pb.name)) LIKE 'заказ%'
    OR LOWER(TRIM(pb.name)) LIKE 'сборка%'
  );
