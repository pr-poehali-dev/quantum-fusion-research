ALTER TABLE pc_builds ADD COLUMN IF NOT EXISTS short_code VARCHAR(16);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_builds_short_code ON pc_builds(short_code) WHERE short_code IS NOT NULL;
