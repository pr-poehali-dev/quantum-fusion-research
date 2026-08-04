-- Telegram-уведомления партнёров о стресс-тестах.
-- 1) Чаты партнёра (куда слать). 2) Настройки: общие на компанию + переопределение на чат.

-- Настройки уведомлений компании (одна строка на компанию).
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_notify_settings (
    company_id      INTEGER PRIMARY KEY,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    on_run_started  BOOLEAN NOT NULL DEFAULT FALSE,
    on_test_failed  BOOLEAN NOT NULL DEFAULT TRUE,
    on_run_finished BOOLEAN NOT NULL DEFAULT TRUE,
    only_failures   BOOLEAN NOT NULL DEFAULT FALSE,
    tpl_run_started  TEXT NOT NULL DEFAULT '',
    tpl_test_failed  TEXT NOT NULL DEFAULT '',
    tpl_run_finished TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Чаты партнёра. chat_id уникален глобально: один чат = одна компания,
-- чтобы чужие прогоны не утекали в посторонний чат.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_notify_chats (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL,
    chat_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    on_run_started  BOOLEAN NULL,
    on_test_failed  BOOLEAN NULL,
    on_run_finished BOOLEAN NULL,
    only_failures   BOOLEAN NULL,
    tpl_run_started  TEXT NOT NULL DEFAULT '',
    tpl_test_failed  TEXT NOT NULL DEFAULT '',
    tpl_run_finished TEXT NOT NULL DEFAULT '',
    last_ok_at    TIMESTAMPTZ NULL,
    last_error    TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS stress_notify_chats_chat_uniq
    ON t_p72635010_quantum_fusion_resea.stress_notify_chats (chat_id);
CREATE INDEX IF NOT EXISTS stress_notify_chats_company_idx
    ON t_p72635010_quantum_fusion_resea.stress_notify_chats (company_id);
