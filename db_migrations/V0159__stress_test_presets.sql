CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.stress_test_presets (
    id              SERIAL PRIMARY KEY,
    label           TEXT NOT NULL DEFAULT '',
    hint            TEXT NOT NULL DEFAULT '',
    test_name       TEXT NOT NULL DEFAULT '',
    program         TEXT NOT NULL DEFAULT '',
    args            TEXT NOT NULL DEFAULT '',
    duration_sec    INTEGER NOT NULL DEFAULT 600,
    timeout_is_success BOOLEAN NOT NULL DEFAULT TRUE,
    success_exit_code  INTEGER NOT NULL DEFAULT -1,
    min_run_sec     INTEGER NOT NULL DEFAULT 0,
    send_keys       TEXT NOT NULL DEFAULT '',
    send_keys_delay_sec INTEGER NOT NULL DEFAULT 5,
    report_files    JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO t_p72635010_quantum_fusion_resea.stress_test_presets
(label, hint, test_name, program, args, duration_sec, timeout_is_success, success_exit_code, min_run_sec, send_keys, send_keys_delay_sec, report_files, sort_order) VALUES
('Prime95 (авто)', 'CLI-утилита: запускается и сразу гонит Torture Test. Положи в StressTests\prime95\.', 'Prime95 — Torture Test', 'StressTests\prime95\prime95.exe', '-t', 900, TRUE, 0, 30, '', 5, '["StressTests\\prime95\\results.txt"]'::jsonb, 1),
('Cinebench R23 (авто)', 'CLI-автозапуск мультиядра ~10 мин. Путь: StressTests\CINEBENCH R23\23.2.0.0\Cinebench.exe.', 'Cinebench R23 — Multi Core', 'StressTests\CINEBENCH R23\23.2.0.0\Cinebench.exe', 'g_CinebenchCpuXTest=true g_CinebenchMinimumTestDuration=600', 660, TRUE, 0, 20, '', 5, '[]'::jsonb, 2),
('OCCT (открыть)', 'Бесплатный OCCT без CLI. Откроет окно — выбери тест и нажми Старт.', 'OCCT — ручной старт', 'StressTests\OCCT\OCCT.exe', '', 660, TRUE, -1, 0, '', 5, '[]'::jsonb, 3),
('FurMark (авто)', 'Сам стартует burn-in (/nogui) и через 6 сек жмёт P (post-FX). Лучший прогрев GPU.', 'FurMark — GPU стресс', 'StressTests\FurMark\furmark.exe', '/nogui /width=1920 /height=1080 /msaa=4 /max_time=600000', 660, TRUE, -1, 20, 'P', 6, '[]'::jsonb, 4),
('Superposition (открыть)', 'Открывает окно — выбери пресет (8K) и нажми RUN.', 'Superposition — ручной старт', 'StressTests\Superposition Benchmark\Superposition.exe', '', 600, TRUE, -1, 0, '', 5, '[]'::jsonb, 5);