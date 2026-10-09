#!/usr/bin/env bash
# SITE_2 (vialabote-shop) — public HTTPS on shop.vialabote.ru.
#
#   0 gates: root, SITE_1 healthy (snapshot), SITE_2 healthy, DNS shop A =
#     103.76.54.182 at BOTH authoritative servers (ns1/ns2.reg.ru)
#   1 HTTP vhost /etc/nginx/sites-available/zz-shop.vialabote.ru (+ ACME webroot)
#   2 certificate: certbot certonly --webroot (certbot never edits nginx);
#     renewal deploy hook = reload nginx; SITE_1 cert untouched
#   3 HTTPS vhost (HTTP -> 301 HTTPS), nginx -t, reload
#   4 verification over TLS + renewal dry-run (this cert only)
#   5 SITE_1 post-check + diff (incl. default-443/no-SNI behaviour)
#
# SITE_1 safety:
# - its vhost/nginx.conf/cert/renewal conf are never written;
# - file name "zz-…" sorts AFTER sites-enabled/vialabote.ru, so SITE_1 stays
#   the implicit default server on :443 (no default_server here);
# - no http2 on the listen lines (in nginx 1.24 that would switch http2 on for
#   SITE_1's 443 as well); nginx is only RELOADED (master PID unchanged);
# - any nginx -t failure removes our vhost again and stops before reload.
#
# usage (as root):  bash site2-public-https.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
DOMAIN=shop.vialabote.ru
IP=103.76.54.182
UPSTREAM=127.0.0.1:3002
NAME=zz-shop.vialabote.ru
AVAIL=/etc/nginx/sites-available/$NAME
ENABLED=/etc/nginx/sites-enabled/$NAME
ACME_ROOT=/var/www/shop-acme
LIVE=/etc/letsencrypt/live/$DOMAIN
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-https-$STAMP

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
# SITE_1 extra checks: what :443 serves without SNI / for unknown names, and :80 default.
site1_extra() {
  echo "default443-nosni-cert $(echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject 2>/dev/null)"
  echo "default443-unknown-host $(curl -sk -o /dev/null -m 15 -w '%{http_code}' --resolve unknown.invalid:443:127.0.0.1 https://unknown.invalid/)"
  echo "default80-ip $(curl -s -o /dev/null -m 15 -w '%{http_code}' -H 'Host: 103.76.54.182' http://127.0.0.1/)"
  echo "nginx-master-pid $(systemctl show -p MainPID --value nginx)"
  echo "site1-renewal-conf $(sha256sum /etc/letsencrypt/renewal/vialabote.ru.conf | cut -c1-16)"
  echo "site1-cert $(sha256sum /etc/letsencrypt/live/vialabote.ru/cert.pem | cut -c1-16)"
}
snapshot() { bash "$HERE/site1-healthcheck.sh" | sed '/^-- info --$/,$d'; site1_extra; }
https() { curl -s -m 30 --resolve "$DOMAIN:443:127.0.0.1" "$@"; }
# `systemctl reload nginx` is asynchronous: it returns once the master got the
# signal, while old workers keep answering with the OLD config for a moment.
# Every check right after a reload therefore polls until the new config serves.
wait_for() {  # $1 = timeout seconds, rest = command that must succeed
  local t=$1; shift
  for _ in $(seq 1 $((t * 2))); do "$@" >/dev/null 2>&1 && return 0; sleep 0.5; done
  return 1
}
acme_probe() {  # $1 = token; succeeds when nginx serves the webroot file for $DOMAIN
  [ "$(curl -s -m 5 --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/.well-known/acme-challenge/$1")" = "$1" ]
}
https_ready() {  # the NEW config is live: shop cert served for SNI $DOMAIN AND http -> 301
  # (a bare 200 is not enough: old workers answer SNI $DOMAIN with SITE_1's
  # default 443 server, which also returns 200)
  curl -skv -o /dev/null -m 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" 2>&1 | grep -qiE "subject:.*CN ?= ?$DOMAIN" &&
  [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/")" = 301 ]
}
# Place a vhost; on nginx -t failure take OUR file out again and stop (no reload).
apply_vhost() {  # $1 = rendered file
  install -m 0644 -o root -g root "$1" "$AVAIL"
  ln -sfn "$AVAIL" "$ENABLED"
  if ! nginx -t 2>"$WORK/nginx-t.txt"; then
    cat "$WORK/nginx-t.txt" >&2
    rm -f "$ENABLED"; mv "$AVAIL" "$WORK/$NAME.rejected"
    nginx -t 2>/dev/null && echo "our vhost removed again; nginx config is back to the previous valid state" >&2
    die "nginx -t failed — nothing reloaded"
  fi
  systemctl reload nginx
}

