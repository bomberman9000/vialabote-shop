#!/usr/bin/env bash
# SITE_2 (vialabote-shop) — PostgreSQL + backup on the shared VPS.
# Scope of THIS script only: pre-check -> system user/dirs -> separate PG16
# cluster "16/shop" (127.0.0.1:5433) with its own roles/DB -> backup timer ->
# first backup -> post-check diff. No app, no nginx, no DNS, no swap.
#
# SITE_1 (vialabote.ru) is never written to: its files, units, PG cluster
# 16/main, nginx and processes are only READ by site1-healthcheck.sh, before
# and after; the run fails loudly if the two snapshots differ.
#
# Secrets: generated here with openssl, written only to
# /etc/vialabote-shop/db.env (0640 root:vialabote-shop), passed to psql via
# stdin (never argv), never printed.
#
# usage (as root):  bash site2-db-setup.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SVC_USER=vialabote-shop
CLUSTER=shop
PORT=5433
DB=vialabote_shop
OWNER=vialabote_shop_owner
APP=vialabote_shop_app
ETC=/etc/vialabote-shop
OPT=/opt/vialabote-shop
BACKUPS=/var/backups/vialabote-shop
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-setup-$STAMP

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash $0)"
command -v pg_createcluster >/dev/null || die "pg_createcluster not found"
mkdir -p "$WORK"; chmod 700 "$WORK"

step "0/7 preflight: nothing of SITE_2 may exist yet"
getent passwd "$SVC_USER" >/dev/null && die "user $SVC_USER already exists"
pg_lsclusters --no-header | awk '{print $2}' | grep -qx "$CLUSTER" && die "cluster 16/$CLUSTER already exists"
ss -ltnH "sport = :$PORT" | grep -q . && die "port $PORT already in use"
for p in "$ETC" "$OPT" "$BACKUPS"; do [ -e "$p" ] && die "$p already exists"; done
[ "$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)" -ge 1200 ] || die "less than 1200 MB RAM available"
echo "ok"

step "1/7 SITE_1 pre-check"
bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-pre.txt"
cat "$WORK/site1-pre.txt"
grep -q "^http https://vialabote.ru/ 200$" "$WORK/site1-pre.txt" || die "SITE_1 not healthy before start — nothing changed"
grep -q "^unit vialabote-site.service active running" "$WORK/site1-pre.txt" || die "vialabote-site not running before start — nothing changed"

step "2/7 system user + directories"
useradd --system --home-dir "$OPT" --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
install -d -m 0755 -o root -g root "$OPT" "$OPT/releases"
install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$OPT/shared" "$OPT/shared/uploads"
install -d -m 0750 -o root -g "$SVC_USER" "$ETC"
install -d -m 0700 -o postgres -g postgres "$BACKUPS" "$BACKUPS/daily" "$BACKUPS/weekly"
echo "ok"

step "3/7 PostgreSQL 16 cluster '$CLUSTER' on 127.0.0.1:$PORT (16/main untouched)"
pg_createcluster 16 "$CLUSTER" --port "$PORT" --start-conf auto -- \
  --auth-local=peer --auth-host=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8 --data-checksums >/dev/null
cat > "/etc/postgresql/16/$CLUSTER/conf.d/10-vialabote-shop.conf" <<EOF
# vialabote-shop (SITE_2) — independent of cluster 16/main
listen_addresses = 'localhost'
port = $PORT
max_connections = 30
shared_buffers = 128MB
password_encryption = scram-sha-256
EOF
# Only the app's two roles, only over loopback; postgres via local peer (backups).
cat > "/etc/postgresql/16/$CLUSTER/pg_hba.conf" <<EOF
# TYPE  DATABASE        USER                                  ADDRESS        METHOD
local   all             postgres                                             peer
host    $DB  $OWNER,$APP  127.0.0.1/32   scram-sha-256
host    $DB  $OWNER,$APP  ::1/128        scram-sha-256
EOF
chown postgres:postgres "/etc/postgresql/16/$CLUSTER/pg_hba.conf" "/etc/postgresql/16/$CLUSTER/conf.d/10-vialabote-shop.conf"
chmod 640 "/etc/postgresql/16/$CLUSTER/pg_hba.conf"
# start.conf=auto starts it at boot with the other clusters (no unit enable needed)
systemctl start "postgresql@16-$CLUSTER.service"
for _ in $(seq 1 30); do pg_isready -q -h 127.0.0.1 -p "$PORT" && break; sleep 1; done
pg_isready -h 127.0.0.1 -p "$PORT" || die "cluster 16/$CLUSTER did not start (rollback: site2-db-rollback.sh)"

