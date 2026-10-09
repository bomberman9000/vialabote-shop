#!/usr/bin/env bash
# Vialabote DR — public edge VPS (DR-edge). Runs on the edge as root, over KEY login only.
#
#   Internet -> edge nginx (TLS) -> WireGuard wg0 -> vialabote-dr VM 10.77.0.2:8082
#   (limited/read-only storefronts) -> SITE_1 :3001 / SITE_2 :3002
#
# The edge holds no app, no database, no DR backup material. Its WireGuard peer is the
# DR VM only (AllowedIPs 10.77.0.2/32); it has no route to the ZeroHour host or its LAN.
#
# usage:
#   edge-setup.sh base                 packages, UFW 22/80/443 + 51820/udp, sshd key-only
#   edge-setup.sh wg <vm_wg_pubkey>    wg0 10.77.0.1, prints EDGE_WG_PUBKEY
#   edge-setup.sh nginx                HTTP vhosts (proxy + ACME webroot), default 444
#   edge-setup.sh cert-start           DNS-01 order in background (certbot, manual hook)
#   edge-setup.sh cert-status          TXT records to add + order state
#   edge-setup.sh tls                  HTTPS vhosts, HTTP->HTTPS, default TLS reject
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive
die() { echo "ABORT: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root"
VM_WG=10.77.0.2; EDGE_WG=10.77.0.1; WGPORT=51820; UP=$VM_WG:8082
NAMES="vialabote.ru www.vialabote.ru shop.vialabote.ru"
CERT=vialabote-dr
D1=/run/vl-dns01

case "${1:-}" in
base)
  . /etc/os-release; echo "OS=$PRETTY_NAME"
  case "$ID" in ubuntu|debian) ;; *) die "unsupported OS $ID";; esac
  # key login must be the way we are connected right now
  [ -s /root/.ssh/authorized_keys ] || die "no authorized_keys"
  [ -n "${SSH_CONNECTION:-}" ] || die "run over ssh"
  apt-get update -qq
  apt-get install -y -qq nginx wireguard-tools certbot dnsutils ufw curl >/dev/null
  # sshd: key-only; root keeps key login (recovery path; provider console is the fallback)
  cat > /etc/ssh/sshd_config.d/10-vialabote-edge.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding no
EOF
  sshd -t
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  ufw allow 22/tcp comment ssh >/dev/null
  ufw allow 80/tcp comment http >/dev/null
  ufw allow 443/tcp comment https >/dev/null
  ufw allow $WGPORT/udp comment vialabote-dr-wg >/dev/null
  ufw --force enable >/dev/null
  ufw status verbose | sed -n '1,20p'
  echo "sshd: $(sshd -T | grep -E '^(passwordauthentication|permitrootlogin|kbdinteractiveauthentication) ' | tr '\n' ' ')"
  echo "EDGE_BASE=OK"
  ;;
wg)
  VMPUB=${2:?vm wg pubkey}
  [[ "$VMPUB" =~ ^[A-Za-z0-9+/]{43}=$ ]] || die "bad pubkey"
  umask 077; install -d -m 0700 /etc/wireguard
  [ -f /etc/wireguard/edge.key ] || wg genkey > /etc/wireguard/edge.key
  wg pubkey < /etc/wireguard/edge.key > /etc/wireguard/edge.pub
  # private key is loaded from its file, never written into wg0.conf
  cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = $EDGE_WG/24
ListenPort = $WGPORT
PostUp = wg set %i private-key /etc/wireguard/edge.key
[Peer]
# vialabote-dr VM (behind NAT; it keeps the session alive)
PublicKey = $VMPUB
AllowedIPs = $VM_WG/32
EOF
  # wg0 forwards nothing: the edge only talks to the VM itself
  systemctl enable wg-quick@wg0 >/dev/null 2>&1
  systemctl restart wg-quick@wg0
  echo "EDGE_WG_PUBKEY=$(cat /etc/wireguard/edge.pub)"
  wg show wg0 | sed -n '1,12p' | grep -v 'private key'
  ;;
nginx)
  install -d -m 0755 /var/www/acme
  rm -f /etc/nginx/sites-enabled/default
  cat > /etc/nginx/conf.d/vialabote-edge-upstream.conf <<EOF
upstream vialabote_dr { server $UP; keepalive 16; }
EOF
  cat > /etc/nginx/snippets/vialabote-edge-proxy.conf <<'EOF'
proxy_pass http://vialabote_dr;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_connect_timeout 10s;
proxy_read_timeout 60s;
client_max_body_size 1m;
EOF
  cat > /etc/nginx/sites-available/vialabote-edge <<'EOF'
