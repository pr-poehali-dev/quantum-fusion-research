-- ============================================================
-- DATA-DRIVEN КОНСТРУКТОР ХАРАКТЕРИСТИК СОВМЕСТИМОСТИ
-- ============================================================

-- 1. Категории компонентов (расширяемый справочник типов железа)
CREATE TABLE IF NOT EXISTS spec_categories (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(50) NOT NULL UNIQUE,   -- cpu, motherboard, ram ...
    name            VARCHAR(120) NOT NULL,         -- "Процессор"
    icon            VARCHAR(50),                   -- lucide-иконка (Cpu, CircuitBoard ...)
    color           VARCHAR(30),                   -- цвет узла в графе
    -- slug категории товара (categories.slug), чтобы авто-привязывать железки
    product_category_slug VARCHAR(100),
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 2. Характеристики (поля) каждой категории — конструктор полей
CREATE TABLE IF NOT EXISTS spec_attributes (
    id              SERIAL PRIMARY KEY,
    category_id     INTEGER NOT NULL REFERENCES spec_categories(id),
    code            VARCHAR(60) NOT NULL,          -- socket, mem_type, length_mm
    name            VARCHAR(150) NOT NULL,         -- "Сокет"
    -- тип ввода: select, multiselect, number, bool, text
    field_type      VARCHAR(20) NOT NULL DEFAULT 'text',
    options         JSONB DEFAULT '[]'::jsonb,     -- варианты для select/multiselect
    unit            VARCHAR(20),                   -- мм, Вт, ГБ
    -- роль характеристики:
    --   true  = влияет на совместимость (может участвовать в связях)
    --   false = просто для ознакомления (показ в карточке, ничего не блокирует)
    affects_compat  BOOLEAN DEFAULT FALSE,
    is_required     BOOLEAN DEFAULT FALSE,         -- для статуса новый/готов
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (category_id, code)
);

-- 3. Значения характеристик у конкретного товара
CREATE TABLE IF NOT EXISTS product_spec_values (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL REFERENCES products(id),
    attribute_id    INTEGER NOT NULL REFERENCES spec_attributes(id),
    value           TEXT,                          -- скаляр (число/строка/bool как текст)
    value_json      JSONB,                         -- для multiselect (массив)
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (product_id, attribute_id)
);

-- 4. Правила связей между характеристиками разных категорий (карта совместимости)
CREATE TABLE IF NOT EXISTS spec_links (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200),                  -- человекочитаемое описание (опц.)
    -- "левая" характеристика
    from_attribute_id INTEGER NOT NULL REFERENCES spec_attributes(id),
    -- "правая" характеристика
    to_attribute_id   INTEGER NOT NULL REFERENCES spec_attributes(id),
    -- тип правила:
    --   eq        — значения должны совпадать (socket == socket)
    --   lte       — from <= to (длина GPU <= макс. длина корпуса)
    --   gte       — from >= to (мощность БП >= потребление)
    --   contains  — список to содержит значение from (сокеты кулера содержат сокет CPU)
    rule            VARCHAR(20) NOT NULL DEFAULT 'eq',
    note            TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spec_attrs_cat ON spec_attributes(category_id);
CREATE INDEX IF NOT EXISTS idx_psv_product ON product_spec_values(product_id);
CREATE INDEX IF NOT EXISTS idx_psv_attr ON product_spec_values(attribute_id);
CREATE INDEX IF NOT EXISTS idx_spec_links_from ON spec_links(from_attribute_id);
CREATE INDEX IF NOT EXISTS idx_spec_links_to ON spec_links(to_attribute_id);

-- ============================================================
-- СИД: стартовые категории компонентов
-- ============================================================
INSERT INTO spec_categories (code, name, icon, color, product_category_slug, sort_order) VALUES
    ('cpu',         'Процессор',          'Cpu',          '#ef4444', 'cpu',         1),
    ('motherboard', 'Материнская плата',  'CircuitBoard', '#f97316', 'motherboard', 2),
    ('ram',         'Оперативная память', 'MemoryStick',  '#eab308', 'ram',         3),
    ('gpu',         'Видеокарта',         'Gpu',          '#22c55e', 'gpu',         4),
    ('storage',     'Накопитель',         'HardDrive',    '#14b8a6', 'storage',     5),
    ('psu',         'Блок питания',       'Plug',         '#3b82f6', 'psu',         6),
    ('case',        'Корпус',             'Box',          '#8b5cf6', 'case',        7),
    ('cooling',     'Охлаждение',         'Fan',          '#06b6d4', 'cooling',     8),
    ('fan',         'Вентилятор',         'Fan',          '#64748b', 'fan',         9)
ON CONFLICT (code) DO NOTHING;
