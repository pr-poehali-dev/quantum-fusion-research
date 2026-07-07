-- Синхронизация устаревших названий компонентов в wip_builds с актуальными
-- именами из products (после переименования складских карточек).
-- Затрагивает одиночные слоты: cpu, motherboard, ram, gpu, storage, psu,
-- case_name, cooling. Слот extra (допы) пропускаем — там несколько товаров
-- в одной строке, актуальное имя фронт берёт из состава сборки.

UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET cpu = p.name, updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.pc_builds pb,
     jsonb_array_elements(pb.components) c
     JOIN t_p72635010_quantum_fusion_resea.products p
       ON p.id = (c->>'source_id')::int
WHERE w.build_id = pb.id AND c->>'slot' = 'cpu'
  AND c->>'source' = 'catalog' AND w.cpu IS DISTINCT FROM p.name;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET motherboard = p.name, updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.pc_builds pb,
     jsonb_array_elements(pb.components) c
     JOIN t_p72635010_quantum_fusion_resea.products p
       ON p.id = (c->>'source_id')::int
WHERE w.build_id = pb.id AND c->>'slot' = 'motherboard'
  AND c->>'source' = 'catalog' AND w.motherboard IS DISTINCT FROM p.name;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET ram = p.name, updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.pc_builds pb,
     jsonb_array_elements(pb.components) c
     JOIN t_p72635010_quantum_fusion_resea.products p
       ON p.id = (c->>'source_id')::int
WHERE w.build_id = pb.id AND c->>'slot' = 'ram'
  AND c->>'source' = 'catalog' AND w.ram IS DISTINCT FROM p.name;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET gpu = p.name, updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.pc_builds pb,
     jsonb_array_elements(pb.components) c
     JOIN t_p72635010_quantum_fusion_resea.products p
       ON p.id = (c->>'source_id')::int
WHERE w.build_id = pb.id AND c->>'slot' = 'gpu'
  AND c->>'source' = 'catalog' AND w.gpu IS DISTINCT FROM p.name;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET storage = p.name, updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.pc_builds pb,
     jsonb_array_elements(pb.components) c
     JOIN t_p72635010_quantum_fusion_resea.products p
       ON p.id = (c->>'source_id')::int
WHERE w.build_id = pb.id AND c->>'slot' = 'storage'
  AND c->>'source' = 'catalog' AND w.storage IS DISTINCT FROM p.name;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET psu = p.name, updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.pc_builds pb,
     jsonb_array_elements(pb.components) c
     JOIN t_p72635010_quantum_fusion_resea.products p
       ON p.id = (c->>'source_id')::int
WHERE w.build_id = pb.id AND c->>'slot' = 'psu'
  AND c->>'source' = 'catalog' AND w.psu IS DISTINCT FROM p.name;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET case_name = p.name, updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.pc_builds pb,
     jsonb_array_elements(pb.components) c
     JOIN t_p72635010_quantum_fusion_resea.products p
       ON p.id = (c->>'source_id')::int
WHERE w.build_id = pb.id AND c->>'slot' = 'case'
  AND c->>'source' = 'catalog' AND w.case_name IS DISTINCT FROM p.name;

UPDATE t_p72635010_quantum_fusion_resea.wip_builds w
SET cooling = p.name, updated_at = NOW()
FROM t_p72635010_quantum_fusion_resea.pc_builds pb,
     jsonb_array_elements(pb.components) c
     JOIN t_p72635010_quantum_fusion_resea.products p
       ON p.id = (c->>'source_id')::int
WHERE w.build_id = pb.id AND c->>'slot' = 'cooling'
  AND c->>'source' = 'catalog' AND w.cooling IS DISTINCT FROM p.name;
