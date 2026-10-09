#!/usr/bin/env bash
# Vialabote DR — LIMITED_RECOVERY_MODE routing for both sites. Runs INSIDE vialabote-dr as root.
# Idempotent. Used when no verified PROD backup exists: the storefronts are served read-only
# from the git-built releases, and every write path is closed at nginx before it reaches an app.
#
#   - any method other than GET/HEAD                     -> 503 notice (never proxied)
#   - SITE_1 /checkout /custom-product /internal          -> 503 notice
#   - SITE_2 /checkout /account /admin                    -> 503 notice
#   - every HTML page gets a CSS-only banner (no DOM node, so no hydration change)
#   - header X-Vialabote-Mode: LIMITED_RECOVERY on every response
#   - the DR test upload is moved out of the public uploads dir
# Listener: *:8082; UFW admits it only on wg0 from the edge (10.77.0.1) — see vm-edge-tunnel.sh.
# Ends with a local self-smoke; exit != 0 if any check fails.
set -euo pipefail
export LC_ALL=C
[ "$(hostname)" = vialabote-dr ] || { echo "ABORT: not the DR VM" >&2; exit 1; }
PORT=8082
NOTICE_DIR=/var/www/vialabote-dr

install -d -m 0755 "$NOTICE_DIR/__dr"
cat > "$NOTICE_DIR/__dr/limited.html" <<'EOF'
<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Оформление заказов временно недоступно</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#faf7f5;color:#222}main{max-width:560px;margin:12vh auto;padding:0 16px}h1{font-size:22px}a{color:#7a1f1f}</style></head>
<body><main><h1>Оформление заказов временно недоступно</h1>
<p>Сайт работает в резервном режиме из-за технической аварии у хостинг-провайдера. Каталог доступен для просмотра, но оформление заказов, регистрация и отправка форм временно отключены.</p>
<p>Пожалуйста, вернитесь позже. Приносим извинения за неудобства.</p>
<p><a href="/">На главную</a></p></main></body></html>
EOF
chmod 0644 "$NOTICE_DIR/__dr/limited.html"

cat > /etc/nginx/conf.d/vialabote-limited-map.conf <<'EOF'
map $request_method $vialabote_write { default 1; GET 0; HEAD 0; }
# scheme as seen by the client (edge sets X-Forwarded-Proto https)
map $http_x_forwarded_proto $vialabote_proto { default $http_x_forwarded_proto; "" $scheme; }
EOF

cat > /etc/nginx/snippets/vialabote-limited.conf <<'EOF'
# LIMITED_RECOVERY_MODE (shared by both sites)
add_header X-Vialabote-Mode LIMITED_RECOVERY always;
add_header Cache-Control "no-store" always;
error_page 503 /__dr/limited.html;
location = /__dr/limited.html { internal; root /var/www/vialabote-dr; add_header X-Vialabote-Mode LIMITED_RECOVERY always; add_header Retry-After 3600 always; }
if ($vialabote_write) { return 503; }
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $vialabote_proto;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header Accept-Encoding "";
sub_filter_once on;
sub_filter '</head>' '<style id="dr-limited">body::before{content:"Сайт работает в резервном режиме: оформление заказов временно недоступно.";display:block;position:sticky;top:0;z-index:2147483647;background:#7a1f1f;color:#fff;font:600 14px/1.4 system-ui,sans-serif;text-align:center;padding:10px 16px}</style></head>';
EOF

