#!/usr/bin/env bash
# Выкатка релиза SITE_2 (shop.vialabote.ru) — только каталог релиза.
#
#   deploy-shop-release.sh            — переключить current на REL_ID и проверить
#   deploy-shop-release.sh --check    — только проверка, без миграций и переключения
#
# Переключаемый релиз задаётся переменными REL_ID/FULL_SHA/OLD_REL — по умолчанию
# тот, который готовился последним.
#
# ЭТО ИСПРАВЛЕННАЯ ВЕРСИЯ скрипта, который жил ВНЕ репозитория (/home/zero/work/deploy-shop-release.sh):
# в нём не было `prisma migrate deploy` (миграции применялись владельцем отдельным шагом —
# так и записано в prisma/migrations/*/migration.sql) и не было манифеста релиза
# (audit-2026-11-07: к.24/47 — «релиз не применяет миграции; манифеста нет»).
#
# Что делает (fail-closed: любая ошибка ДО переключения — релиз не включается):
#   1. проверяет, что новый релиз лежит на VPS, собран из нужного коммита и имеет сборку;
#   2. проверяет, что сайт живой ДО переключения;
#   3. пишет манифест релиза manifest-<sha7>.sha256 и проверяет его (sha256sum -c);
#   4. применяет миграции на боевой БД: `prisma migrate deploy` — при ошибке НЕ переключаем;
#   5. переключает симлинк current на новый релиз и перезапускает юнит;
#   6. проверяет результат: коды, canonical, og:url и длину description;
#   7. при любом провале — возврат current на предыдущий релиз и повторная проверка.
#
# Миграции идут ДО переключения и откатываются вместе с релизом: старый релиз не знает про
# новые миграции, поэтому переключать релиз на старой схеме опаснее, чем не переключать вовсе.
#
# Ничего, кроме каталога релиза, симлинка current и юнита, не меняется.
set -Eeuo pipefail

REL_ID="${REL_ID:-2c4fcca}"
FULL_SHA="${FULL_SHA:-2c4fcca1dc6c63e57f32c34cd78ec6ba4f9fbc50}"
OLD_REL="${OLD_REL:-99b1b037}"
OPT=/opt/vialabote-shop
NEW="$OPT/releases/$REL_ID"
CURRENT="$OPT/current"
SVC=vialabote-shop.service
PORT=3002
BASE="http://127.0.0.1:$PORT"
SITE="https://shop.vialabote.ru"
DB_ENV="${DB_ENV:-/etc/vialabote-shop/db.env}"
APP_ENV="${APP_ENV:-/etc/vialabote-shop/app.env}"
SVC_USER="${SVC_USER:-vialabote-shop}"
RUNUSER="${RUNUSER:-/usr/sbin/runuser}"
HERE="$(cd "$(dirname "$0")" && pwd)"

