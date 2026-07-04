UPDATE t_p72635010_quantum_fusion_resea.price_suggestions
SET status='rejected', decided_at=now()
WHERE status='new' AND kind='price_change'
  AND current_price IS NOT NULL
  AND ROUND(suggested_price)=ROUND(current_price);