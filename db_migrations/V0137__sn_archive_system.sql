-- Система SnArhive: реестр серийных номеров с привязкой к магазину (откуда купили).
-- Цель: для процессоров (и др. категорий) хранить связь серийник -> магазин,
-- чтобы при гарантийке подставлять место покупки по серийнику.

-- Категории, для которых включён обязательный учёт серийников при приёмке.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.sn_categories (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) NOT NULL UNIQUE,  -- совпадает с warehouse_groups.category
    require_serial BOOLEAN NOT NULL DEFAULT TRUE,  -- обязателен ли серийник при приёмке
    created_at TIMESTAMP DEFAULT NOW()
);

-- Реестр серийников. Один серийник = одна единица товара из конкретной поставки.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.sn_archive (
    id SERIAL PRIMARY KEY,
    serial VARCHAR(255) NOT NULL,
    group_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.warehouse_groups(id),
    supply_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.warehouse_supplies(id),
    product_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.products(id),
    store_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.warehouse_stores(id),
    category VARCHAR(100),
    product_name VARCHAR(255),
    purchase_date DATE,
    warranty_until DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'in_stock',  -- in_stock | sold | rma
    order_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.orders(id),
    note TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Поиск по серийнику и фильтрам.
CREATE INDEX IF NOT EXISTS idx_sn_archive_serial
    ON t_p72635010_quantum_fusion_resea.sn_archive (serial);
CREATE INDEX IF NOT EXISTS idx_sn_archive_group
    ON t_p72635010_quantum_fusion_resea.sn_archive (group_id);
CREATE INDEX IF NOT EXISTS idx_sn_archive_store
    ON t_p72635010_quantum_fusion_resea.sn_archive (store_id);
CREATE INDEX IF NOT EXISTS idx_sn_archive_category
    ON t_p72635010_quantum_fusion_resea.sn_archive (category);

-- Стартовая категория — процессоры (с обязательным серийником).
INSERT INTO t_p72635010_quantum_fusion_resea.sn_categories (category, require_serial)
VALUES ('Процессоры', TRUE)
ON CONFLICT (category) DO NOTHING;