server { listen 80 default_server; listen [::]:80 default_server; server_name _; return 444; }
server {
    listen 80; listen [::]:80;
    server_name vialabote.ru www.vialabote.ru shop.vialabote.ru;
    location /.well-known/acme-challenge/ { root /var/www/acme; }
    location / { include snippets/vialabote-edge-proxy.conf; }
}
EOF
  ln -sfn /etc/nginx/sites-available/vialabote-edge /etc/nginx/sites-enabled/vialabote-edge
  nginx -t 2>&1 | tail -1; systemctl reload nginx
  echo "EDGE_NGINX_HTTP=OK"
  ;;
cert-start)
  install -d -m 0700 "$D1"; : > "$D1/records"; : > "$D1/status"
  cat > /usr/local/sbin/vl-dns01-auth <<'EOF'
#!/bin/sh
# certbot manual auth hook: record every TXT; the LAST challenge waits (<=6h) until all
# records are visible on both authoritative REG.RU nameservers, then lets certbot validate.
D=/run/vl-dns01
echo "_acme-challenge.$CERTBOT_DOMAIN $CERTBOT_VALIDATION" >> $D/records
[ "${CERTBOT_REMAINING_CHALLENGES:-0}" -gt 0 ] && exit 0
echo "WAITING_FOR_TXT $(date -u +%FT%TZ)" >> $D/status
end=$(( $(date +%s) + 21600 ))
while :; do
  ok=1
  while read -r n v; do
    for ns in ns1.reg.ru ns2.reg.ru; do
      dig +short +time=5 +tries=2 TXT "$n" @"$ns" | tr -d '"' | grep -qxF "$v" || ok=0
    done
  done < $D/records
  if [ $ok = 1 ]; then echo "ALL_TXT_VISIBLE $(date -u +%FT%TZ)" >> $D/status; sleep 60; exit 0; fi
  [ "$(date +%s)" -gt $end ] && { echo "TXT_TIMEOUT" >> $D/status; exit 1; }
  sleep 20
done
EOF
  chmod 0755 /usr/local/sbin/vl-dns01-auth
  systemctl reset-failed vl-cert 2>/dev/null || true
  A=(); for n in $NAMES; do A+=(-d "$n"); done
  systemd-run --unit=vl-cert --collect -p StandardOutput=append:/var/log/vl-cert.log -p StandardError=append:/var/log/vl-cert.log \
    certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
      --manual --preferred-challenges dns --manual-auth-hook /usr/local/sbin/vl-dns01-auth \
      --manual-cleanup-hook /bin/true --cert-name "$CERT" "${A[@]}"
  for _ in $(seq 1 60); do [ "$(wc -l < "$D1/records")" -ge 3 ] && break; sleep 2; done
  "$0" cert-status
  ;;
cert-status)
  echo "order: $(systemctl is-active vl-cert 2>/dev/null) | $(tail -n1 "$D1/status" 2>/dev/null)"
  while read -r n v; do echo "TYPE=TXT NAME=$n VALUE=$v TTL=300"; done < "$D1/records" 2>/dev/null
  [ -f /etc/letsencrypt/live/$CERT/fullchain.pem ] && openssl x509 -in /etc/letsencrypt/live/$CERT/fullchain.pem -noout -subject -issuer -enddate -ext subjectAltName
  tail -n 5 /var/log/vl-cert.log 2>/dev/null | grep -v -i key || true
  ;;
tls)
  L=/etc/letsencrypt/live/$CERT; [ -f $L/fullchain.pem ] || die "no certificate yet"
  cat > /etc/nginx/sites-available/vialabote-edge <<EOF
server { listen 80 default_server; listen [::]:80 default_server; server_name _; return 444; }
server { listen 443 ssl default_server; listen [::]:443 ssl default_server; server_name _; ssl_reject_handshake on; }
server {
    listen 80; listen [::]:80;
    server_name vialabote.ru www.vialabote.ru shop.vialabote.ru;
    location /.well-known/acme-challenge/ { root /var/www/acme; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl; listen [::]:443 ssl;
    server_name vialabote.ru www.vialabote.ru shop.vialabote.ru;
    ssl_certificate $L/fullchain.pem;
    ssl_certificate_key $L/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:vl:10m;
    location / { include snippets/vialabote-edge-proxy.conf; }
}
EOF
  nginx -t 2>&1 | tail -1; systemctl reload nginx
  echo "EDGE_NGINX_TLS=OK"
  ;;
*) sed -n '2,20p' "$0"; exit 2;;
esac
