ALTER TABLE articles
  ALTER COLUMN created_at SET DEFAULT NOW();

UPDATE articles SET created_at = NOW() WHERE created_at IS NULL;