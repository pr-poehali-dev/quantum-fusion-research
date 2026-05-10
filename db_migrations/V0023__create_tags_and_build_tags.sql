CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    color VARCHAR(32) NOT NULL DEFAULT 'primary',
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.build_tags (
    build_id INT NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.pc_builds(id),
    tag_id INT NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.tags(id),
    PRIMARY KEY (build_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_build_tags_build_id ON t_p72635010_quantum_fusion_resea.build_tags(build_id);
CREATE INDEX IF NOT EXISTS idx_build_tags_tag_id ON t_p72635010_quantum_fusion_resea.build_tags(tag_id);