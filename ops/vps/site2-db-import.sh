#!/usr/bin/env bash
# SITE_2 (vialabote-shop): connect the CI-tested release to the SITE_2
# database (cluster 16/shop, 127.0.0.1:5433) and import the master catalog.
#
#   pre-check SITE_1 -> verify bundle -> install release + own Node
#   -> empty-DB baseline -> prisma migrate deploy (owner role)
#   -> seed (app role, DML only; no admin user) -> catalog parity
#   -> isolation proof (only our DBs/tables; no users/orders)
#   -> app smoke test on 127.0.0.1:3002 (temporary, stopped after)
#   -> backup + restore test -> post-check SITE_1 + diff.
#
# Credentials are read only from /etc/vialabote-shop/db.env, kept in the
# environment (never argv), never printed. SITE_1 is only READ.
#
# usage (as root):  bash site2-db-import.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SHA=4d57026ce5a9428be28a85b57c794ec84734631a
SHORT=${SHA:0:7}
NODE_V=v24.21.0
OPT=/opt/vialabote-shop
REL=$OPT/releases/$SHORT
NODE_DIR=$OPT/node-$NODE_V
SVC_USER=vialabote-shop
PORT=5433
DB=vialabote_shop
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-import-$STAMP

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
# runuser (util-linux) lives in /usr/sbin, which is not on every PATH; it is
# always called by absolute path so a PATH change can never hide it again.
# RUNUSER_BIN only exists so the test harness can inject a stub.
RUNUSER=${RUNUSER_BIN:-/usr/sbin/runuser}
pg() { "$RUNUSER" -u postgres -- psql -X -q -At -v ON_ERROR_STOP=1 -p "$PORT" "$@"; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash $0)"
[ -x "$RUNUSER" ] || die "runuser not found at $RUNUSER"
[ -r /etc/vialabote-shop/db.env ] || die "/etc/vialabote-shop/db.env missing (run site2-db-setup.sh first)"
pg_isready -q -h 127.0.0.1 -p "$PORT" || die "cluster 16/shop not running"
mkdir -p "$WORK"; chmod 700 "$WORK"

step "1/9 SITE_1 pre-check"
bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-pre.txt"
grep -q "^http https://vialabote.ru/ 200$" "$WORK/site1-pre.txt" || die "SITE_1 not healthy before start — nothing changed"
echo "ok"

step "2/9 verify bundle checksums (CI-tested $SHORT)"
(cd "$HERE" && sha256sum -c "bundle-$SHORT.sha256")

step "3/9 install release + Node $NODE_V (own copy, SITE_1's /opt/node22 untouched)"
# Idempotent: a re-run after a partial run reuses a complete Node copy and
# re-extracts the release from the verified bundle into a fresh directory.
# Both paths belong to SITE_2 only; no service runs from them yet.
if [ "$("$NODE_DIR/bin/node" -v 2>/dev/null)" != "$NODE_V" ]; then
  [ -e "$NODE_DIR" ] && mv "$NODE_DIR" "$NODE_DIR.partial-$STAMP"
  install -d -m 0755 "$NODE_DIR"
  tar -C "$NODE_DIR" --strip-components=1 -xJf "$HERE/node-$NODE_V-linux-x64.tar.xz"
fi
case "$REL" in /opt/vialabote-shop/releases/?*) ;; *) die "refusing to touch unexpected path $REL" ;; esac
if [ -e "$REL" ]; then
  RUNNING_UNITS=$(systemctl list-units --plain --no-legend --state=running 'vialabote-shop*' || true)
  [ -z "$RUNNING_UNITS" ] || die "a vialabote-shop unit is running — not replacing $REL"
  echo "re-run: moving previous partial release aside to $REL.previous-$STAMP"
  mv "$REL" "$REL.previous-$STAMP"
fi
install -d -m 0755 "$REL"
tar -C "$REL" -xzf "$HERE/app-$SHORT.tar.gz"
chown -R root:"$SVC_USER" "$REL"
chmod -R go-w "$REL"   # release code is read-only for the service user
install -d -m 0750 "$REL/.next/cache"
chown -R "$SVC_USER":"$SVC_USER" "$REL/.next"   # next start writes cache/trace here
export PATH="$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" CHECKPOINT_DISABLE=1 NEXT_TELEMETRY_DISABLED=1 HOME="$OPT/shared"
echo "node $(node -v); release $REL"

