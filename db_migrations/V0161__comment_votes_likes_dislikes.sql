CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.comment_votes (
    id SERIAL PRIMARY KEY,
    comment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_votes_comment ON t_p72635010_quantum_fusion_resea.comment_votes(comment_id);
