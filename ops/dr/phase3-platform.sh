#!/usr/bin/env bash
# Vialabote DR — PHASE 3: application platform inside the DR VM `vialabote-dr`.
# Runbook: ~/Obsidian/projects/vialabote/VIALABOTE-DR-ZEROHOUR.md
#
# Runs INSIDE the VM as root (owner runs it via `ssh ... vladmin@vm sudo bash ...`).
# Mirrors the PRIMARY layout so a restore needs no path/port changes:
#   SITE_1  user vialabote       /opt/vialabote       /etc/vialabote       Node 22  127.0.0.1:3001  PG 16/main :5432
#   SITE_2  user vialabote-shop  /opt/vialabote-shop  /etc/vialabote-shop  Node 24  127.0.0.1:3002  PG 16/shop :5433
# Apps are NOT started (no releases until Phase 4): units are installed + disabled.
# No public DNS/TLS, no new inbound firewall rules. Secrets (DB passwords) are
# generated here, stored only in /etc/vialabote-shop/db.env (0640), never printed.
# Rollback: on ZeroHour `virsh snapshot-revert vialabote-dr baseline-phase2`.
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive
NODE24=v24.21.0
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
[ "$(id -u)" -eq 0 ] || die "run as root"
[ "$(hostname)" = vialabote-dr ] || die "this is not the DR VM (hostname $(hostname))"

step "1/9 packages: PostgreSQL 16, nginx, tooling"
apt-get update -qq
apt-get install -y -qq postgresql-16 postgresql-client-16 nginx logrotate xz-utils curl ca-certificates >/dev/null
echo "postgres $(psql --version | awk '{print $3}') | nginx $(nginx -v 2>&1 | cut -d/ -f2)"

step "2/9 swap (2 GB) + journald cap — VM has 4 GB RAM for 2 apps + 2 PG clusters"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=1G\n' > /etc/systemd/journald.conf.d/70-size.conf
systemctl restart systemd-journald
echo "swap: $(swapon --show --noheadings | awk '{print $1, $3}')"

step "3/9 Node runtimes (SHA256-verified tarballs from nodejs.org)"
install_node() {  # $1 = version (vX.Y.Z), $2 = target dir
  local v=$1 dst=$2 f="node-$1-linux-x64.tar.xz" tmp
  if [ "$("$dst/bin/node" -v 2>/dev/null)" = "$v" ]; then echo "node $v already at $dst"; return; fi
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/$f" "https://nodejs.org/dist/$v/$f"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$v/SHASUMS256.txt"
  (cd "$tmp" && grep " $f\$" SHASUMS256.txt | sha256sum -c --quiet -) || die "checksum mismatch for $f"
  install -d -m 0755 "$dst"; tar -C "$dst" --strip-components=1 -xJf "$tmp/$f"
  rm -f "$tmp/$f" "$tmp/SHASUMS256.txt"; rmdir "$tmp"
  echo "node $("$dst/bin/node" -v) -> $dst (sha256 ok)"
}
# SITE_2: exactly the production version. SITE_1: latest 22.x (exact PRIMARY version to confirm in Phase 0).
install_node "$NODE24" "/opt/vialabote-shop/node-$NODE24"
NODE22=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -oE 'node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | head -1 | sed 's/node-\(v[0-9.]*\)-linux.*/\1/')
[ -n "$NODE22" ] || die "could not resolve latest Node 22"
install_node "$NODE22" /opt/node22

step "4/9 Unix users + directories (SITE_1 / SITE_2 isolated)"
for u in vialabote vialabote-shop; do getent passwd "$u" >/dev/null || useradd --system --home-dir "/opt/$u" --no-create-home --shell /usr/sbin/nologin "$u"; done
install -d -m 0755 -o root -g root /opt/vialabote /opt/vialabote/releases /opt/vialabote-shop /opt/vialabote-shop/releases
install -d -m 0750 -o vialabote -g vialabote /opt/vialabote/shared /opt/vialabote/shared/uploads
install -d -m 0750 -o vialabote-shop -g vialabote-shop /opt/vialabote-shop/shared /opt/vialabote-shop/shared/uploads /opt/vialabote-shop/shared/uploads/media
install -d -m 0750 -o root -g vialabote /etc/vialabote
install -d -m 0750 -o root -g vialabote-shop /etc/vialabote-shop
install -d -m 0700 -o postgres -g postgres /var/backups/vialabote-dr
echo "users: $(id -u vialabote)/$(id -u vialabote-shop); dirs ready"

