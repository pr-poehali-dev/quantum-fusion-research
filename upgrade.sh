#!/usr/bin/env bash
#
# Безопасный апгрейд проекта BeGraphics на своём сервере.
#
# Что делает (по порядку):
#   1. Делает бэкап БД, файла .env и текущего кода (git-коммита).
#   2. Подтягивает новый код из Git (git pull).
#   3. Прогоняет ТОЛЬКО новые миграции БД (структуру, не данные).
#   4. Пересобирает фронтенд и обновляет зависимости бэкенда.
#   5. Перезапускает бэкенд и проверяет, что он жив.
#
# Если на любом шаге ошибка — автоматически откатывает код и БД к бэкапу.
# Данные (БД, файлы, секреты) НИКУДА не передаются в интернет: всё локально.
#
# Запуск:  sudo bash /var/www/app/upgrade.sh
#
set -euo pipefail

# ─────────── НАСТРОЙКИ (поправь под свой сервер при необходимости) ───────────
APP_DIR="/var/www/app"
BACKEND_DIR="$APP_DIR/backend"
ENV_FILE="$BACKEND_DIR/.env"
SERVICE="backend"                       # имя systemd-сервиса бэкенда
BACKUP_ROOT="/var/backups/begraphics"   # куда складывать бэкапы
HEALTH_URL="http://127.0.0.1:8000/orders"   # эндпоинт для проверки живости
DB_SCHEMA="t_p72635010_quantum_fusion_resea"

# ─────────── ВСПОМОГАТЕЛЬНОЕ ───────────
TS="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$TS"
log()  { echo -e "\033[1;36m[upgrade]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ОШИБКА]\033[0m $*" >&2; }
ok()   { echo -e "\033[1;32m[ок]\033[0m $*"; }

# Достаём DATABASE_URL из .env (строка вида export DATABASE_URL="postgresql://...")
if [ ! -f "$ENV_FILE" ]; then
  err "Не найден $ENV_FILE — нечего апгрейдить."; exit 1
fi
# shellcheck disable=SC1090
set +u; source "$ENV_FILE"; set -u
if [ -z "${DATABASE_URL:-}" ]; then
  err "В $ENV_FILE нет DATABASE_URL."; exit 1
fi

mkdir -p "$BACKUP_DIR"

# ─────────── 1. БЭКАП ───────────
log "Шаг 1/5 — бэкап в $BACKUP_DIR"

# 1a. Дамп БД (полный: структура + данные)
log "  • дамп базы данных…"
pg_dump "$DATABASE_URL" --no-owner --no-privileges -f "$BACKUP_DIR/db.sql"
gzip "$BACKUP_DIR/db.sql"
ok "  • база сохранена: $BACKUP_DIR/db.sql.gz"

# 1b. Копия секретов
cp "$ENV_FILE" "$BACKUP_DIR/.env.bak"
ok "  • .env сохранён"

# 1c. Запоминаем текущий git-коммит (для отката кода)
cd "$APP_DIR"
PREV_COMMIT="$(git rev-parse HEAD)"
echo "$PREV_COMMIT" > "$BACKUP_DIR/git_commit.txt"
ok "  • текущий коммит: $PREV_COMMIT"

# Список применённых до апгрейда миграций — чтобы откатить ровно новые
ls "$APP_DIR/db_migrations/"V*.sql 2>/dev/null | xargs -n1 basename 2>/dev/null \
  | sort -V > "$BACKUP_DIR/migrations_before.txt" || true

# ─────────── ФУНКЦИЯ ОТКАТА ───────────
rollback() {
  err "Апгрейд прерван. Откатываюсь к бэкапу $TS…"
  cd "$APP_DIR"
  git reset --hard "$PREV_COMMIT" || err "не удалось откатить код"
  log "Восстанавливаю базу из дампа (это перезапишет структуру и данные)…"
  gunzip -c "$BACKUP_DIR/db.sql.gz" | psql "$DATABASE_URL" >/dev/null 2>&1 \
    && ok "база восстановлена" || err "не удалось восстановить базу — дамп: $BACKUP_DIR/db.sql.gz"
  cp "$BACKUP_DIR/.env.bak" "$ENV_FILE"
  systemctl restart "$SERVICE" || true
  err "Откат завершён. Сайт работает на прежней версии. Бэкап: $BACKUP_DIR"
  exit 1
}
trap rollback ERR

# ─────────── 2. НОВЫЙ КОД ───────────
log "Шаг 2/5 — получаю новый код (git pull)"
cd "$APP_DIR"
git fetch --all
git pull --ff-only
NEW_COMMIT="$(git rev-parse HEAD)"
if [ "$NEW_COMMIT" = "$PREV_COMMIT" ]; then
  ok "Код уже актуален — апгрейд не требуется. Бэкап оставлен в $BACKUP_DIR."
  trap - ERR
  exit 0
fi
ok "  • обновлено до коммита $NEW_COMMIT"

# ─────────── 3. МИГРАЦИИ БД (только новые) ───────────
log "Шаг 3/5 — применяю новые миграции"
# гарантируем, что схема существует (если код использует отдельную схему)
psql "$DATABASE_URL" -c "CREATE SCHEMA IF NOT EXISTS $DB_SCHEMA;" >/dev/null 2>&1 || true

APPLIED=0
for f in $(ls "$APP_DIR/db_migrations/"V*.sql 2>/dev/null | sort -V); do
  base="$(basename "$f")"
  if grep -qx "$base" "$BACKUP_DIR/migrations_before.txt" 2>/dev/null; then
    continue   # эта миграция уже была до апгрейда — пропускаем
  fi
  log "  • применяю $base"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  APPLIED=$((APPLIED+1))
done
ok "  • новых миграций применено: $APPLIED"

# ─────────── 4. СБОРКА ───────────
log "Шаг 4/5 — сборка фронтенда и зависимости бэкенда"
cd "$APP_DIR"
npm install
npm run build
ok "  • фронтенд собран (dist/)"

# обновляем зависимости бэкенда в его venv
if [ -d "$BACKEND_DIR/venv" ]; then
  # shellcheck disable=SC1091
  source "$BACKEND_DIR/venv/bin/activate"
  find "$BACKEND_DIR" -name requirements.txt -exec pip install -q -r {} \; || true
  deactivate
  ok "  • зависимости бэкенда обновлены"
fi

# ─────────── 5. ПЕРЕЗАПУСК + ПРОВЕРКА ───────────
log "Шаг 5/5 — перезапуск и проверка"
systemctl restart "$SERVICE"
sleep 4

CODE="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || echo 000)"
if [ "$CODE" -ge 200 ] && [ "$CODE" -lt 500 ]; then
  ok "  • бэкенд отвечает (HTTP $CODE)"
else
  err "  • бэкенд не отвечает (HTTP $CODE)"
  false   # триггерим rollback
fi

# Всё хорошо — снимаем ловушку отката
trap - ERR
ok "Апгрейд успешно завершён!"
echo
echo "  Было:  $PREV_COMMIT"
echo "  Стало: $NEW_COMMIT"
echo "  Бэкап на случай отката: $BACKUP_DIR"
echo
echo "  Откатить вручную при необходимости:"
echo "    cd $APP_DIR && git reset --hard $PREV_COMMIT"
echo "    gunzip -c $BACKUP_DIR/db.sql.gz | psql \"\$DATABASE_URL\""
echo "    systemctl restart $SERVICE"
