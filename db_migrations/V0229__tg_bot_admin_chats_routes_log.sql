-- Управление Telegram-ботом из админки: чаты, маршруты событий, журнал

-- Чаты, куда бот умеет писать (рабочий, задачи, цены, стресс-тесты и любые новые)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.tg_chats (
    id            SERIAL PRIMARY KEY,
    chat_id       BIGINT NOT NULL UNIQUE,
    title         VARCHAR(200) NOT NULL,
    thread_id     INTEGER,                    -- ветка форума, если нужна
    kind          VARCHAR(20) DEFAULT 'group',-- group | private | channel
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    note          TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT now()
);

-- Типы событий и куда они уходят. chat_id NULL = использовать чат по умолчанию
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.tg_event_routes (
    id            SERIAL PRIMARY KEY,
    event_key     VARCHAR(60) NOT NULL UNIQUE,
    title         VARCHAR(160) NOT NULL,
    category      VARCHAR(40) NOT NULL DEFAULT 'other',
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    chat_id       BIGINT,
    updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

-- Журнал отправок: что, куда, когда и с каким результатом
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.tg_send_log (
    id            SERIAL PRIMARY KEY,
    event_key     VARCHAR(60),
    chat_id       BIGINT,
    status        VARCHAR(16) NOT NULL,       -- ok | error | skipped
    error         TEXT,
    preview       VARCHAR(300),
    duration_ms   INTEGER,
    created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_send_log_created ON t_p72635010_quantum_fusion_resea.tg_send_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_send_log_event ON t_p72635010_quantum_fusion_resea.tg_send_log (event_key);

-- Каталог событий: всё, что бот реально шлёт сегодня
INSERT INTO t_p72635010_quantum_fusion_resea.tg_event_routes (event_key, title, category) VALUES
    ('order_new',        'Новый заказ с сайта',                'orders'),
    ('order_status',     'Смена статуса заказа',               'orders'),
    ('order_prepayment', 'Получена предоплата',                'orders'),
    ('quiz_lead',        'Новый лид из квиза',                 'leads'),
    ('bot_order',        'Заказ железа через Telegram-бота',   'orders'),
    ('warehouse_low',    'Заканчивается товар на складе',      'warehouse'),
    ('purchase_basket',  'Позиция добавлена в корзину закупки','warehouse'),
    ('reserve_task',     'Задачи по резервам',                 'tasks'),
    ('wip_delay',        'Задержка сборки',                    'builds'),
    ('calendar_morning', 'Утренний план на день',              'tasks'),
    ('calendar_event',   'Событие календаря',                  'tasks'),
    ('price_change',     'Изменение цен у поставщиков',        'prices'),
    ('stress_result',    'Результат стресс-теста',             'stress')
ON CONFLICT (event_key) DO NOTHING;
