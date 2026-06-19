UPDATE quiz_questions
SET field_type = 'tasks',
    options = '[
      {"label": "Шутеры / соревновательные", "group": "games"},
      {"label": "ААА-игры на максималках", "group": "games"},
      {"label": "Киберспорт (CS, Dota, Valorant)", "group": "games"},
      {"label": "Стриминг игр", "group": "games"},
      {"label": "VR-игры", "group": "games"},
      {"label": "Монтаж видео", "group": "work"},
      {"label": "3D / рендеринг", "group": "work"},
      {"label": "Программирование", "group": "work"},
      {"label": "Работа с графикой (Photoshop и т.п.)", "group": "work"},
      {"label": "Офис / учёба", "group": "work"}
    ]'::jsonb
WHERE id = 1;
