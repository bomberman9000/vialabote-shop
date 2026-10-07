#!/usr/bin/env bash
# SITE_2 (vialabote-shop) — permanent application runtime on 127.0.0.1:3002.
#
#   pre-check (SITE_1 baseline + SITE_2 prerequisites)
#   -> /etc/vialabote-shop/app.env (runtime-only secrets, 0600 root)
#   -> /opt/vialabote-shop/current -> releases/4d57026; uploads -> shared/
#   -> vialabote-shop.service (systemd, user vialabote-shop, hardened)
#   -> daemon-reload, enable, start -> verify (HTTP, catalog, DB, bind)
#   -> controlled restart + crash-restart test -> reboot readiness
#   -> SITE_1 post-check + diff.
#
# No nginx, DNS, SSL, firewall, SITE_1 or PostgreSQL 16/main changes.
# Secrets: read from db.env as data (never sourced/printed); app.env is
# root-only (systemd reads it), never echoed. Re-runnable.
#
# usage (as root):  bash site2-runtime-setup.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SHORT=4d57026
NODE_V=v24.21.0
OPT=/opt/vialabote-shop
REL=$OPT/releases/$SHORT
CURRENT=$OPT/current
NODE_DIR=$OPT/node-$NODE_V
SVC=vialabote-shop
UNIT=/etc/systemd/system/vialabote-shop.service
APP_ENV=/etc/vialabote-shop/app.env
PORT=3002
DB_PORT=5433
DB=vialabote_shop
RUNUSER=/usr/sbin/runuser
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-runtime-$STAMP
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
pgq() { "$RUNUSER" -u postgres -- psql -X -q -At -v ON_ERROR_STOP=1 -p "$DB_PORT" "$@"; }
code() { curl -s -o /dev/null -m 30 -w '%{http_code}' "http://127.0.0.1:$PORT$1"; }
cards() { curl -s -m 30 "http://127.0.0.1:$PORT$1" | grep -oE 'href="/product/[a-z0-9-]+"' | sort -u | wc -l; }
health() {  # prints one line; returns 0 only if fully healthy
  local h c t p
  h=$(code /); c=$(cards /catalog); t=$(cards '/catalog?category=toniki'); p=$(code /product/toner-serum-ph55)
  echo "home=$h catalog_cards=$c toniki=$t pdp=$p"
  [ "$h" = 200 ] && [ "$c" = 13 ] && [ "$t" = 2 ] && [ "$p" = 200 ]
}
wait_up() { for _ in $(seq 1 60); do [ "$(code /)" = 200 ] && return 0; sleep 1; done; return 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash $0)"
mkdir -p "$WORK"; chmod 700 "$WORK"

step "1/8 pre-check (read-only)"
bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-pre.txt"
grep -q "^http https://vialabote.ru/ 200$" "$WORK/site1-pre.txt" || die "SITE_1 not healthy before start — nothing changed"
grep -q "^listen :3001 127.0.0.1:3001 $" "$WORK/site1-pre.txt" || die "SITE_1 port 3001 not as expected — nothing changed"
[ -x "$RUNUSER" ] || die "runuser missing"
[ -d "$REL" ] && [ -f "$REL/.next/BUILD_ID" ] || die "release $REL missing or not built"
[ "$("$NODE_DIR/bin/node" -v)" = "$NODE_V" ] || die "SITE_2 Node $NODE_V missing"
getent passwd "$SVC" >/dev/null || die "user $SVC missing"
[ "$(stat -c '%a %U' /etc/vialabote-shop/db.env)" = "640 root" ] || die "db.env permissions unexpected"
pg_isready -q -h 127.0.0.1 -p "$DB_PORT" || die "PostgreSQL 16/shop not accepting connections"
[ "$(pgq -d "$DB" -c "select count(*) from \"Product\" where status='published' and \"isActive\"")" = 13 ] || die "SITE_2 DB does not have 13 published SKU"
if systemctl is-active --quiet vialabote-shop.service; then
  echo "re-run: vialabote-shop.service already active (will be restarted with the new unit)"
else
  ss -ltnH "sport = :$PORT" | grep -q . && die "port $PORT is in use by something else"