cat > /etc/nginx/sites-available/vialabote-dr-limited <<EOF
# LIMITED_RECOVERY_MODE storefronts (local listener; public ingress forwards here once approved)
server {
    listen $PORT;
    server_name vialabote.ru www.vialabote.ru;
    include snippets/vialabote-limited.conf;
    location ~ ^/(checkout|custom-product|internal)(/|\$) { return 503; }
    location / { proxy_pass http://127.0.0.1:3001; }
}
server {
    listen $PORT;
    server_name shop.vialabote.ru;
    include snippets/vialabote-limited.conf;
    location ~ ^/(checkout|account|admin)(/|\$) { return 503; }
    location / { proxy_pass http://127.0.0.1:3002; }
}
EOF
ln -sfn /etc/nginx/sites-available/vialabote-dr-limited /etc/nginx/sites-enabled/vialabote-dr-limited

# test-only upload must never be public
Q=/var/lib/vialabote-dr/quarantine; install -d -m 0700 "$Q"
T=/opt/vialabote-shop/shared/uploads/media/dr-test-file.txt
[ -f "$T" ] && mv "$T" "$Q/dr-test-file.txt.$(date -u +%Y%m%dT%H%M%SZ)"

nginx -t 2>&1 | tail -1
# a reload cannot widen an existing 127.0.0.1:$PORT socket to *:$PORT (EADDRINUSE, the old
# config silently stays active) — restart when the wildcard listener is not there yet
if ss -ltnH "( sport = :$PORT )" | awk '{print $4}' | grep -qx "0.0.0.0:$PORT"; then systemctl reload nginx; else systemctl restart nginx; fi
for _ in $(seq 1 20); do curl -s -o /dev/null -m 3 "http://127.0.0.1:$PORT/" && break; sleep 0.5; done

# ---- self-smoke ----
FAIL=0
c() {  # expect method host path -> checks status code
  local exp=$1 m=$2 h=$3 p=$4 got
  got=$(curl -s -o /dev/null -m 20 -w '%{http_code}' -X "$m" ${5:+-H "$5"} ${6:+--data "$6"} --resolve "$h:$PORT:127.0.0.1" "http://$h:$PORT$p")
  if [ "$got" = "$exp" ]; then echo "PASS $m $h$p -> $got"; else echo "FAIL $m $h$p -> $got (want $exp)"; FAIL=1; fi
}
body() { curl -s -m 20 --resolve "$1:$PORT:127.0.0.1" "http://$1:$PORT$2"; }
has() {  # label haystack needle  (here-string: a pipe into grep -q dies of SIGPIPE under pipefail)
  if grep -qF -- "$3" <<<"$2"; then echo "PASS $1"; else echo "FAIL $1"; FAIL=1; fi
}
S1=vialabote.ru; S2=shop.vialabote.ru
c 200 GET $S1 /;           c 200 GET $S1 /products;   c 200 GET $S1 /about
c 200 GET $S2 /;           c 200 GET $S2 /catalog;    c 200 GET $S2 /product/toner-serum-ph55
c 503 POST $S1 /api/order "Content-Type: application/json" '{}'
c 503 POST $S1 /api/contact "Content-Type: application/json" '{}'
c 503 POST $S1 /api/custom-product-requests "Content-Type: application/json" '{}'
c 503 POST $S1 /api/derma-upload
c 503 POST $S2 /api/orders "Content-Type: application/json" '{}'
c 503 POST $S2 /api/auth/register "Content-Type: application/json" '{}'
c 503 POST $S2 /api/auth/callback/credentials
c 503 POST $S2 /api/payment/webhook
c 503 POST $S2 /api/telegram/webhook
c 503 PUT $S2 /api/admin/products
c 503 DELETE $S2 /api/admin/media/x
c 503 GET $S1 /checkout;   c 503 GET $S1 /custom-product; c 503 GET $S1 /internal/orders
c 503 GET $S2 /checkout;   c 503 GET $S2 /account/register; c 503 GET $S2 /account/login; c 503 GET $S2 /admin/orders
TU=$(curl -s -m 10 -w '\n%{http_code}' --resolve "$S2:$PORT:127.0.0.1" "http://$S2:$PORT/uploads/media/dr-test-file.txt")
if [ "$(tail -n1 <<<"$TU")" != 200 ] && ! grep -qi 'dr test' <<<"$TU"; then echo "PASS test upload not served ($(tail -n1 <<<"$TU"))"; else echo "FAIL test upload served"; FAIL=1; fi
H1=$(body $S1 /); H2=$(body $S2 /); C2=$(body $S2 /catalog)
has "SITE_1 banner" "$H1" 'id="dr-limited"'
has "SITE_2 banner" "$H2" 'id="dr-limited"'
has "notice page text" "$(body $S2 /checkout)" 'Оформление заказов временно недоступно'
has "mode header" "$(curl -s -I -m 10 --resolve $S2:$PORT:127.0.0.1 http://$S2:$PORT/)" 'X-Vialabote-Mode: LIMITED_RECOVERY'
A=$(printf '%s' "$H2" | grep -oE '/_next/static/[^"]+\.js' | head -1); c 200 GET $S2 "$A"
A1=$(printf '%s' "$H1" | grep -oE '/_next/static/[^"]+\.js' | head -1); c 200 GET $S1 "$A1"
N=$(printf '%s' "$C2" | grep -oE 'href="/product/[a-z0-9-]+"' | sort -u | wc -l)
if [ "$N" = 13 ]; then echo "PASS SITE_2 catalog 13 products"; else echo "FAIL SITE_2 catalog products=$N"; FAIL=1; fi
echo "app direct: SITE_1 $(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:3001/) SITE_2 $(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:3002/)"
if [ "$FAIL" = 0 ]; then echo "LIMITED_MODE_SMOKE=PASS"; else echo "LIMITED_MODE_SMOKE=FAIL"; exit 1; fi
