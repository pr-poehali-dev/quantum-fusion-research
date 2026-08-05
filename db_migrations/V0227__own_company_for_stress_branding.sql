-- Своя компания для стресс-тестов: тот же интерфейс брендинга, что у партнёров,
-- но для нас. Флаг is_own отличает её от партнёрских.
ALTER TABLE t_p72635010_quantum_fusion_resea.partner_companies
  ADD COLUMN IF NOT EXISTS is_own BOOLEAN NOT NULL DEFAULT FALSE;

-- Ровно одна «своя» компания
CREATE UNIQUE INDEX IF NOT EXISTS partner_companies_one_own
  ON t_p72635010_quantum_fusion_resea.partner_companies (is_own)
  WHERE is_own;

INSERT INTO t_p72635010_quantum_fusion_resea.partner_companies
  (name, tier, status, is_own, white_label_enabled, note)
SELECT 'Deboshir', 'close', 'active', TRUE, TRUE, 'Наша компания — брендинг отчётов'
WHERE NOT EXISTS (
  SELECT 1 FROM t_p72635010_quantum_fusion_resea.partner_companies WHERE is_own
);
