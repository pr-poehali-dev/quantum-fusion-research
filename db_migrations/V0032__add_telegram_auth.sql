ALTER TABLE t_p72635010_quantum_fusion_resea.users
  ADD COLUMN IF NOT EXISTS telegram_id bigint NULL,
  ADD COLUMN IF NOT EXISTS telegram_username varchar(100) NULL,
  ADD COLUMN IF NOT EXISTS telegram_photo varchar(500) NULL;

ALTER TABLE t_p72635010_quantum_fusion_resea.users
  ALTER COLUMN email SET DEFAULT NULL;

ALTER TABLE t_p72635010_quantum_fusion_resea.users
  ALTER COLUMN password_hash SET DEFAULT '';

UPDATE t_p72635010_quantum_fusion_resea.users SET password_hash = '' WHERE password_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_idx ON t_p72635010_quantum_fusion_resea.users(telegram_id) WHERE telegram_id IS NOT NULL;
