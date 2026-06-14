-- Этап 3: RMA (гарантийные случаи)
-- Вариант B: журнал + карантин + возврат замены на склад
-- Источник брака: из проданного (товар уже ушёл клиенту, возврат → карантин)

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.warehouse_rma (
    id              SERIAL PRIMARY KEY,
    -- Привязка к заказу
    order_id        INTEGER REFERENCES t_p72635010_quantum_fusion_resea.orders(id),
    -- Товар (группа SKU + конкретный продукт)
    group_id        INTEGER REFERENCES t_p72635010_quantum_fusion_resea.warehouse_groups(id),
    product_id      INTEGER REFERENCES t_p72635010_quantum_fusion_resea.products(id),
    slot            VARCHAR(50),           -- cpu / gpu / ram / etc — слот в сборке
    item_name       VARCHAR(255) NOT NULL, -- имя железки (для отображения)
    qty             INTEGER NOT NULL DEFAULT 1,
    -- Причина и описание
    reason          TEXT NOT NULL,         -- описание поломки от менеджера
    -- Источник: "order" — от клиента, "stock" — брак выявлен на складе
    source_type     VARCHAR(20) NOT NULL DEFAULT 'order' CHECK (source_type IN ('order','stock')),
    -- Статус
    status          VARCHAR(20) NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','to_supplier','in_progress','resolved','closed')),
    -- Снабжение: поставщик получил товар? Ждём замену?
    supplier_note   TEXT,                  -- комментарий по работе с поставщиком
    -- Результат: замена или деньги
    resolution      VARCHAR(20) CHECK (resolution IN ('replacement','refund','repair',NULL)),
    -- Дата выявления и закрытия
    detected_at     DATE NOT NULL DEFAULT CURRENT_DATE,
    resolved_at     DATE,
    -- Карантин: qty этого товара заблокировано в карантинном буфере
    quarantine_qty  INTEGER NOT NULL DEFAULT 0,
    -- Замена: когда пришла замена и ушла на склад
    replacement_supply_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.warehouse_supplies(id),
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rma_order ON t_p72635010_quantum_fusion_resea.warehouse_rma(order_id);
CREATE INDEX IF NOT EXISTS idx_rma_group ON t_p72635010_quantum_fusion_resea.warehouse_rma(group_id);
CREATE INDEX IF NOT EXISTS idx_rma_status ON t_p72635010_quantum_fusion_resea.warehouse_rma(status);

-- Карантинный буфер: отдельная «партия» для бракованных единиц
-- (физически хранится в warehouse_supplies с отрицательным cost_price или с признаком карантина)
-- Добавляем поле quarantine в supplies для маркировки карантинных партий
ALTER TABLE t_p72635010_quantum_fusion_resea.warehouse_supplies
    ADD COLUMN IF NOT EXISTS is_quarantine BOOLEAN NOT NULL DEFAULT FALSE;
