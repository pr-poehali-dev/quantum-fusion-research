CREATE TABLE IF NOT EXISTS user_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
)