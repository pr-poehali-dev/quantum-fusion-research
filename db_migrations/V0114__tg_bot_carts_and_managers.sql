-- Корзины пользователей Telegram-бота (по chat_id)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.tg_bot_carts (
    chat_id      BIGINT PRIMARY KEY,
    state        VARCHAR(32) DEFAULT 'idle',
    state_data   JSONB DEFAULT '{}'::jsonb,
    items        JSONB DEFAULT '[]'::jsonb,
    updated_at   TIMESTAMP DEFAULT NOW()
);

-- Менеджеры бота (chat_id, которым разрешено создавать заказы как менеджер)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.tg_bot_managers (
    chat_id      BIGINT PRIMARY KEY,
    username     VARCHAR(64),
    full_name    VARCHAR(128),
    added_at     TIMESTAMP DEFAULT NOW()
);