fi
echo "ok: SITE_1 healthy, release $SHORT (build $(cat "$REL/.next/BUILD_ID")), node $NODE_V, 16/shop up, 13 published SKU, :$PORT free"

step "2/8 runtime env (app role only; owner credentials stay out of the service)"
DATABASE_URL=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in DATABASE_URL=*) DATABASE_URL=${line#DATABASE_URL=} ;; esac
done < /etc/vialabote-shop/db.env
case "$DATABASE_URL" in *"@127.0.0.1:$DB_PORT/$DB?"*) ;; *) die "DATABASE_URL in db.env does not point at 127.0.0.1:$DB_PORT/$DB" ;; esac
NEXTAUTH_SECRET=""
[ -f "$APP_ENV" ] && NEXTAUTH_SECRET=$(sed -n 's/^NEXTAUTH_SECRET=//p' "$APP_ENV")
[ -n "$NEXTAUTH_SECRET" ] || NEXTAUTH_SECRET=$(openssl rand -hex 32)   # generated once, kept on re-runs
umask 077
cat > "$APP_ENV.tmp" <<EOF
# vialabote-shop (SITE_2) runtime env — read by systemd as root. Do not copy.
DATABASE_URL=$DATABASE_URL
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
# Local-only until nginx/domain exist (next task):
NEXTAUTH_URL=http://127.0.0.1:$PORT
NEXT_PUBLIC_APP_URL=http://127.0.0.1:$PORT
EOF
chown root:root "$APP_ENV.tmp"; chmod 600 "$APP_ENV.tmp"; mv "$APP_ENV.tmp" "$APP_ENV"
unset DATABASE_URL NEXTAUTH_SECRET line
umask 022
echo "ok: $APP_ENV (0600 root:root, values not printed)"

step "3/8 current symlink + persistent uploads"
ln -sfn "releases/$SHORT" "$CURRENT"
install -d -m 0750 -o "$SVC" -g "$SVC" "$OPT/shared/uploads" "$OPT/shared/uploads/media"
migrate_uploads() {  # $1 = release public/uploads, $2 = persistent target
  local src="$1" dst="$2" conflicts n f
  if [ -L "$src" ]; then
    [ "$(readlink "$src")" = "$dst" ] || die "$src is a symlink to $(readlink "$src"), expected $dst"
    echo "uploads: already linked to $dst (no-op)"; return 0
  fi
  if [ -e "$src" ]; then
    [ -d "$src" ] || die "$src exists and is not a directory"
    # Never overwrite: any file that already exists in the target aborts the run before anything is moved.
    conflicts=$(cd "$src" && find . -mindepth 1 ! -type d -print | while IFS= read -r f; do
      if [ -e "$dst/$f" ] || [ -L "$dst/$f" ]; then echo "$f"; fi
    done)
    [ -z "$conflicts" ] || die "uploads conflict, nothing moved — already in $dst: $(echo "$conflicts" | head -5 | tr '\n' ' ')"
    n=$(find "$src" -mindepth 1 ! -type d | wc -l)
    if [ "$n" -gt 0 ]; then
      (cd "$src" && find . -mindepth 1 -type d -print | while IFS= read -r f; do install -d -m 0750 -o "$SVC" -g "$SVC" "$dst/$f"; done)
      cp -a --no-clobber "$src/." "$dst/"
      chown -R "$SVC":"$SVC" "$dst"
      # Every source file must exist in the target with the same content.
      (cd "$src" && find . -mindepth 1 -type f -print0 | xargs -0 -r sha256sum) > "$WORK/uploads-src.sha256"
      (cd "$dst" && sha256sum -c --quiet "$WORK/uploads-src.sha256") || die "uploads copy verification failed — source left in place at $src"
    fi
    mv "$src" "$WORK/release-public-uploads.orig"   # kept, never deleted
    echo "uploads: migrated $n file(s) from release dir into $dst; original kept at $WORK/release-public-uploads.orig"
  fi
  ln -s "$dst" "$src.tmp-link-$STAMP"
  mv -T "$src.tmp-link-$STAMP" "$src"   # atomic rename into place
}
migrate_uploads "$REL/public/uploads" "$OPT/shared/uploads"
echo "ok: $CURRENT -> $(readlink "$CURRENT"); public/uploads -> $(readlink "$REL/public/uploads")"

