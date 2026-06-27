-- Реквизиты поставщика для договора поставки (одна строка настроек).
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.company_settings (
    id              INTEGER PRIMARY KEY DEFAULT 1,
    supplier_name   TEXT DEFAULT 'ИП Колодяжный Михаил Георгиевич',
    supplier_person TEXT DEFAULT 'Колодяжного Михаила Георгиевича',
    sign_name       TEXT DEFAULT 'Колодяжный М. Г.',
    rs              TEXT DEFAULT '',
    bank            TEXT DEFAULT '',
    ks              TEXT DEFAULT '',
    bik             TEXT DEFAULT '',
    inn             TEXT DEFAULT '',
    ogrnip          TEXT DEFAULT '',
    city            TEXT DEFAULT 'Москва',
    delivery_days   INTEGER DEFAULT 20,
    updated_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT company_settings_singleton CHECK (id = 1)
);

INSERT INTO t_p72635010_quantum_fusion_resea.company_settings
    (id, rs, bank, ks, bik, inn, ogrnip)
VALUES (1,
    '40802810638000265732',
    'ПАО Сбербанк',
    '30101810400000000225',
    '044525225',
    '772830303143',
    '320774600467371')
ON CONFLICT (id) DO NOTHING;
