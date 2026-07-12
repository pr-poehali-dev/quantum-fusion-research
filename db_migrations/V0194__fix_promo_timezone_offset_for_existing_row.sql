-- Фикс таймзоны у ранее созданного промокода: даты вводились в МСК (UTC+3),
-- но сохранились как UTC → акция «не началась». Сдвигаем на -3 часа к UTC.
UPDATE promos
SET starts_at = starts_at - INTERVAL '3 hours',
    expires_at = expires_at - INTERVAL '3 hours'
WHERE id = 1;