step "4/8 systemd unit"
cat > "$WORK/vialabote-shop.service" <<EOF
# vialabote-shop (SITE_2) — independent of vialabote-site.service (SITE_1).
[Unit]
Description=VIA LABOTE Shop (SITE_2) — Next.js on 127.0.0.1:$PORT
Wants=network-online.target postgresql@16-shop.service
After=network-online.target postgresql@16-shop.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=$SVC
Group=$SVC
WorkingDirectory=$CURRENT
EnvironmentFile=$APP_ENV
Environment=NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 HOME=$OPT/shared NEXT_TELEMETRY_DISABLED=1
ExecStart=$NODE_DIR/bin/node $CURRENT/node_modules/next/dist/bin/next start -H 127.0.0.1 -p $PORT
Restart=on-failure
RestartSec=5
TimeoutStartSec=90
TimeoutStopSec=20
KillMode=mixed
KillSignal=SIGTERM
SyslogIdentifier=vialabote-shop

# Resources (SITE_1 keeps priority on this 2 vCPU / 4 GB host)
MemoryMax=700M
CPUWeight=50
TasksMax=256

# Hardening (compatible with Node/V8: no MemoryDenyWriteExecute)
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$OPT/releases $OPT/shared
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
UMask=0027

[Install]
WantedBy=multi-user.target
EOF
VERIFY=$(systemd-analyze verify "$WORK/vialabote-shop.service" 2>&1 || true)
[ -z "$VERIFY" ] && echo "systemd-analyze verify: clean" || echo "$VERIFY" | sed 's/^/   verify: /'
install -m 0644 -o root -g root "$WORK/vialabote-shop.service" "$UNIT"
echo "ok: $UNIT"

step "5/8 daemon-reload, enable, start (only vialabote-shop.service)"
systemctl daemon-reload
systemctl enable vialabote-shop.service 2>&1 | sed 's/^/   /'
systemctl restart vialabote-shop.service
wait_up || { journalctl -u vialabote-shop -n 30 --no-pager -o cat; die "service did not become healthy (rollback: site2-runtime-rollback.sh)"; }

