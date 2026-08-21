-- Склейка уведомлений одного прогона: слот сообщения с НЕСКОЛЬКИМИ ключами.
-- Программа шлёт события по одному прогону разными путями и не всегда кладёт
-- run_uid (например, в алерте о перегреве GPU его нет). Поэтому слот ищем по
-- любому известному идентификатору: run_uid, номер заказа, имя стенда.
-- Все алиасы указывают на одно и то же message_id.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_notify_merge (
  id          BIGSERIAL PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  slot_key    TEXT NOT NULL,
  slot_uid    TEXT NOT NULL,          -- общий идентификатор слота для всех алиасов
  message_id  BIGINT,
  rank        SMALLINT NOT NULL DEFAULT 0,
  event       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS stress_notify_merge_uniq
  ON t_p72635010_quantum_fusion_resea.stress_notify_merge (chat_id, slot_key);
CREATE INDEX IF NOT EXISTS stress_notify_merge_slot_idx
  ON t_p72635010_quantum_fusion_resea.stress_notify_merge (slot_uid);
CREATE INDEX IF NOT EXISTS stress_notify_merge_time_idx
  ON t_p72635010_quantum_fusion_resea.stress_notify_merge (sent_at);