step "5/9 PostgreSQL: 16/main (SITE_1, :5432) + separate cluster 16/shop (SITE_2, :5433)"
pg_lsclusters --no-header | awk '{print $1"/"$2}' | grep -qx 16/main || die "cluster 16/main missing after install"
grep -q "^listen_addresses = 'localhost'" /etc/postgresql/16/main/postgresql.conf || sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" /etc/postgresql/16/main/postgresql.conf
if ! pg_lsclusters --no-header | awk '{print $2}' | grep -qx shop; then
  pg_createcluster 16 shop --port 5433 --start-conf auto -- --auth-local=peer --auth-host=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8 --data-checksums >/dev/null
  cat > /etc/postgresql/16/shop/conf.d/10-vialabote-shop.conf <<EOF
listen_addresses = 'localhost'
port = 5433
max_connections = 30
shared_buffers = 128MB
password_encryption = scram-sha-256
EOF
  cat > /etc/postgresql/16/shop/pg_hba.conf <<EOF
local   all             postgres                                             peer
host    vialabote_shop  vialabote_shop_owner,vialabote_shop_app  127.0.0.1/32   scram-sha-256
host    vialabote_shop  vialabote_shop_owner,vialabote_shop_app  ::1/128        scram-sha-256
EOF
  chown postgres:postgres /etc/postgresql/16/shop/pg_hba.conf /etc/postgresql/16/shop/conf.d/10-vialabote-shop.conf
  chmod 640 /etc/postgresql/16/shop/pg_hba.conf
fi
systemctl restart postgresql@16-main.service
systemctl start postgresql@16-shop.service
for p in 5432 5433; do for _ in $(seq 1 30); do pg_isready -q -h 127.0.0.1 -p $p && break; sleep 1; done; done
if [ ! -f /etc/vialabote-shop/db.env ]; then
  OWNER_PW=$(openssl rand -hex 24); APP_PW=$(openssl rand -hex 24)
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -p 5433 -d postgres <<SQL
CREATE ROLE vialabote_shop_owner LOGIN PASSWORD '$OWNER_PW' CONNECTION LIMIT 5;
CREATE ROLE vialabote_shop_app LOGIN PASSWORD '$APP_PW' CONNECTION LIMIT 20;
CREATE DATABASE vialabote_shop OWNER vialabote_shop_owner ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE vialabote_shop FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE vialabote_shop TO vialabote_shop_app;
\connect vialabote_shop
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO vialabote_shop_owner;
GRANT USAGE ON SCHEMA public TO vialabote_shop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vialabote_shop_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vialabote_shop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vialabote_shop_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vialabote_shop_app;
SQL
  umask 027
  cat > /etc/vialabote-shop/db.env <<EOF
# DR vialabote-shop (SITE_2) database — generated $STAMP on vialabote-dr. Not the PRIMARY credentials.
DATABASE_URL=postgresql://vialabote_shop_app:$APP_PW@127.0.0.1:5433/vialabote_shop?schema=public&connection_limit=10
MIGRATE_DATABASE_URL=postgresql://vialabote_shop_owner:$OWNER_PW@127.0.0.1:5433/vialabote_shop?schema=public
EOF
  chown root:vialabote-shop /etc/vialabote-shop/db.env; chmod 640 /etc/vialabote-shop/db.env
  unset OWNER_PW APP_PW; umask 022
  echo "SITE_2 DB vialabote_shop + roles owner/app created; credentials in /etc/vialabote-shop/db.env (not printed)"
else
  echo "SITE_2 DB credentials already present — not regenerated"
fi
echo "SITE_1 DB/roles: deferred to Phase 0 (PRIMARY names unknown); cluster 16/main ready"

