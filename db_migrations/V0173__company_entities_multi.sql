-- Несколько юрлиц (реквизитов) для договора поставки.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.company_entities (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT 'Юрлицо',
    supplier_name   TEXT DEFAULT '',
    supplier_person TEXT DEFAULT '',
    sign_name       TEXT DEFAULT '',
    rs              TEXT DEFAULT '',
    bank            TEXT DEFAULT '',
    ks              TEXT DEFAULT '',
    bik             TEXT DEFAULT '',
    inn             TEXT DEFAULT '',
    ogrnip          TEXT DEFAULT '',
    city            TEXT DEFAULT 'Москва',
    delivery_days   INTEGER DEFAULT 20,
    is_default      BOOLEAN DEFAULT FALSE,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- Переносим текущую единственную запись настроек как первое юрлицо (по умолчанию)
INSERT INTO t_p72635010_quantum_fusion_resea.company_entities
    (title, supplier_name, supplier_person, sign_name, rs, bank, ks, bik, inn, ogrnip, city, delivery_days, is_default, sort_order)
SELECT
    COALESCE(NULLIF(cs.supplier_name, ''), 'Основное юрлицо'),
    cs.supplier_name, cs.supplier_person, cs.sign_name, cs.rs, cs.bank, cs.ks,
    cs.bik, cs.inn, cs.ogrnip, cs.city, cs.delivery_days, TRUE, 0
FROM t_p72635010_quantum_fusion_resea.company_settings cs
WHERE cs.id = 1
  AND NOT EXISTS (SELECT 1 FROM t_p72635010_quantum_fusion_resea.company_entities);