step "4/7 roles + database (least privilege)"
OWNER_PW=$(openssl rand -hex 24)
APP_PW=$(openssl rand -hex 24)
runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -p "$PORT" -d postgres <<SQL
CREATE ROLE $OWNER LOGIN PASSWORD '$OWNER_PW' CONNECTION LIMIT 5;
CREATE ROLE $APP LOGIN PASSWORD '$APP_PW' CONNECTION LIMIT 20;
CREATE DATABASE $DB OWNER $OWNER ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE $DB FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE $DB TO $APP;
\connect $DB
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO $OWNER;
GRANT USAGE ON SCHEMA public TO $APP;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $APP;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO $APP;
SQL
umask 027
cat > "$ETC/db.env" <<EOF
# vialabote-shop (SITE_2) database — generated $STAMP. Do not copy elsewhere.
# Runtime (DML only):
DATABASE_URL=postgresql://$APP:$APP_PW@127.0.0.1:$PORT/$DB?schema=public&connection_limit=10
# Migrations / seed (schema owner):
MIGRATE_DATABASE_URL=postgresql://$OWNER:$OWNER_PW@127.0.0.1:$PORT/$DB?schema=public
EOF
chown root:"$SVC_USER" "$ETC/db.env"; chmod 640 "$ETC/db.env"
unset OWNER_PW APP_PW
echo "ok — credentials in $ETC/db.env (0640 root:$SVC_USER), not printed"

