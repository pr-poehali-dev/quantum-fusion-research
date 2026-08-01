-- Баллы бенчмарка (как в EXE) и флаг падения стресс-теста по OCR
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_results
    ADD COLUMN IF NOT EXISTS score_text TEXT NOT NULL DEFAULT '';
ALTER TABLE t_p72635010_quantum_fusion_resea.stress_results
    ADD COLUMN IF NOT EXISTS ocr_stress_failed BOOLEAN NOT NULL DEFAULT FALSE;