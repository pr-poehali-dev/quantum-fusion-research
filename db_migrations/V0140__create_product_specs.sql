-- Таблица характеристик совместимости товаров для конфигуратора.
-- 1 строка на товар (product_id уникален). Создаётся автоматически
-- при создании складской группы (warehouse group_create).
CREATE TABLE IF NOT EXISTS product_specs (
    id              SERIAL PRIMARY KEY,
    product_id      INTEGER NOT NULL UNIQUE REFERENCES products(id),
    component_type  VARCHAR(30),

    socket              VARCHAR(30),
    mem_type            VARCHAR(10),
    tdp_watt            INTEGER,
    has_igpu            BOOLEAN,

    chipset             VARCHAR(30),
    form_factor         VARCHAR(20),
    mem_slots           INTEGER,
    m2_slots            INTEGER,

    ram_form            VARCHAR(20),
    ram_modules         INTEGER,
    ram_capacity_gb     INTEGER,
    ram_freq            INTEGER,

    gpu_length_mm           INTEGER,
    gpu_power_connector     VARCHAR(30),

    psu_watt            INTEGER,
    psu_form_factor     VARCHAR(20),
    psu_connectors      JSONB DEFAULT '[]'::jsonb,

    case_form_factors   JSONB DEFAULT '[]'::jsonb,
    max_gpu_length_mm   INTEGER,
    max_cooler_height_mm INTEGER,
    radiator_support    JSONB DEFAULT '[]'::jsonb,

    cooler_sockets      JSONB DEFAULT '[]'::jsonb,
    cooler_type         VARCHAR(10),
    cooler_height_mm    INTEGER,
    radiator_size       INTEGER,
    cooler_tdp_rating   INTEGER,

    storage_interface   VARCHAR(30),

    extra               JSONB DEFAULT '{}'::jsonb,

    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_specs_product_id ON product_specs(product_id);
CREATE INDEX IF NOT EXISTS idx_product_specs_type ON product_specs(component_type);
CREATE INDEX IF NOT EXISTS idx_product_specs_socket ON product_specs(socket);
CREATE INDEX IF NOT EXISTS idx_product_specs_mem_type ON product_specs(mem_type);
