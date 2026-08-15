-- Черновики задач из инлайн-режима Telegram.
-- Зачем: id inline-результата ограничен 64 байтами, длинный текст задачи туда
-- не влезает и обрезается. Поэтому в id кладём только короткий ключ, а сам
-- текст храним здесь и достаём в chosen_inline_result.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.tg_task_drafts (
    key         VARCHAR(32) PRIMARY KEY,
    event_date  DATE NOT NULL,
    title       TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_task_drafts_created
    ON t_p72635010_quantum_fusion_resea.tg_task_drafts (created_at);