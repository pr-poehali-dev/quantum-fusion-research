CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p72635010_quantum_fusion_resea.schedules (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES t_p72635010_quantum_fusion_resea.employees(id),
  work_date DATE NOT NULL,
  time_start VARCHAR(5),
  time_end VARCHAR(5),
  is_day_off BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_employee ON t_p72635010_quantum_fusion_resea.schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON t_p72635010_quantum_fusion_resea.schedules(work_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_unique ON t_p72635010_quantum_fusion_resea.schedules(employee_id, work_date);
