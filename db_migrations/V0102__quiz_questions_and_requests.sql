-- Вопросы анкеты (настраиваются из админки)
CREATE TABLE IF NOT EXISTS quiz_questions (
    id SERIAL PRIMARY KEY,
    sort_order INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'multi', -- multi | single | budget | contacts | text
    options JSONB NOT NULL DEFAULT '[]'::jsonb, -- варианты ответов для multi/single
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Заявки клиентов
CREATE TABLE IF NOT EXISTS quiz_requests (
    id SERIAL PRIMARY KEY,
    name TEXT,
    phone TEXT,
    contact_method TEXT,
    budget_min INTEGER,
    budget_max INTEGER,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "<question_id>": ["вариант1","вариант2"], ... }
    extra_wishes TEXT,
    status TEXT NOT NULL DEFAULT 'new', -- new | in_progress | done | rejected
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_requests_created ON quiz_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_sort ON quiz_questions(sort_order);

-- Засев 9 вопросов
INSERT INTO quiz_questions (sort_order, title, field_type, options) VALUES
(1, 'Задачи', 'multi', '["Игры","Работа","Монтаж видео","3D / рендеринг","Стриминг","Программирование","Офис / учёба","Сервер"]'::jsonb),
(2, 'Габариты корпуса', 'single', '["Компактный (Mini-ITX)","Средний (mATX)","Полноразмерный (ATX)","Большой (Full Tower)","Не важно"]'::jsonb),
(3, 'Цвет корпуса', 'single', '["Чёрный","Белый","Серый","С RGB-подсветкой","Не важно"]'::jsonb),
(4, 'Тип корпуса', 'single', '["Глухой (без окна)","С прозрачной стенкой","Аквариум (панорамный)","Открытый стенд","Не важно"]'::jsonb),
(5, 'Подсветка', 'multi', '["Без подсветки","RGB вентиляторы","ARGB лента","Подсветка комплектующих","Минималистичная","Максимум RGB"]'::jsonb),
(6, 'Предпочтения по комплектующим', 'multi', '["Intel","AMD","NVIDIA","Radeon","Без предпочтений","Только новые","Можно б/у","Премиум-бренды"]'::jsonb),
(7, 'Желаемый бюджет', 'budget', '[]'::jsonb),
(8, 'Тишина и пылезащита', 'multi', '["Максимально тихий","Хорошее охлаждение","Пылевые фильтры","Водяное охлаждение","Не важно"]'::jsonb),
(9, 'Как связаться', 'contacts', '[]'::jsonb);