step "5/7 backup: daily pg_dump, 14 daily + 8 weekly, failure + freshness alerts"
cat > /usr/local/sbin/vialabote-shop-pgdump <<EOF
#!/usr/bin/env bash
# vialabote-shop (SITE_2) backup — runs as postgres via systemd.
set -euo pipefail
dir=$BACKUPS
ts=\$(date -u +%Y%m%dT%H%M%SZ)
tmp="\$dir/daily/.\$ts.dump.part"
pg_dump -p $PORT -Fc -d $DB -f "\$tmp"
pg_restore --list "\$tmp" >/dev/null          # dump must be readable
mv "\$tmp" "\$dir/daily/\$ts.dump"
[ "\$(date -u +%u)" = 7 ] && cp "\$dir/daily/\$ts.dump" "\$dir/weekly/\$ts.dump"
find "\$dir/daily" -name '*.dump' -mtime +14 -delete
find "\$dir/weekly" -name '*.dump' -printf '%T@ %p\\n' | sort -rn | tail -n +9 | cut -d' ' -f2- | xargs -r rm -f
echo "backup ok: \$dir/daily/\$ts.dump (\$(stat -c %s "\$dir/daily/\$ts.dump") bytes)"
EOF
cat > /usr/local/sbin/vialabote-shop-backup-check <<EOF
#!/usr/bin/env bash
# Fails (-> journal priority err) if the newest dump is older than 26 h.
newest=\$(ls -1t $BACKUPS/daily/*.dump 2>/dev/null | head -1)
[ -n "\$newest" ] || { echo "NO BACKUP FOUND in $BACKUPS/daily" >&2; exit 1; }
age=\$(( \$(date +%s) - \$(stat -c %Y "\$newest") ))
[ "\$age" -le 93600 ] || { echo "BACKUP STALE: \$newest is \$((age/3600)) h old" >&2; exit 1; }
echo "backup fresh: \$newest (\$((age/3600)) h)"
EOF
chmod 755 /usr/local/sbin/vialabote-shop-pgdump /usr/local/sbin/vialabote-shop-backup-check

cat > /etc/systemd/system/vialabote-shop-pgdump.service <<EOF
[Unit]
Description=vialabote-shop (SITE_2) PostgreSQL backup
After=postgresql@16-$CLUSTER.service
OnFailure=vialabote-shop-backup-alert.service
[Service]
Type=oneshot
User=postgres
Nice=10
IOSchedulingClass=idle
ExecStart=/usr/local/sbin/vialabote-shop-pgdump
EOF
cat > /etc/systemd/system/vialabote-shop-pgdump.timer <<EOF
[Unit]
Description=Daily vialabote-shop (SITE_2) PostgreSQL backup
[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=10m
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/vialabote-shop-backup-check.service <<EOF
[Unit]
Description=vialabote-shop (SITE_2) backup freshness check
OnFailure=vialabote-shop-backup-alert.service
[Service]
Type=oneshot
User=postgres
ExecStart=/usr/local/sbin/vialabote-shop-backup-check
EOF
cat > /etc/systemd/system/vialabote-shop-backup-check.timer <<EOF
[Unit]
Description=Hourly vialabote-shop (SITE_2) backup freshness check
[Timer]
OnCalendar=hourly
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/vialabote-shop-backup-alert.service <<EOF
[Unit]
Description=vialabote-shop (SITE_2) backup ALERT
[Service]
Type=oneshot
ExecStart=/usr/bin/logger -p user.err -t vialabote-shop-backup "BACKUP FAILURE — see: journalctl -u vialabote-shop-pgdump -u vialabote-shop-backup-check"
EOF
systemctl daemon-reload
systemctl enable --now vialabote-shop-pgdump.timer vialabote-shop-backup-check.timer
systemctl start vialabote-shop-pgdump.service
systemctl start vialabote-shop-backup-check.service
journalctl -u vialabote-shop-pgdump.service -n 3 --no-pager -o cat

step "6/7 restore test of the first dump into a scratch DB"
first=$(ls -1t "$BACKUPS/daily"/*.dump | head -1)
runuser -u postgres -- createdb -p "$PORT" vialabote_shop_restore_test
runuser -u postgres -- pg_restore -p "$PORT" -d vialabote_shop_restore_test --no-owner "$first"
runuser -u postgres -- dropdb -p "$PORT" vialabote_shop_restore_test
echo "restore ok: $first"

step "7/7 SITE_1 post-check + diff"
bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-post.txt"
strip() { sed '/^-- info --$/,$d' "$1"; }
if diff <(strip "$WORK/site1-pre.txt") <(strip "$WORK/site1-post.txt"); then
  SITE1=UNCHANGED
else
  SITE1=CHANGED
fi
grep -A3 "^-- info --" "$WORK/site1-post.txt"

echo
echo "SITE_1=$SITE1"
echo "SITE_2_CLUSTER=$(pg_lsclusters --no-header | awk -v c="$CLUSTER" '$2==c{print $1"/"$2" port="$3" "$4}')"
echo "SITE_2_LISTEN=$(ss -ltnH "sport = :$PORT" | awk '{print $4}' | sort | tr '\n' ' ')"
echo "SITE_2_DB=$DB owner=$OWNER app=$APP (credentials: $ETC/db.env)"
echo "SITE_2_BACKUP=$(systemctl is-active vialabote-shop-pgdump.timer) timer, first dump $(basename "$first"), restore test ok"
echo "EVIDENCE=$WORK (site1-pre.txt, site1-post.txt)"
[ "$SITE1" = UNCHANGED ] || { echo "SITE_1 snapshot changed — review the diff above; rollback: site2-db-rollback.sh" >&2; exit 2; }
