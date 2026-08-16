-- Версии внешнего стресс-тестера (EXE), которые клиенты качают с сайта.
-- Сам файл лежит в S3/CDN (до 5 ГБ), в БД — только карточка версии.
CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_app_releases (
    id            SERIAL PRIMARY KEY,
    version       TEXT NOT NULL,
    changelog     TEXT DEFAULT '',
    file_url      TEXT NOT NULL,
    file_name     TEXT DEFAULT '',
    file_size     BIGINT DEFAULT 0,
    -- Ключ объекта в бакете — нужен, чтобы физически удалить файл вместе с версией.
    s3_key        TEXT DEFAULT '',
    -- Черновик не виден на сайте: можно загрузить заранее и опубликовать позже.
    is_published  BOOLEAN DEFAULT TRUE,
    download_count INTEGER DEFAULT 0,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stress_releases_pub
    ON t_p72635010_quantum_fusion_resea.stress_app_releases (is_published, id DESC);