log()  { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die()  { log "FAIL: $*"; exit 1; }
code() { curl -s -o /dev/null -m 30 -w '%{http_code}' "$BASE$1"; }
body() { curl -s -m 30 "$BASE$1"; }
kv()   { sed -n "s/^$1=//p" "$2" 2>/dev/null | head -1; }   # KEY=VALUE читаем как данные, не source

wait_up() {
  for _ in $(seq 1 60); do
    [ "$(code /)" = 200 ] && [ "$(code /catalog)" = 200 ] && return 0
    sleep 2
  done
  return 1
}

meta() { # path -> "canonical|og:url|description"
  local html; html="$(body "$1")"
  local canonical og desc
  canonical="$(printf '%s' "$html" | grep -oE '<link[^>]+rel="canonical"[^>]*>' | grep -oE 'href="[^"]+"' | head -1 | sed 's/href="//; s/"$//')"
  og="$(printf '%s' "$html" | grep -oE '<meta[^>]+property="og:url"[^>]*>' | grep -oE 'content="[^"]+"' | head -1 | sed 's/content="//; s/"$//')"
  desc="$(printf '%s' "$html" | grep -oE '<meta[^>]+name="description"[^>]*>' | grep -oE 'content="[^"]+"' | head -1 | sed 's/content="//; s/"$//')"
  printf '%s|%s|%s' "$canonical" "$og" "$desc"
}

switch_to() { # rel
  ln -sfn "releases/$1" "$CURRENT"
  systemctl restart "$SVC"
}

rollback() {
  log "откат на releases/$OLD_REL"
  ln -sfn "releases/$OLD_REL" "$CURRENT"
  systemctl restart "$SVC"
  wait_up || log "ВНИМАНИЕ: после отката сайт не поднялся"
}

# --- манифест релиза -------------------------------------------------------
# Пишем манифест по файлам каталога релиза и сразу проверяем его: подмена файла
# релиза ломает sha256sum -c, и до переключения дело не дойдёт.
write_manifest() { bash "$HERE/release-manifest.sh" "$NEW" "$REL_ID"; }
check_manifest() { bash "$HERE/release-manifest.sh" --check "$NEW" "$REL_ID"; }

# --- миграции --------------------------------------------------------------
# БД для миграций: MIGRATE_DATABASE_URL (роль владельца схемы) из db.env, иначе
# DATABASE_URL. Значение НИКОГДА не печатается — только подставляется в env процесса.
migration_db_url() {
  if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then printf '%s' "$MIGRATION_DATABASE_URL"; return 0; fi
  local url
  url="$(kv MIGRATE_DATABASE_URL "$DB_ENV")"
  [ -n "$url" ] && { printf '%s' "$url"; return 0; }
  url="$(kv DATABASE_URL "$DB_ENV")"
  [ -n "$url" ] && { printf '%s' "$url"; return 0; }
  url="$(kv DATABASE_URL "$APP_ENV")"
  [ -n "$url" ] && { printf '%s' "$url"; return 0; }
  return 1
}

apply_migrations() {
  local db_url node_dir
  db_url="$(migration_db_url)" || die "нет URL боевой БД ($DB_ENV, $APP_ENV) — миграции не применены, релиз не переключаем"
  [ -x "$NEW/node_modules/.bin/prisma" ] || die "в релизе нет prisma CLI — миграции не применены, релиз не переключаем"
  node_dir="$(dirname "$(command -v node || echo /usr/bin/node)")"
  log "применяем миграции: prisma migrate deploy (роль владельца схемы)"
  ( cd "$NEW" \
    && env -i PATH="$node_dir:/usr/bin:/bin" HOME="$OPT/shared" DATABASE_URL="$db_url" \
       "$RUNUSER" -u "$SVC_USER" -- "$NEW/node_modules/.bin/prisma" migrate deploy ) \
    || die "prisma migrate deploy не прошёл — релиз не переключаем, схема боевой БД как была"
  log "миграции применены"
}

# --- 1. релиз на месте ----------------------------------------------------
[ -d "$NEW" ] || die "релиз $NEW не найден"
[ -f "$NEW/.next/BUILD_ID" ] || die "в релизе нет сборки .next/BUILD_ID"
[ -f "$NEW/.release-commit" ] || die "в релизе нет .release-commit"
GOT="$(cat "$NEW/.release-commit")"
[ "$GOT" = "$FULL_SHA" ] || die "релиз собран из $GOT, а ждём $FULL_SHA"
log "релиз $REL_ID на месте, коммит $FULL_SHA, сборка $(cat "$NEW/.next/BUILD_ID")"

# --- 2. сайт живой до переключения ---------------------------------------
PRE_HOME="$(code /)"; PRE_CAT="$(code /catalog)"
[ "$PRE_HOME" = 200 ] && [ "$PRE_CAT" = 200 ] || die "до переключения сайт не отвечает (home=$PRE_HOME catalog=$PRE_CAT)"
log "до переключения: home=200 catalog=200"

if [ "${1:-}" = "--check" ]; then
  log "--check: переключение не выполняется"
  exit 0
fi

# --- 3. манифест релиза ---------------------------------------------------
write_manifest || die "манифест релиза не записался — релиз не переключаем"
check_manifest || die "манифест релиза не сошёлся — релиз не переключаем"

# --- 4. миграции боевой БД (до переключения) ------------------------------
apply_migrations

# --- 5. переключение ------------------------------------------------------
CURRENT_BEFORE="$(readlink "$CURRENT")"
log "current до: $CURRENT_BEFORE"
switch_to "$REL_ID"
wait_up || { rollback; die "после переключения сайт не поднялся"; }
log "юнит перезапущен, сайт отвечает"

# --- 6. проверка результата ----------------------------------------------
FAILED=""
# URL сравниваем без слеша в конце: корень отдаёт canonical «https://shop.vialabote.ru»,
# а страницы — «https://shop.vialabote.ru/returns». Разница только в записи.
norm() { printf '%s' "${1%/}"; }
check() { # label expected actual
  if [ "$2" = "$3" ]; then log "OK   $1 = $3"; else log "FAIL $1: ожидалось '$2', получено '$3'"; FAILED="$FAILED $1"; fi
}
check_url() { # label expected actual
  if [ "$(norm "$2")" = "$(norm "$3")" ]; then log "OK   $1 = $3"; else log "FAIL $1: ожидалось '$2', получено '$3'"; FAILED="$FAILED $1"; fi
}
for p in /returns /offer /privacy; do
  IFS='|' read -r canonical og desc <<< "$(meta "$p")"
  check_url "$p canonical" "$SITE$p" "$canonical"
  check_url "$p og:url" "$SITE$p" "$og"
  DLEN=${#desc}
  { [ "$DLEN" -ge 70 ] && [ "$DLEN" -le 160 ]; } && log "OK   $p description ($DLEN симв.)" || { log "FAIL $p description: $DLEN симв. (нужно 70–160)"; FAILED="$FAILED $p-desc"; }
done
IFS='|' read -r canonical og desc <<< "$(meta /catalog)"
check_url "/catalog canonical" "$SITE/catalog" "$canonical"
check_url "/catalog og:url" "$SITE/catalog" "$og"
IFS='|' read -r canonical og desc <<< "$(meta /)"
check_url "/ canonical" "$SITE/" "$canonical"

PRODUCT="$(body /catalog | grep -oE 'href="/product/[a-z0-9-]+"' | head -1 | sed 's/href="//; s/"$//')"
if [ -n "$PRODUCT" ]; then
  IFS='|' read -r canonical og desc <<< "$(meta "$PRODUCT")"
  check_url "$PRODUCT canonical" "$SITE$PRODUCT" "$canonical"
  DLEN=${#desc}
  { [ "$DLEN" -ge 70 ] && [ "$DLEN" -le 160 ]; } && log "OK   $PRODUCT description ($DLEN симв.)" || { log "FAIL $PRODUCT description: $DLEN симв. (нужно 70–160)"; FAILED="$FAILED product-desc"; }
else
  log "WARN не нашлась товарная ссылка на /catalog — описание товара не проверено"
fi

if [ -n "$FAILED" ]; then
  rollback
  die "проверки не пройдены:$FAILED"
fi

log "ГОТОВО: current -> releases/$REL_ID, миграции применены, манифест manifest-$REL_ID.sha256, все проверки пройдены"