# Load DB credentials into this shell only. db.env is DATA, not shell code:
# its URLs contain '&' (…?schema=public&connection_limit=10), which `source`
# would execute as a background operator and silently drop DATABASE_URL.
# So it is parsed as KEY=VALUE (split at the first '='), never executed.
load_db_env() {
  local line key val
  DATABASE_URL=""; MIGRATE_DATABASE_URL=""
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key=${line%%=*}; val=${line#*=}
    case "$key" in
      DATABASE_URL|MIGRATE_DATABASE_URL) printf -v "$key" '%s' "$val" ;;
    esac
  done < "$1"
  [ -n "$DATABASE_URL" ] || die "DATABASE_URL missing in $1"
  [ -n "$MIGRATE_DATABASE_URL" ] || die "MIGRATE_DATABASE_URL missing in $1"
  case "$DATABASE_URL" in *"@127.0.0.1:$PORT/$DB?"*) ;; *) die "DATABASE_URL does not point at 127.0.0.1:$PORT/$DB" ;; esac
  case "$MIGRATE_DATABASE_URL" in *"@127.0.0.1:$PORT/$DB?"*) ;; *) die "MIGRATE_DATABASE_URL does not point at 127.0.0.1:$PORT/$DB" ;; esac
}
load_db_env /etc/vialabote-shop/db.env
APP_URL="$DATABASE_URL"
echo "db.env loaded (2 URLs, values not printed)"
as_svc() { "$RUNUSER" -u "$SVC_USER" -- "$@"; }   # inherits env (not argv)

step "4/9 empty baseline"
TABLES_BEFORE=$(pg -d "$DB" -c "select count(*) from pg_tables where schemaname='public'")
echo "tables in $DB before migrate: $TABLES_BEFORE"
[ "$TABLES_BEFORE" = 0 ] || die "database is not empty — refusing to import over existing data"

step "5/9 prisma migrate deploy (owner role)"
(cd "$REL" && DATABASE_URL="$MIGRATE_DATABASE_URL" as_svc node_modules/.bin/prisma migrate deploy) | tail -4
MIGRATIONS=$(pg -d "$DB" -c "select string_agg(migration_name, ',' order by migration_name) from _prisma_migrations where finished_at is not null and rolled_back_at is null")
echo "applied: $MIGRATIONS"

step "6/9 seed master catalog (app role, DML only; no admin user created)"
(cd "$REL" && DATABASE_URL="$APP_URL" SEED_ADMIN_EMAIL= SEED_ADMIN_PASSWORD= as_svc node_modules/.bin/tsx prisma/seed.ts)

