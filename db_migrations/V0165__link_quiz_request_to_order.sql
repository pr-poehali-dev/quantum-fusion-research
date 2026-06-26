-- Привязка заявки (quiz_requests) к заказу (orders) для аналитики.
ALTER TABLE t_p72635010_quantum_fusion_resea.orders
    ADD COLUMN IF NOT EXISTS quiz_request_id INTEGER
        REFERENCES t_p72635010_quantum_fusion_resea.quiz_requests(id);

-- Источник заявки: quiz (квиз), form (контактная форма), build (из сборки) и т.п.
ALTER TABLE t_p72635010_quantum_fusion_resea.quiz_requests
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'quiz';

CREATE INDEX IF NOT EXISTS idx_orders_quiz_request
    ON t_p72635010_quantum_fusion_resea.orders(quiz_request_id);
