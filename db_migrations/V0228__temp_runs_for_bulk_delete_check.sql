-- Временные прогоны для проверки массового удаления (будут удалены тестом)
INSERT INTO t_p72635010_quantum_fusion_resea.stress_runs
  (run_uid, profile_name, machine_name, os_info, note, total_tests, passed_tests, failed_tests, status)
VALUES
  ('__bulkdel_test_1', 'p', '__bulkdel_1', '', '', 1, 1, 0, 'done'),
  ('__bulkdel_test_2', 'p', '__bulkdel_2', '', '', 1, 1, 0, 'done'),
  ('__bulkdel_test_3', 'p', '__bulkdel_3', '', '', 1, 1, 0, 'done');