step "7/9 parity + isolation proof"
(cd "$REL" && DATABASE_URL="$APP_URL" as_svc node_modules/.bin/tsx scripts/db/verify-catalog.ts) | tee "$WORK/parity.txt"
grep -q "^CATALOG_PARITY=PASS" "$WORK/parity.txt" || die "catalog parity failed"
pg -d "$DB" -F ' | ' -c "select slug, price/100 as rub, status, stock, \"imageUrl\" from \"Product\" order by slug" | tee "$WORK/catalog.txt"
TOTAL_SKU=$(pg -d "$DB" -c 'select count(*) from "Product"')
PUBLISHED=$(pg -d "$DB" -c "select count(*) from \"Product\" where status='published' and \"isActive\"")
COUNTS=$(pg -d "$DB" -c "select format('%s users, %s orders, %s audit rows', (select count(*) from \"User\"), (select count(*) from \"Order\"), (select count(*) from \"AuditLog\"))")
DBS=$(pg -d postgres -c "select string_agg(datname, ',' order by datname) from pg_database")
EXPECTED_TABLES=$(grep -oE 'CREATE TABLE "[A-Za-z]+"' "$REL"/prisma/migrations/*/migration.sql | sed 's/.*"\(.*\)"/\1/' | sort | tr '\n' ',')
ACTUAL_TABLES=$(pg -d "$DB" -c "select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1" | sort | tr '\n' ',')
echo "TOTAL_SKU=$TOTAL_SKU published=$PUBLISHED; $COUNTS"
echo "databases in cluster 16/shop: $DBS"
[ "$TOTAL_SKU" = 13 ] || die "expected 13 SKU, got $TOTAL_SKU"
[ "$EXPECTED_TABLES" = "$ACTUAL_TABLES" ] && echo "tables = exactly the Prisma schema (no foreign/SITE_1 tables)" || die "unexpected table set: $ACTUAL_TABLES"
[ "$DBS" = "postgres,template0,template1,$DB" ] || die "unexpected databases in 16/shop: $DBS"

step "8/9 application smoke test against SITE_2 DB (127.0.0.1:3002, temporary)"
systemd-run --quiet --unit="vialabote-shop-smoke-$STAMP" --uid="$SVC_USER" --gid="$SVC_USER" \
  -p WorkingDirectory="$REL" -p MemoryMax=700M -p EnvironmentFile=/etc/vialabote-shop/db.env \
  -E PATH="$PATH" -E NODE_ENV=production -E HOME="$OPT/shared" -E NEXT_TELEMETRY_DISABLED=1 \
  -E NEXTAUTH_URL=http://127.0.0.1:3002 -E NEXTAUTH_SECRET="smoke-$(openssl rand -hex 16)" \
  node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3002
SMOKE=FAIL
for _ in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:3002/ && break; sleep 1; done
CAT=$(curl -s -m 30 http://127.0.0.1:3002/catalog || true)
CARDS=$(echo "$CAT" | grep -oE 'href="/product/[a-z0-9-]+"' | sort -u | wc -l)
HOME_CODE=$(curl -s -o /dev/null -m 30 -w '%{http_code}' http://127.0.0.1:3002/)
PDP_CODE=$(curl -s -o /dev/null -m 30 -w '%{http_code}' http://127.0.0.1:3002/product/toner-serum-ph55)
TONIKI=$(curl -s -m 30 'http://127.0.0.1:3002/catalog?category=toniki' | grep -oE 'href="/product/[a-z0-9-]+"' | sort -u | wc -l)
echo "home=$HOME_CODE catalog_cards=$CARDS toniki=$TONIKI pdp(toner-serum-ph55)=$PDP_CODE"
systemctl stop "vialabote-shop-smoke-$STAMP" || true
[ "$HOME_CODE" = 200 ] && [ "$CARDS" = 13 ] && [ "$TONIKI" = 2 ] && [ "$PDP_CODE" = 200 ] && SMOKE=PASS
ss -ltnH "sport = :3002" | grep -q . && echo "WARN: 3002 still listening" || echo "smoke app stopped (3002 free)"

step "9/9 backup after import + restore test + SITE_1 post-check"
systemctl start vialabote-shop-pgdump.service
DUMP=$(ls -1t /var/backups/vialabote-shop/daily/*.dump | head -1)
"$RUNUSER" -u postgres -- createdb -p "$PORT" vialabote_shop_restore_test
"$RUNUSER" -u postgres -- pg_restore -p "$PORT" -d vialabote_shop_restore_test --no-owner "$DUMP"
RESTORED=$(pg -d vialabote_shop_restore_test -c 'select count(*) from "Product"')
"$RUNUSER" -u postgres -- dropdb -p "$PORT" vialabote_shop_restore_test
[ "$RESTORED" = 13 ] && RESTORE=PASS || RESTORE=FAIL
bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-post.txt"
strip() { sed '/^-- info --$/,$d' "$1"; }
diff <(strip "$WORK/site1-pre.txt") <(strip "$WORK/site1-post.txt") && SITE1=UNCHANGED || SITE1=CHANGED

echo
echo "SITE_2_DB_MIGRATION=$([ "$SMOKE$RESTORE$SITE1" = PASSPASSUNCHANGED ] && echo PASS || echo FAIL)"
echo "MIGRATIONS=$MIGRATIONS"
echo "TOTAL_SKU=$TOTAL_SKU (published $PUBLISHED)"
echo "CATALOG_PARITY=$(sed -n 's/^CATALOG_PARITY=//p' "$WORK/parity.txt")"
echo "ISOLATION=dbs[$DBS] tables=prisma-only; $COUNTS"
echo "APP_SMOKE=$SMOKE (home=$HOME_CODE cards=$CARDS toniki=$TONIKI pdp=$PDP_CODE)"
echo "BACKUP_AFTER_IMPORT=$(basename "$DUMP") ($(stat -c %s "$DUMP") bytes)"
echo "RESTORE_TEST=$RESTORE ($RESTORED products restored)"
echo "SITE_1=$SITE1"
echo "RELEASE=$REL"
echo "EVIDENCE=$WORK"
