CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.build_comments (
  id SERIAL PRIMARY KEY,
  build_token TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  parent_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.build_comments(id),
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_build_comments_token ON t_p72635010_quantum_fusion_resea.build_comments(build_token);
CREATE INDEX IF NOT EXISTS idx_build_comments_parent ON t_p72635010_quantum_fusion_resea.build_comments(parent_id);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON t_p72635010_quantum_fusion_resea.notifications(user_id);