step "6/8 verification of the permanent service"
HEALTH1=$(health) && H1=PASS || H1=FAIL; echo "$HEALTH1"
BIND=$(ss -ltnH "sport = :$PORT" | awk '{print $4}' | sort | tr '\n' ' ')
echo "bind: $BIND"
[ "$BIND" = "127.0.0.1:$PORT " ] && BINDOK=PASS || BINDOK=FAIL
DBCONN=$(pgq -d postgres -c "select count(*) from pg_stat_activity where datname='$DB' and usename='vialabote_shop_app'")
echo "db connections from app role: $DBCONN"
[ "$DBCONN" -ge 1 ] && DBOK=PASS || DBOK=FAIL
PID1=$(systemctl show -p MainPID --value vialabote-shop)
PUSER=$(stat -c %U "/proc/$PID1")
echo "process: pid=$PID1 user=$PUSER rss=$(( $(ps -o rss= -p "$PID1") / 1024 ))MB"
[ "$PUSER" = "$SVC" ] && USEROK=PASS || USEROK=FAIL
echo "restart policy: $(systemctl show -p Restart --value vialabote-shop) (RestartSec=$(systemctl show -p RestartUSec --value vialabote-shop))"
# Secrets must not be in status/journal/unit properties.
SEC_LEAK=NO
for v in $(grep -E '^(DATABASE_URL|NEXTAUTH_SECRET)=' "$APP_ENV" | cut -d= -f2- | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#'); do
  { systemctl status vialabote-shop --no-pager -l 2>&1; systemctl show vialabote-shop 2>&1; journalctl -u vialabote-shop --no-pager -o cat 2>&1; } | grep -qF "$v" && SEC_LEAK=YES
done
unset v
echo "secrets in status/show/journal: $SEC_LEAK"

step "7/8 restart tests (only vialabote-shop.service)"
systemctl restart vialabote-shop.service
wait_up && HEALTH2=$(health) && R1=PASS || R1=FAIL
PID2=$(systemctl show -p MainPID --value vialabote-shop)
echo "controlled restart: pid $PID1 -> $PID2; ${HEALTH2:-unhealthy}"
[ "$PID1" != "$PID2" ] || R1=FAIL
N0=$(systemctl show -p NRestarts --value vialabote-shop)
PIDK=$(systemctl show -p MainPID --value vialabote-shop)
# Kill ONLY the main process (simulated crash). The default --kill-whom=all
# also signals "auxiliary processes" via the cgroup, which on this host's
# system manager (systemd 255) failed with EINVAL although the main kill
# had succeeded; success is judged by PID/NRestarts/health, not by rc.
systemctl kill --kill-whom=main -s SIGKILL vialabote-shop.service || echo "   (systemctl kill rc=$? — judged by restart evidence below)"
sleep 7
wait_up && HEALTH3=$(health) && R2=PASS || R2=FAIL
N1=$(systemctl show -p NRestarts --value vialabote-shop)
PIDN=$(systemctl show -p MainPID --value vialabote-shop)
echo "crash (SIGKILL MainPID only) -> auto-restart: pid $PIDK -> $PIDN, NRestarts $N0 -> $N1; ${HEALTH3:-unhealthy}"
[ "$N1" -gt "$N0" ] && [ "$PIDN" != "$PIDK" ] || R2=FAIL

step "8/8 reboot readiness + SITE_1 post-check"
ENABLED=$(systemctl is-enabled vialabote-shop.service)
echo "is-enabled: $ENABLED; WantedBy: $(systemctl show -p WantedBy --value vialabote-shop)"
echo "After: $(systemctl show -p After --value vialabote-shop | tr ' ' '\n' | grep -E 'postgresql@16-shop|network-online' | tr '\n' ' ')"
echo "postgresql.service: $(systemctl is-enabled postgresql.service); 16/shop start.conf: $(grep -v '^#' /etc/postgresql/16/shop/start.conf | grep .)"
bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-post.txt"
strip() { sed '/^-- info --$/,$d' "$1"; }
diff <(strip "$WORK/site1-pre.txt") <(strip "$WORK/site1-post.txt") && SITE1=UNCHANGED || SITE1=CHANGED
grep -A2 "^-- info --" "$WORK/site1-post.txt"

pick() { grep -E "^$1" "$WORK/site1-post.txt" | tr '\n' ';'; }
same() { diff <(grep -E "^$1" "$WORK/site1-pre.txt") <(grep -E "^$1" "$WORK/site1-post.txt") >/dev/null && echo UNCHANGED || echo CHANGED; }
ALL="$H1$BINDOK$DBOK$USEROK$R1$R2$SITE1$SEC_LEAK$ENABLED"
echo
echo "SITE_2_RUNTIME=$([ "$ALL" = PASSPASSPASSPASSPASSPASSUNCHANGEDNOenabled ] && echo PASS || echo FAIL)"
echo "RELEASE=$REL (build $(cat "$REL/.next/BUILD_ID")) via $CURRENT"
echo "SERVICE=vialabote-shop.service"
echo "SERVICE_USER=$SVC ($USEROK)"
echo "NODE=$NODE_V"
echo "PORT=$PORT"
echo "BIND_ADDRESS=$BIND($BINDOK)"
echo "POSTGRES=16/shop 127.0.0.1:$DB_PORT"
echo "DATABASE=$DB"
echo "DB_CONNECTION=$DBOK ($DBCONN app-role connections)"
echo "SYSTEMD_ENABLED=$ENABLED"
echo "SYSTEMD_ACTIVE=$(systemctl is-active vialabote-shop.service)"
echo "RESTART_TEST=controlled:$R1 crash-auto:$R2"
echo "HEALTH=$HEALTH3"
echo "SITE_1_HTTP=$(same 'http |cert ')"
echo "SITE_1_SERVICE=$(same 'unit')"
echo "SITE_1_PORT=$(same 'listen ')"
echo "SITE_1_DB=$(same 'unit postgresql@16-main|sha256 /etc/postgresql/16/main|pg-clusters')"
echo "SITE_1=$SITE1"
echo "SECRETS_EXPOSED=$SEC_LEAK"
echo "EVIDENCE=$WORK"
[ "$SITE1" = UNCHANGED ] || { echo "SITE_1 CHANGED — STOP. See diff above. Rollback SITE_2: site2-runtime-rollback.sh" >&2; exit 2; }