step "6/9 systemd units (installed, DISABLED — no release until Phase 4)"
cat > /etc/systemd/system/vialabote-site.service <<EOF
# DR standby SITE_1 (vialabote.ru). Not enabled until a verified release is restored (Phase 4-6).
[Unit]
Description=VIA LABOTE Site (SITE_1, DR standby)
Wants=network-online.target postgresql@16-main.service
After=network-online.target postgresql@16-main.service
ConditionPathExists=/opt/vialabote/current/package.json
[Service]
Type=simple
User=vialabote
Group=vialabote
WorkingDirectory=/opt/vialabote/current
EnvironmentFile=-/etc/vialabote/site.env
Environment=PATH=/opt/node22/bin:/usr/bin:/bin NODE_ENV=production
ExecStart=/opt/node22/bin/node /opt/vialabote/current/node_modules/next/dist/bin/next start -p 3001 -H 127.0.0.1
Restart=on-failure
RestartSec=5
MemoryMax=900M
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/vialabote-shop.service <<EOF
# DR standby SITE_2 (shop.vialabote.ru). Mirrors PRIMARY vialabote-shop.service. Not enabled until Phase 4-6.
[Unit]
Description=VIA LABOTE Shop (SITE_2, DR standby) on 127.0.0.1:3002
Wants=network-online.target postgresql@16-shop.service
After=network-online.target postgresql@16-shop.service
ConditionPathExists=/opt/vialabote-shop/current/package.json
StartLimitIntervalSec=300
StartLimitBurst=5
[Service]
Type=simple
User=vialabote-shop
Group=vialabote-shop
WorkingDirectory=/opt/vialabote-shop/current
EnvironmentFile=-/etc/vialabote-shop/app.env
Environment=NODE_ENV=production PORT=3002 HOSTNAME=127.0.0.1 HOME=/opt/vialabote-shop/shared NEXT_TELEMETRY_DISABLED=1
ExecStart=/opt/vialabote-shop/node-$NODE24/bin/node /opt/vialabote-shop/current/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3002
Restart=on-failure
RestartSec=5
TimeoutStartSec=90
TimeoutStopSec=20
KillMode=mixed
MemoryMax=700M
CPUWeight=50
TasksMax=256
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/vialabote-shop/releases /opt/vialabote-shop/shared
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
UMask=0027
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/vialabote-site.service /etc/systemd/system/vialabote-shop.service 2>&1 | grep -v "^$" | sed 's/^/   verify: /' || true
echo "units: site=$(systemctl is-enabled vialabote-site.service) shop=$(systemctl is-enabled vialabote-shop.service)"

step "7/9 nginx: localhost-only DR health endpoint (no public vhosts, no TLS)"
rm -f /etc/nginx/sites-enabled/default
cat > /etc/nginx/sites-available/vialabote-dr-health <<'EOF'
# DR health — localhost only. Public SITE_1/SITE_2 vhosts are added only during an approved failover (Phase 8).
server {
    listen 127.0.0.1:8090;
    server_name _;
    location = /dr-health { default_type text/plain; return 200 "vialabote-dr nginx ok\n"; }
    location / { return 404; }
}
EOF
ln -sfn /etc/nginx/sites-available/vialabote-dr-health /etc/nginx/sites-enabled/vialabote-dr-health
nginx -t 2>&1 | tail -1
systemctl enable --now nginx >/dev/null 2>&1; systemctl reload nginx

step "8/9 health check command"
cat > /usr/local/sbin/vialabote-dr-health <<'EOF'
#!/usr/bin/env bash
# Prints DR VM platform health; exit 0 only if the platform layer is healthy.
ok=0
chk() { if eval "$2" >/dev/null 2>&1; then echo "OK   $1"; else echo "FAIL $1"; ok=1; fi; }
chk "postgresql 16/main :5432"      "pg_isready -q -h 127.0.0.1 -p 5432"
chk "postgresql 16/shop :5433"      "pg_isready -q -h 127.0.0.1 -p 5433"
chk "nginx /dr-health"              "[ \"\$(curl -s -m 5 http://127.0.0.1:8090/dr-health)\" = 'vialabote-dr nginx ok' ]"
chk "no app port open publicly"     "! ss -ltnH | awk '{print \$4}' | grep -qE '^(0\.0\.0\.0|\[::\]|\*):(3001|3002|5432|5433|8090)\$'"
chk "swap active"                   "swapon --show --noheadings | grep -q swapfile"
echo "INFO SITE_1 unit: $(systemctl is-enabled vialabote-site.service 2>&1)/$(systemctl is-active vialabote-site.service 2>&1) (release present: $(test -e /opt/vialabote/current/package.json && echo yes || echo no))"
echo "INFO SITE_2 unit: $(systemctl is-enabled vialabote-shop.service 2>&1)/$(systemctl is-active vialabote-shop.service 2>&1) (release present: $(test -e /opt/vialabote-shop/current/package.json && echo yes || echo no))"
exit $ok
EOF
chmod 755 /usr/local/sbin/vialabote-dr-health

step "9/9 verification"
/usr/local/sbin/vialabote-dr-health && HEALTH=PASS || HEALTH=FAIL
echo "listeners: $(ss -ltnH | awk '{print $4}' | sort -u | tr '\n' ' ')"
echo "ufw: $(ufw status | head -1)"
echo
echo "PHASE3_PLATFORM=$HEALTH"
echo "POSTGRES=16/main:5432 + 16/shop:5433 (localhost only)"
echo "NODE=SITE_1 $NODE22 /opt/node22 ; SITE_2 $NODE24 /opt/vialabote-shop/node-$NODE24"
echo "NGINX=127.0.0.1:8090 /dr-health"
echo "SYSTEMD=vialabote-site + vialabote-shop installed, disabled (await releases)"