[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash $0)"
VERIFY_ONLY=0; [ "${1:-}" = "--verify-only" ] && VERIFY_ONLY=1
mkdir -p "$WORK"; chmod 700 "$WORK"

step "0/5 gates (read-only)"
snapshot > "$WORK/site1-pre.txt"
grep -q "^http https://vialabote.ru/ 200$" "$WORK/site1-pre.txt" || die "SITE_1 not healthy — nothing changed"
nginx -t 2>/dev/null || die "nginx -t fails BEFORE any change — not touching nginx"
systemctl is-active --quiet vialabote-shop.service || die "SITE_2 service not active"
[ "$(curl -s -o /dev/null -m 20 -w '%{http_code}' "http://$UPSTREAM/")" = 200 ] || die "SITE_2 $UPSTREAM not 200"
for ns in ns1.reg.ru ns2.reg.ru; do
  got=$(dig +short +time=5 +tries=2 @"$ns" "$DOMAIN" A | tr '\n' ' ')
  echo "DNS $ns: $DOMAIN A = ${got:-NXDOMAIN}"
  [ "$got" = "$IP " ] || die "DNS not ready at $ns (expected exactly $IP) — create the A record in REG.RU first; nothing changed"
done
echo "public resolvers (info): 77.88.8.8=[$(dig +short +time=3 @77.88.8.8 "$DOMAIN" A | tr '\n' ' ')] 8.8.8.8=[$(dig +short +time=3 @8.8.8.8 "$DOMAIN" A | tr '\n' ' ')]"
for f in "$AVAIL" "$ENABLED"; do [ -e "$f" ] && [ ! -e "$LIVE/fullchain.pem" ] && echo "re-run: $f exists, will be replaced"; done
grep -rlq --exclude="$NAME" "$DOMAIN" /etc/nginx/sites-enabled/ 2>/dev/null && die "$DOMAIN already configured in another nginx file"
echo "ok"

if [ "$VERIFY_ONLY" = 1 ]; then
  echo "--verify-only: skipping steps 1-3 (no nginx change, no reload, no certificate issuance)"
  [ -s "$LIVE/fullchain.pem" ] || die "--verify-only: certificate $LIVE missing"
  { [ -L "$ENABLED" ] && grep -q "listen 443 ssl" "$AVAIL"; } || die "--verify-only: HTTPS vhost $AVAIL not enabled"
  wait_for 30 https_ready || die "--verify-only: live config does not serve the shop certificate + redirect"
else
step "1/5 HTTP vhost + ACME webroot"
install -d -m 0755 "$ACME_ROOT/.well-known/acme-challenge"
proxy_block() { cat <<EOF
    location / {
        proxy_pass http://$UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$http_connection;
        proxy_read_timeout 60s;
    }
EOF
}
cat > "$WORK/http.conf" <<EOF
# SITE_2 vialabote-shop — managed by ops/vps/site2-public-https.sh (not certbot)
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 12m;
    location ^~ /.well-known/acme-challenge/ { root $ACME_ROOT; default_type text/plain; }
$(proxy_block)
}
EOF
if [ ! -s "$LIVE/fullchain.pem" ]; then
  apply_vhost "$WORK/http.conf"
  echo "probe-$STAMP" > "$ACME_ROOT/.well-known/acme-challenge/probe-$STAMP"
  if wait_for 30 acme_probe "probe-$STAMP"; then PROBE_OK=1; else PROBE_OK=0; fi
  rm -f "$ACME_ROOT/.well-known/acme-challenge/probe-$STAMP"
  [ "$PROBE_OK" = 1 ] || die "ACME webroot not served for $DOMAIN within 30 s after reload (rollback: site2-public-https-rollback.sh)"
  echo "ok: http://$DOMAIN -> app $(curl -s -o /dev/null -m 20 -w '%{http_code}' --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/"), ACME webroot served"
