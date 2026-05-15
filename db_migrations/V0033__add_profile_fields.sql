ALTER TABLE t_p72635010_quantum_fusion_resea.users
  ADD COLUMN IF NOT EXISTS bio text NULL,
  ADD COLUMN IF NOT EXISTS phone varchar(30) NULL,
  ADD COLUMN IF NOT EXISTS vk_url varchar(200) NULL,
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
