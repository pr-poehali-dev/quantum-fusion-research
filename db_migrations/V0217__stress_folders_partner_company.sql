-- Папки прогонов тоже разделяем по партнёрской компании (NULL = админские/общие)
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_folders
    ADD COLUMN IF NOT EXISTS partner_company_id INTEGER NULL;
CREATE INDEX IF NOT EXISTS idx_stress_folders_partner_company
    ON t_p72635010_quantum_fusion_resea.stress_folders (partner_company_id);