else
  echo "certificate already present — skipping HTTP-only phase"
fi

step "2/5 certificate for $DOMAIN only (webroot; SITE_1 cert untouched)"
if [ ! -s "$LIVE/fullchain.pem" ]; then
  certbot certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" --cert-name "$DOMAIN" \
    --non-interactive --agree-tos --keep-until-expiring \
    --deploy-hook "systemctl reload nginx" > "$WORK/certbot.txt" 2>&1 || true
  grep -vE "^\s*$" "$WORK/certbot.txt" | sed 's/^/   /'
fi
[ -s "$LIVE/fullchain.pem" ] || die "certificate was not issued (HTTP vhost stays; rollback: site2-public-https-rollback.sh)"
echo "cert: $(openssl x509 -in "$LIVE/cert.pem" -noout -subject -enddate | tr '\n' ' ')"

step "3/5 HTTPS vhost (HTTP -> HTTPS)"
cat > "$WORK/https.conf" <<EOF
# SITE_2 vialabote-shop — managed by ops/vps/site2-public-https.sh (not certbot)
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ { root $ACME_ROOT; default_type text/plain; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN;
    ssl_certificate $LIVE/fullchain.pem;
    ssl_certificate_key $LIVE/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 12m;
$(proxy_block)
}
EOF
apply_vhost "$WORK/https.conf"
wait_for 30 https_ready || die "HTTPS for $DOMAIN not live within 30 s after reload (rollback: site2-public-https-rollback.sh)"
echo "ok: $AVAIL enabled"

fi  # end of steps 1-3 (skipped with --verify-only)

