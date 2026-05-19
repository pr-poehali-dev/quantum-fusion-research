CREATE TABLE t_p72635010_quantum_fusion_resea.warehouse_stores (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code CHAR(3) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE t_p72635010_quantum_fusion_resea.warehouse_groups (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.products(id),
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(8) NOT NULL UNIQUE,
    category VARCHAR(100),
    part_number VARCHAR(255),
    warranty_months INTEGER DEFAULT 12,
    price_retail NUMERIC(12,2) DEFAULT 0,
    price_opt1 NUMERIC(12,2) DEFAULT 0,
    price_opt2 NUMERIC(12,2) DEFAULT 0,
    url_site TEXT,
    url_supplier TEXT,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE t_p72635010_quantum_fusion_resea.warehouse_supplies (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.warehouse_groups(id),
    store_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.warehouse_stores(id),
    qty INTEGER NOT NULL DEFAULT 0,
    qty_reserved INTEGER NOT NULL DEFAULT 0,
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    cell VARCHAR(100),
    purchase_date DATE,
    warranty_until DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE t_p72635010_quantum_fusion_resea.warehouse_movements (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.warehouse_groups(id),
    supply_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.warehouse_supplies(id),
    order_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.orders(id),
    user_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.users(id),
    type VARCHAR(50) NOT NULL,
    qty_delta INTEGER NOT NULL,
    cost_price NUMERIC(12,2),
    sale_price NUMERIC(12,2),
    margin NUMERIC(12,2),
    note TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE t_p72635010_quantum_fusion_resea.warehouse_price_history (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.warehouse_groups(id),
    price_retail NUMERIC(12,2),
    avg_cost NUMERIC(12,2),
    recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE t_p72635010_quantum_fusion_resea.warehouse_inventories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES t_p72635010_quantum_fusion_resea.users(id),
    filter_type VARCHAR(50),
    filter_value VARCHAR(255),
    status VARCHAR(30) DEFAULT 'draft',
    result_json JSONB,
    applied_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON t_p72635010_quantum_fusion_resea.warehouse_groups(product_id);
CREATE INDEX ON t_p72635010_quantum_fusion_resea.warehouse_groups(sku);
CREATE INDEX ON t_p72635010_quantum_fusion_resea.warehouse_supplies(group_id);
CREATE INDEX ON t_p72635010_quantum_fusion_resea.warehouse_movements(group_id);
CREATE INDEX ON t_p72635010_quantum_fusion_resea.warehouse_movements(order_id);
CREATE INDEX ON t_p72635010_quantum_fusion_resea.warehouse_price_history(group_id);
