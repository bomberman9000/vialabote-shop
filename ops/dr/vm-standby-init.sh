#!/usr/bin/env bash
# Vialabote DR — initialise the warm-standby runtime with TEST data (until a
# VERIFIED production backup is restored over it). Runs INSIDE vialabote-dr as root.
#
#  SITE_2: prisma migrate deploy (owner role) + repo seed (app role) + catalog parity
#  SITE_1: roles/DB vialabote_site on 16/main + release migrations (scripts/migrate.mjs)
#  env:    DR-only secrets (generated here, never printed); SMTP/notifications OFF
#  units:  enable + start vialabote-site / vialabote-shop (localhost only)
# Marks /var/lib/vialabote-dr/status/standby-data = TEST_SEED (never production).
set -euo pipefail
export LC_ALL=C
die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
[ "$(hostname)" = vialabote-dr ] || die "not the DR VM"
NODE24=/opt/vialabote-shop/node-v24.21.0/bin
NODE22=/opt/node22/bin
kv() { sed -n "s/^$1=//p" "$2" | head -1; }   # read KEY=VALUE as data (no sourcing)

step "1/4 SITE_2 database: migrate + TEST seed + parity"
DB_ENV=/etc/vialabote-shop/db.env
APP_URL=$(kv DATABASE_URL $DB_ENV); OWN_URL=$(kv MIGRATE_DATABASE_URL $DB_ENV)
[ -n "$APP_URL" ] && [ -n "$OWN_URL" ] || die "db.env incomplete"
cd /opt/vialabote-shop/current
env -i PATH=$NODE24:/usr/bin:/bin HOME=/opt/vialabote-shop/shared CHECKPOINT_DISABLE=1 DATABASE_URL="$OWN_URL" \
  /usr/sbin/runuser -u vialabote-shop -- node_modules/.bin/prisma migrate deploy 2>&1 | tail -2
env -i PATH=$NODE24:/usr/bin:/bin HOME=/opt/vialabote-shop/shared DATABASE_URL="$APP_URL" SEED_ADMIN_EMAIL= SEED_ADMIN_PASSWORD= \
  /usr/sbin/runuser -u vialabote-shop -- node_modules/.bin/tsx prisma/seed.ts 2>&1 | tail -1
env -i PATH=$NODE24:/usr/bin:/bin HOME=/opt/vialabote-shop/shared DATABASE_URL="$APP_URL" \
  /usr/sbin/runuser -u vialabote-shop -- node_modules/.bin/tsx scripts/db/verify-catalog.ts 2>&1 | tail -1

step "2/4 SITE_2 app.env (DR secrets, local URL)"
APP_ENV=/etc/vialabote-shop/app.env
SECRET=""; [ -f $APP_ENV ] && SECRET=$(kv NEXTAUTH_SECRET $APP_ENV)
[ -n "$SECRET" ] || SECRET=$(openssl rand -hex 32)
umask 077
cat > $APP_ENV.tmp <<EOF
# DR vialabote-shop runtime env — DR-only secret, NOT production. Telegram/payments not configured.
DATABASE_URL=$APP_URL
NEXTAUTH_SECRET=$SECRET
NEXTAUTH_URL=http://127.0.0.1:3002
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3002
EOF
# Keep the Telegram CMS settings written by vm-telegram-activate.sh.
[ -f $APP_ENV ] && grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|TELEGRAM_CMS_MUTATIONS)=' $APP_ENV >> $APP_ENV.tmp || true
chown root:root $APP_ENV.tmp; chmod 600 $APP_ENV.tmp; mv $APP_ENV.tmp $APP_ENV; unset SECRET APP_URL OWN_URL
umask 022; echo "ok ($APP_ENV 0600, values not printed)"

step "3/4 SITE_1 database (16/main) + migrations"
SITE_ENV=/etc/vialabote/site.env
if [ ! -f /etc/vialabote/db.env ]; then
  O=$(openssl rand -hex 24); A=$(openssl rand -hex 24)
  /usr/sbin/runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -p 5432 -d postgres <<SQL
CREATE ROLE vialabote_site_owner LOGIN PASSWORD '$O' CONNECTION LIMIT 5;
CREATE ROLE vialabote_site_app LOGIN PASSWORD '$A' CONNECTION LIMIT 20;
CREATE DATABASE vialabote_site OWNER vialabote_site_owner ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE vialabote_site FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE vialabote_site TO vialabote_site_app;
\connect vialabote_site
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO vialabote_site_owner;
GRANT USAGE ON SCHEMA public TO vialabote_site_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vialabote_site_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vialabote_site_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vialabote_site_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vialabote_site_app;
SQL
  umask 027
  printf '# DR SITE_1 db — DR-only credentials, NOT production\nDATABASE_URL=postgresql://vialabote_site_app:%s@127.0.0.1:5432/vialabote_site\nMIGRATE_DATABASE_URL=postgresql://vialabote_site_owner:%s@127.0.0.1:5432/vialabote_site\n' "$A" "$O" > /etc/vialabote/db.env
  chown root:vialabote /etc/vialabote/db.env; chmod 640 /etc/vialabote/db.env; umask 022; unset O A
fi
S_APP=$(kv DATABASE_URL /etc/vialabote/db.env); S_OWN=$(kv MIGRATE_DATABASE_URL /etc/vialabote/db.env)
cd /opt/vialabote/current
env -i PATH=$NODE22:/usr/bin:/bin HOME=/opt/vialabote/shared DATABASE_URL="$S_OWN" /usr/sbin/runuser -u vialabote -- node scripts/migrate.mjs 2>&1 | tail -2
umask 077
cat > $SITE_ENV.tmp <<EOF
# DR SITE_1 runtime env — DR-only, NOT production. Notifications/SMTP/external tokens OFF until a real secrets bundle is restored.
DATABASE_URL=$S_APP
EMAIL_NOTIFY_ENABLED=false
FIRST_PARTY_ANALYTICS_SECRET=$(openssl rand -hex 32)
CUSTOM_PRODUCT_RATE_LIMIT_SECRET=$(openssl rand -hex 32)
TECHNOLOGIST_SESSION_SECRET=$(openssl rand -hex 32)
EOF
chown root:root $SITE_ENV.tmp; chmod 600 $SITE_ENV.tmp; mv $SITE_ENV.tmp $SITE_ENV; unset S_APP S_OWN
umask 022; echo "ok ($SITE_ENV 0600, values not printed)"

step "4/4 start standby runtimes (localhost only)"
echo "TEST_SEED $(date -u +%FT%TZ) — repo seed (SITE_2) + empty migrated schema (SITE_1); NOT production data" > /var/lib/vialabote-dr/status/standby-data
systemctl daemon-reload
systemctl enable --now vialabote-site.service vialabote-shop.service 2>&1 | tail -2
for p in 3001 3002; do for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$p/)" != 000 ] && break; sleep 2; done; done
echo "site1 :3001 -> $(curl -s -o /dev/null -m 20 -w '%{http_code}' http://127.0.0.1:3001/) | site2 :3002 -> $(curl -s -o /dev/null -m 20 -w '%{http_code}' http://127.0.0.1:3002/)"
echo "STANDBY_INIT=DONE data=TEST_SEED"