step "4/5 verification over TLS"
R=$(curl -s -o /dev/null -m 15 -w '%{http_code} %{redirect_url}' --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/catalog?x=1")
echo "http redirect: $R"; [ "$R" = "301 https://$DOMAIN/catalog?x=1" ] && REDIR=PASS || REDIR=FAIL
CERT=$(echo | openssl s_client -servername "$DOMAIN" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -enddate -ext subjectAltName 2>/dev/null | tr '\n' ' ')
echo "served cert: $CERT"; [[ "$CERT" == *"DNS:$DOMAIN"* ]] && TLS=PASS || TLS=FAIL
VERIFY=$(curl -s -o /dev/null -m 15 -w '%{ssl_verify_result}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/")
[ "$VERIFY" = 0 ] || TLS=FAIL; echo "chain verify result: $VERIFY"
HOME_C=$(https -o /dev/null -w '%{http_code}' "https://$DOMAIN/")
CAT_HTML=$(https "https://$DOMAIN/catalog"); CAT_C=$(https -o /dev/null -w '%{http_code}' "https://$DOMAIN/catalog")
CARDS=$(echo "$CAT_HTML" | grep -oE 'href="/product/[a-z0-9-]+"' | sort -u | wc -l)
TONICS=$(https "https://$DOMAIN/catalog?category=toniki" | grep -oE 'href="/product/[a-z0-9-]+"' | sort -u | wc -l)
PDP_C=$(https -o /dev/null -w '%{http_code}' "https://$DOMAIN/product/toner-serum-ph55")
ASSET=$(echo "$CAT_HTML" | grep -oE '/_next/static/[^"]+\.(js|css)' | head -1)
ASSET_C=$(https -o /dev/null -w '%{http_code}' "https://$DOMAIN$ASSET")
IMG_C=$(https -o /dev/null -w '%{http_code} %{content_type}' "https://$DOMAIN/images/products/packshot/toner-serum-ph55.webp")
MIXED=$( { https "https://$DOMAIN/"; echo "$CAT_HTML"; } | grep -oE '(src|href|action)="http://[^"]+' | grep -v "http://www.w3.org" | sort -u | head -5)
echo "home=$HOME_C catalog=$CAT_C cards=$CARDS toniki=$TONICS pdp=$PDP_C asset[$ASSET]=$ASSET_C image=$IMG_C mixed-content=[${MIXED:-none}]"
echo "proxy headers in vhost: $(grep -cE 'proxy_set_header (Host|X-Real-IP|X-Forwarded-For|X-Forwarded-Proto) ' "$AVAIL")/2x4 (http+https blocks share the same proxy block)"
ss -ltnH 'sport = :3002' | awk '{print "app bind:", $4}'
step "renewal (dry-run, this certificate only)"
certbot renew --dry-run --cert-name "$DOMAIN" --no-random-sleep-on-renew > "$WORK/renew-dry-run.txt" 2>&1 && RENEW=PASS || RENEW=FAIL
grep -E "Congratulations|simulat|fail|error" "$WORK/renew-dry-run.txt" | sed 's/^/   /' || true
RENEW_CONF=/etc/letsencrypt/renewal/$DOMAIN.conf
echo "renewal conf: $(grep -E '^(authenticator|renew_hook|deploy_hook)' "$RENEW_CONF" 2>/dev/null | tr '\n' ' '); certbot.timer=$(systemctl is-enabled certbot.timer)"

step "5/5 SITE_1 post-check"
snapshot > "$WORK/site1-post.txt"
# Baseline = oldest pre-snapshot of any run of this script (taken before the
# first nginx change), so a re-run is still compared with the original state.
BASE=$(ls -1dt /root/vialabote-shop-https-*/site1-pre.txt 2>/dev/null | tail -1 || true)
[ -n "$BASE" ] || BASE="$WORK/site1-pre.txt"
echo "SITE_1 baseline: $BASE"
diff "$BASE" "$WORK/site1-post.txt" && SITE1=UNCHANGED || SITE1=CHANGED
same() { diff <(grep -E "^($1)" "$BASE") <(grep -E "^($1)" "$WORK/site1-post.txt") >/dev/null && echo UNCHANGED || echo CHANGED; }

ok=PASS
for v in "$REDIR" "$TLS" "$RENEW"; do [ "$v" = PASS ] || ok=FAIL; done
[ "$HOME_C" = 200 ] && [ "$CAT_C" = 200 ] && [ "$CARDS" = 13 ] && [ "$TONICS" = 2 ] && [ "$PDP_C" = 200 ] && [ "$ASSET_C" = 200 ] || ok=FAIL
[[ "$IMG_C" == "200 image/webp"* ]] || ok=FAIL
[ -z "$MIXED" ] || ok=FAIL
[ "$SITE1" = UNCHANGED ] || ok=FAIL
echo
echo "SITE_2_PUBLIC_HTTPS=$ok (server-side; confirm from the internet with live QA)"
echo "DOMAIN=$DOMAIN"
echo "DNS=ns1+ns2.reg.ru -> $IP"
echo "NGINX=$AVAIL (enabled)"
echo "UPSTREAM=$UPSTREAM"
echo "NGINX_TEST=PASS"
echo "TLS=$TLS"
echo "CERTIFICATE=$(openssl x509 -in "$LIVE/cert.pem" -noout -issuer -enddate | tr '\n' ' ')"
echo "AUTO_RENEWAL=$RENEW (certbot.timer $(systemctl is-enabled certbot.timer); webroot; deploy-hook reload nginx)"
echo "HTTP_REDIRECT=$REDIR"
echo "HTTPS_HOME=$HOME_C"
echo "CATALOG=$CAT_C"
echo "PRODUCT_CARDS=$CARDS"
echo "TONICS=$TONICS"
echo "PDP=$PDP_C"
echo "STATIC_ASSETS=$ASSET_C"
echo "IMAGES=$IMG_C"
echo "MIXED_CONTENT=${MIXED:-none}"
echo "SITE_1_HTTP=$(same 'http http://')"
echo "SITE_1_HTTPS=$(same 'http https://|cert |default443')"
echo "SITE_1_NGINX_CONFIG=$(same 'sha256 /etc/nginx|symlink|default80')"
echo "SITE_1_SERVICE=$(same 'unit |unit-enabled|timer ')"
echo "SITE_1_PORT=$(same 'listen ')"
echo "SITE_1_DB=$(same 'unit postgresql@16-main|sha256 /etc/postgresql/16/main|pg-clusters')"
echo "SITE_1_CERT=$(same 'site1-cert|site1-renewal-conf')"
echo "SITE_1=$SITE1"
echo "EVIDENCE=$WORK"
[ "$SITE1" = UNCHANGED ] || { echo "SITE_1 CHANGED — STOP. Rollback: site2-public-https-rollback.sh --yes" >&2; exit 2; }
