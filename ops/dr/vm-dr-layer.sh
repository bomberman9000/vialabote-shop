#!/usr/bin/env bash
# Vialabote DR — VM layer for backup ingestion, restore and local test routing.
# Runs INSIDE vialabote-dr as root. Idempotent.
#
#  - users dr-ingest (write-only /srv/dr-inbox) and dr-src (read-only TEST source
#    /var/backups/vialabote-dr-out), both reachable only with the ZeroHour transfer
#    key, forced `rrsync` (no shell, no forwarding); UFW unchanged (SSH only from host)
#  - GPG key for DR backups: private part stays in the VM (/etc/vialabote-dr/gnupg),
#    public part exported for the backup source (PRIMARY) to encrypt to
#  - state dirs /var/lib/vialabote-dr/{sets,restore,status,releases}
#  - nginx test-only routing on 127.0.0.1:8081 for vialabote.ru / shop.vialabote.ru
#    (no public listener, production DNS untouched)
#
# usage: bash vm-dr-layer.sh "<ssh-ed25519 transfer public key of ZeroHour>"
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive
KEY="${1:?transfer public key}"
case "$KEY" in ssh-ed25519\ *) ;; *) echo "ABORT: expected ssh-ed25519 key" >&2; exit 1 ;; esac
[ "$(hostname)" = vialabote-dr ] || { echo "ABORT: not the DR VM" >&2; exit 1; }
step() { echo; echo "== $*"; }

step "1/5 packages"
apt-get install -y -qq rsync gnupg >/dev/null
command -v rrsync >/dev/null || ln -sf /usr/share/doc/rsync/scripts/rrsync /usr/local/bin/rrsync
echo "rsync $(rsync --version | head -1 | awk '{print $3}'), rrsync $(command -v rrsync)"

step "2/5 transfer users (forced rrsync, host key only)"
install -d -m 0755 /srv
for spec in "dr-ingest:/srv/dr-inbox:-wo" "dr-src:/var/backups/vialabote-dr-out:-ro"; do
  u=${spec%%:*}; rest=${spec#*:}; dir=${rest%%:*}; mode=${rest##*:}
  getent passwd "$u" >/dev/null || useradd --system --create-home --home-dir "/var/lib/$u" --shell /bin/sh "$u"
  install -d -m 0750 -o "$u" -g "$u" "$dir"
  # rrsync cannot create nested parents: pre-create the inbox subdirectories
  if [ "$u" = dr-ingest ]; then install -d -m 0750 -o "$u" -g "$u" "$dir/sets" "$dir/releases"; fi
  install -d -m 0700 -o "$u" -g "$u" "/var/lib/$u/.ssh"
  printf 'restrict,command="rrsync %s %s" %s\n' "$mode" "$dir" "$KEY" > "/var/lib/$u/.ssh/authorized_keys"
  chown "$u:$u" "/var/lib/$u/.ssh/authorized_keys"; chmod 600 "/var/lib/$u/.ssh/authorized_keys"
  passwd -l "$u" >/dev/null 2>&1 || true
done
# the restore job (root) and the TEST source producer need group access
usermod -aG dr-src postgres 2>/dev/null || true
sed -i 's/^AllowUsers .*/AllowUsers vladmin dr-ingest dr-src/' /etc/ssh/sshd_config.d/60-vialabote-dr.conf
sshd -t && systemctl reload ssh
echo "users: $(id -u dr-ingest)/$(id -u dr-src); sshd AllowUsers: $(sshd -T | awk '/^allowusers/{print $2,$3,$4}' | tr '\n' ' ')"

step "3/5 DR backup encryption key (private part never leaves the VM)"
export GNUPGHOME=/etc/vialabote-dr/gnupg
install -d -m 0700 "$GNUPGHOME"
if ! gpg --batch --list-secret-keys vialabote-dr-backup >/dev/null 2>&1; then
  gpg --batch --quiet --passphrase '' --quick-generate-key "vialabote-dr-backup <dr@vialabote.invalid>" ed25519 cert 0
  FPR=$(gpg --batch --list-keys --with-colons vialabote-dr-backup | awk -F: '/^fpr/{print $10; exit}')
  gpg --batch --quiet --passphrase '' --quick-add-key "$FPR" cv25519 encr 0
fi
gpg --batch --armor --export vialabote-dr-backup > /etc/vialabote-dr/dr-backup-pubkey.asc
chmod 644 /etc/vialabote-dr/dr-backup-pubkey.asc
echo "key: $(gpg --batch --list-keys --with-colons vialabote-dr-backup | awk -F: '/^fpr/{print $10; exit}') (public: /etc/vialabote-dr/dr-backup-pubkey.asc)"

step "4/5 state dirs"
install -d -m 0700 /var/lib/vialabote-dr /var/lib/vialabote-dr/sets /var/lib/vialabote-dr/restore /var/lib/vialabote-dr/status /var/lib/vialabote-dr/releases
echo "ok"

step "5/5 nginx test-only routing 127.0.0.1:8081"
cat > /etc/nginx/sites-available/vialabote-dr-testroute <<'EOF'
# TEST-ONLY local routing for DR smoke (curl --resolve <host>:8081:127.0.0.1).
# Public SITE_1/SITE_2 vhosts + TLS are created only during an approved failover.
server {
    listen 127.0.0.1:8081;
    server_name vialabote.ru www.vialabote.ru;
    location / { proxy_pass http://127.0.0.1:3001; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto http; proxy_set_header X-Forwarded-For $remote_addr; }
}
server {
    listen 127.0.0.1:8081;
    server_name shop.vialabote.ru;
    client_max_body_size 12m;
    location / { proxy_pass http://127.0.0.1:3002; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto http; proxy_set_header X-Forwarded-For $remote_addr; }
}
EOF
ln -sfn /etc/nginx/sites-available/vialabote-dr-testroute /etc/nginx/sites-enabled/vialabote-dr-testroute
nginx -t 2>&1 | tail -1 && systemctl reload nginx
echo "VM_DR_LAYER=OK"
