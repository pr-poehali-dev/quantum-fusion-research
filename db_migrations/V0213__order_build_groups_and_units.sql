-- Массовая сборка ПК (партия): один заказ = набор групп-вариантов,
-- каждая группа = своя конфигурация + количество ПК. Отдельные ПК в группе
-- нужны для серийников и поэтапной выдачи.
-- Одиночные заказы (order_type='pc_build') НЕ затрагиваются.

-- Строка-вариант партии: конфигурация + кол-во ПК + свой статус сборки (wip)
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.order_build_groups (
    id           SERIAL PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.orders(id),
    label        VARCHAR(128) NOT NULL DEFAULT 'Вариант',
    qty          INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
    components   JSONB NOT NULL DEFAULT '[]'::jsonb,
    parts_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
    wip_id       INTEGER NULL REFERENCES t_p72635010_quantum_fusion_resea.wip_builds(id),
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_obg_order ON t_p72635010_quantum_fusion_resea.order_build_groups(order_id);

-- Отдельный ПК внутри группы: серийник, статус, поэтапная выдача.
-- Очистку units при удалении группы делаем явно из бэкенда (без CASCADE).
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.order_build_units (
    id             SERIAL PRIMARY KEY,
    group_id       INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.order_build_groups(id),
    order_id       INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.orders(id),
    unit_no        INTEGER NOT NULL DEFAULT 1,
    serial_number  VARCHAR(128) NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending',
    warranty_until DATE NULL,
    issued_at      DATE NULL,
    comment        TEXT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_obu_group ON t_p72635010_quantum_fusion_resea.order_build_units(group_id);
CREATE INDEX IF NOT EXISTS idx_obu_order ON t_p72635010_quantum_fusion_resea.order_build_units(order_id);
