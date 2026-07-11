-- FAQ: категории вопросов и сами вопросы-ответы.
-- Ответ хранится как HTML-строка (тот же формат, что content у статей).

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.faq_categories (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT DEFAULT 'HelpCircle',
    sort_order  INTEGER DEFAULT 0,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.faq_items (
    id            SERIAL PRIMARY KEY,
    category_id   INTEGER REFERENCES t_p72635010_quantum_fusion_resea.faq_categories(id),
    question      TEXT NOT NULL,
    answer        TEXT NOT NULL DEFAULT '',
    sort_order    INTEGER DEFAULT 0,
    is_published  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faq_items_category ON t_p72635010_quantum_fusion_resea.faq_items(category_id);
CREATE INDEX IF NOT EXISTS idx_faq_items_published ON t_p72635010_quantum_fusion_resea.faq_items(is_published);

-- Стартовые категории (боевые данные, без метки selftest)
INSERT INTO t_p72635010_quantum_fusion_resea.faq_categories (name, icon, sort_order)
VALUES
    ('Оплата',   'CreditCard', 1),
    ('Доставка', 'Truck',      2),
    ('Гарантия', 'ShieldCheck', 3),
    ('Сборка ПК', 'Cpu',       4),
    ('Прочее',   'HelpCircle', 9);
