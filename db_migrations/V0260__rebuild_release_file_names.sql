-- Имя, под которым установщик сохраняется у клиента, теперь строится по
-- правилу StressTester_Setup_<версия>[_Lite].<расширение>.
-- Раньше полная и Lite-сборка одной версии получали ОДИНАКОВОЕ имя
-- (StressTester_Setup_1.3.2.0.exe) — клиент не мог их различить.
UPDATE t_p72635010_quantum_fusion_resea.stress_app_releases
SET file_name = 'StressTester_Setup_'
  || regexp_replace(
       regexp_replace(COALESCE(version, ''), '(?i)(lite|light|full)', '', 'g'),
       '^[vV][[:space:]._-]*', '')
  || CASE WHEN edition = 'lite' THEN '_Lite' ELSE '' END
  || CASE
       WHEN COALESCE(file_name, '') ~* '\.msi$' THEN '.msi'
       WHEN COALESCE(file_name, '') ~* '\.zip$' THEN '.zip'
       ELSE '.exe'
     END
WHERE COALESCE(version, '') <> '';
