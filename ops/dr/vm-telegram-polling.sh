#!/usr/bin/env bash
# Vialabote ZeroHour PRIMARY — switch the SITE_2 Telegram CMS from webhook to long polling.
# Runs INSIDE vialabote-dr as root (interactive for the live check). RCA 2026-10-09: the public
# edge 88.218.61.30 and Telegram cannot reach each other; this VM reaches api.telegram.org.
#
#   enable <sha7>
#     0 gates + snapshot (SITE_1, WireGuard, UFW, vhosts, db.env); token+secret already in app.env
#     1 release <sha7> (contains scripts/telegram-poller.mjs); deploy + restart SITE_2 if needed
#     2 outbound HTTPS VM -> api.telegram.org (getMe) and preflight --check as vialabote-shop
#     3 install vialabote-telegram-poller.service (not started yet), systemd-analyze verify
#     4 deleteWebhook WITHOUT drop_pending_updates -> getWebhookInfo url empty, pending kept
#     5 start the service; exactly one poller process; no 409 conflict in its journal
#     6 owner sends a read-only command -> journal shows update from the ADMIN id, auth=ok, sent=true
#     7 secrets not in journal; SITE_1/WireGuard/UFW/vhosts/db.env unchanged; limited mode on
#   rollback
#     stop + disable + remove the unit -> setWebhook back to https://shop.vialabote.ru/api/telegram/webhook
#     with the same secret (pending updates kept) -> getWebhookInfo
#
# Not touched: SITE_1, DNS, VDSina edge, WireGuard, PostgreSQL schema/data, catalog, checkout,
# limited mode, bot token, webhook secret. Token/secret go to curl only via stdin configs.
#
# usage: bash vm-telegram-polling.sh enable <sha7>    |    bash vm-telegram-polling.sh rollback
set -euo pipefail
set +x
export LC_ALL=C PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
MODE=${1:?usage: vm-telegram-polling.sh enable <sha7> | rollback}
HERE="$(cd "$(dirname "$0")" && pwd)"
OPT=/opt/vialabote-shop
NODE=$OPT/node-v24.21.0/bin/node
APP_ENV=/etc/vialabote-shop/app.env
UNIT=vialabote-telegram-poller.service
UNIT_FILE=/etc/systemd/system/$UNIT
IN=/srv/dr-inbox/releases
PORT=8082
DOMAIN=shop.vialabote.ru
HOOK_URL=https://$DOMAIN/api/telegram/webhook
WORK=/root/vialabote-telegram-polling-$MODE-$(date -u +%Y%m%dT%H%M%SZ)

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
kv() { sed -n "s/^$1=//p" "$2" | head -1; }
tg() {  # Bot API call; token only in curl's stdin config
  local method=$1; shift
  { printf 'url = "https://api.telegram.org/bot%s/%s"\nsilent\nmax-time = 20\n' "$TOKEN" "$method"
    for l in "$@"; do printf '%s\n' "$l"; done; } | curl -K -
}
jget() { "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{v=undefined}for(const k of process.argv[1].split("."))v=v?.[k];console.log(v===undefined||v===null?"":typeof v==="object"?JSON.stringify(v):String(v))})' "$1"; }
# node processes only (flock's own argv also contains the script path)
pollers() { pgrep -fc "^$NODE [^ ]*scripts/telegram-poller\\.mjs" || true; }
snap() {
  for u in vialabote-site wg-quick@wg0; do echo "unit $u $(systemctl show -p ActiveState --value $u) pid=$(systemctl show -p MainPID --value $u) restarts=$(systemctl show -p NRestarts --value $u)"; done
  echo "site1 current -> $(readlink /opt/vialabote/current)"
  for f in /etc/wireguard/* /etc/vialabote/* /etc/vialabote-shop/db.env /etc/nginx/conf.d/vialabote-limited-map.conf \
           /etc/nginx/sites-available/vialabote-dr-limited /etc/nginx/nginx.conf; do
    [ -f "$f" ] && echo "sha256 $f $(sha256sum "$f" | cut -c1-16)"
  done
  echo "ufw $(ufw status verbose 2>/dev/null | sha256sum | cut -c1-16)"
  for pth in / /products; do echo "site1 GET $pth $(curl -s -o /dev/null -m 15 -w '%{http_code}' --resolve vialabote.ru:$PORT:127.0.0.1 http://vialabote.ru:$PORT$pth)"; done
  echo "site2 POST /api/orders $(curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST --data '{}' --resolve $DOMAIN:$PORT:127.0.0.1 http://$DOMAIN:$PORT/api/orders)"
}

[ "$(id -u)" -eq 0 ] || die "run as root"
[ "$(hostname)" = vialabote-dr ] || die "not the vialabote-dr VM"
umask 077; mkdir -p "$WORK"; chmod 700 "$WORK"
TOKEN=$(kv TELEGRAM_BOT_TOKEN "$APP_ENV"); SECRET=$(kv TELEGRAM_WEBHOOK_SECRET "$APP_ENV")
[ -n "$TOKEN" ] && [ -n "$SECRET" ] || die "TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET not in $APP_ENV (run vm-telegram-activate.sh first)"

if [ "$MODE" = rollback ]; then
  step "rollback: polling -> webhook"
  systemctl disable --now "$UNIT" 2>/dev/null || true
  rm -f "$UNIT_FILE"; systemctl daemon-reload
  [ "$(pollers)" = 0 ] || die "a poller process is still running"
  SET=$(tg setWebhook "data-urlencode = \"url=$HOOK_URL\"" "data-urlencode = \"secret_token=$SECRET\"" \
    'data-urlencode = "allowed_updates=[\"message\",\"callback_query\"]"')
  [ "$(jget ok <<<"$SET")" = true ] || die "setWebhook failed: $(jget description <<<"$SET")"
  INFO=$(tg getWebhookInfo)
  unset TOKEN SECRET
  echo "POLLING_SERVICE=REMOVED"
  echo "WEBHOOK=$(jget result.url <<<"$INFO") pending=$(jget result.pending_update_count <<<"$INFO")"
  exit 0
fi

[ "$MODE" = enable ] || die "unknown mode $MODE"
S7=${2:?usage: vm-telegram-polling.sh enable <sha7>}
[ -t 0 ] || die "needs an interactive terminal (ssh -t) for the live check"

step "0/7 gates + snapshot (read-only)"
[ -L /etc/nginx/sites-enabled/vialabote-dr-limited ] || die "limited mode vhost not enabled"
systemctl is-active --quiet vialabote-shop.service || die "SITE_2 not active"
[ "$(pollers)" = 0 ] || die "a telegram poller is already running — refusing to start a second one"
snap > "$WORK/snap-pre.txt"
grep -q "^site1 GET / 200$" "$WORK/snap-pre.txt" || die "SITE_1 not healthy — nothing changed"

step "1/7 release $S7"
if [ "$(readlink $OPT/current)" != "releases/$S7" ]; then
  BUNDLE=app-$S7.tar.gz
  [ -f "$IN/READY" ] && [ -f "$IN/$BUNDLE" ] || die "$BUNDLE not delivered to $IN"
  [ -f "$HERE/vm-deploy-release.sh" ] || die "vm-deploy-release.sh missing next to this script"
  a=$(tar -xzOf "$IN/$BUNDLE" ./ops/dr/vm-telegram-polling.sh | sha256sum | cut -c1-64); b=$(sha256sum "$0" | cut -c1-64)
  [ "$a" = "$b" ] || die "this script differs from the copy in $BUNDLE"
  bash "$HERE/vm-deploy-release.sh" site2 "$BUNDLE" | tee "$WORK/deploy.txt"
  systemctl restart vialabote-shop.service
  for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:3002/)" = 200 ] && break; sleep 1; done
fi
[ "$(cut -c1-7 $OPT/current/.release-commit)" = "$S7" ] || die "release commit mismatch"
[ -f "$OPT/current/scripts/telegram-poller.mjs" ] || die "release has no scripts/telegram-poller.mjs"
echo "ok: $(readlink $OPT/current) commit $(cat $OPT/current/.release-commit)"

step "2/7 outbound HTTPS VM -> api.telegram.org + preflight as vialabote-shop"
ME=$(tg getMe) || die "api.telegram.org unreachable from the VM — nothing changed in Telegram"
[ "$(jget ok <<<"$ME")" = true ] || die "getMe failed"
BOT=$(jget result.username <<<"$ME")
INFO0=$(tg getWebhookInfo)
echo "getMe ok @$BOT; before: webhook=$(jget result.url <<<"$INFO0") pending=$(jget result.pending_update_count <<<"$INFO0") last_error='$(jget result.last_error_message <<<"$INFO0")'"
# --check: getMe + getWebhookInfo + app route with the secret, exactly as the service will run
systemd-run --quiet --wait --pipe --collect -p User=vialabote-shop -p EnvironmentFile="$APP_ENV" \
  "$NODE" "$OPT/current/scripts/telegram-poller.mjs" --check | tee "$WORK/check.txt"
grep -q 'app_route=200' "$WORK/check.txt" || die "preflight failed — nothing changed in Telegram"

step "3/7 install $UNIT (not started)"
cat > "$UNIT_FILE.tmp" <<EOF
[Unit]
Description=Vialabote SITE_2 Telegram long polling (bridge to the local webhook route)
After=network-online.target vialabote-shop.service
Wants=network-online.target

[Service]
User=vialabote-shop
Group=vialabote-shop
EnvironmentFile=$APP_ENV
WorkingDirectory=$OPT/current
# flock: a second copy started by hand with the same command cannot run in parallel
ExecStart=/usr/bin/flock -n /run/vialabote-telegram-poller/lock $NODE $OPT/current/scripts/telegram-poller.mjs
RuntimeDirectory=vialabote-telegram-poller
# last handled update_id survives restarts (dedup); writable despite ProtectSystem=strict
StateDirectory=vialabote-telegram-poller
Restart=always
RestartSec=30
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
chmod 644 "$UNIT_FILE.tmp"; mv "$UNIT_FILE.tmp" "$UNIT_FILE"
systemd-analyze verify "$UNIT_FILE" 2>&1 | grep -v '^$' || true
systemctl daemon-reload

step "4/7 deleteWebhook (pending updates kept)"
DEL=$(tg deleteWebhook 'data-urlencode = "drop_pending_updates=false"')
[ "$(jget ok <<<"$DEL")" = true ] || die "deleteWebhook failed: $(jget description <<<"$DEL") — rollback: bash $0 rollback"
INFO1=$(tg getWebhookInfo)
echo "after: webhook='$(jget result.url <<<"$INFO1")' pending=$(jget result.pending_update_count <<<"$INFO1")"
[ -z "$(jget result.url <<<"$INFO1")" ] || die "webhook still set"

step "5/7 start polling"
J0=$(date '+%Y-%m-%d %H:%M:%S')
systemctl enable --now "$UNIT"
sleep 8
systemctl is-active --quiet "$UNIT" || { journalctl -u "$UNIT" --since "$J0" --no-pager -o cat | tail -20; die "service not active — rollback: bash $0 rollback"; }
N=$(pollers); echo "poller processes: $N"
journalctl -u "$UNIT" --since "$J0" --no-pager -o cat | tail -5
journalctl -u "$UNIT" --since "$J0" --no-pager -o cat | grep -q CONFLICT && die "409 conflict — another consumer? rollback: bash $0 rollback"
[ "$N" = 1 ] && SINGLE=YES || SINGLE=NO

step "6/7 live check from Telegram"
ADMIN_TG=$(env -i PATH="$PATH" HOME="$OPT/shared" APP_DIR="$OPT/current" DATABASE_URL="$(kv DATABASE_URL /etc/vialabote-shop/db.env)" \
  /usr/sbin/runuser -u vialabote-shop -- "$NODE" -e '
    const r = require("node:module").createRequire(process.env.APP_DIR + "/package.json");
    const p = new (r("@prisma/client").PrismaClient)();
    p.user.findMany({ where: { role: "ADMIN", telegramUserId: { not: null } }, select: { telegramUserId: true } })
      .then((a) => console.log(a.map((x) => x.telegramUserId).join(" "))).finally(() => p.$disconnect());' </dev/null)
J1=$(date '+%Y-%m-%d %H:%M:%S')
echo "From the linked Telegram account send to @$BOT:   показать товары без INCI"
read -r -p "Press Enter after the bot has replied (or after ~1 minute): " _
LOG=$(journalctl -u "$UNIT" --since "$J1" --no-pager -o cat)
printf '%s\n' "$LOG" | grep '^update ' | tee "$WORK/live.txt" || true
LIVE=NO; ADMIN_AUTH=FAIL
for id in $ADMIN_TG; do
  grep -qE "^update [0-9]+ message from=$id app=200 method=sendMessage sent=true auth=ok" "$WORK/live.txt" && { LIVE=YES; ADMIN_AUTH=PASS; }
done
read -r -p "Did the bot answer in Telegram with the product list? [y/N]: " SAW
[ "$SAW" = y ] || LIVE=NO
INFO2=$(tg getWebhookInfo)

step "7/7 security + no-impact"
LEAK=NO
for v in "$TOKEN" "$SECRET"; do
  { journalctl -u "$UNIT" -u vialabote-shop --since "$J0" --no-pager -o cat 2>&1; cat "$WORK"/*.txt 2>/dev/null; } | grep -qF "$v" && LEAK=YES
done
unset v TOKEN SECRET
snap > "$WORK/snap-post.txt"
diff "$WORK/snap-pre.txt" "$WORK/snap-post.txt" && IMPACT=NONE || IMPACT=CHANGED
curl -s -I -m 10 --resolve "$DOMAIN:$PORT:127.0.0.1" "http://$DOMAIN:$PORT/" | grep -qi '^x-vialabote-mode: LIMITED_RECOVERY' && LIMITED=ACTIVE || LIMITED=OFF

echo
echo "POLLING_SERVICE=$(systemctl is-active $UNIT) ($UNIT, enabled=$(systemctl is-enabled $UNIT), single_instance=$SINGLE)"
echo "WEBHOOK_REMOVED=$([ -z "$(jget result.url <<<"$INFO2")" ] && echo YES || echo NO) (pending kept: before=$(jget result.pending_update_count <<<"$INFO0"))"
echo "GETUPDATES=$([ "$(printf '%s\n' "$LOG" | grep -c CONFLICT || true)" = 0 ] && echo OK || echo CONFLICT) ($(grep -c '^update ' "$WORK/live.txt" || true) updates handled during the live check)"
echo "BOT_RESPONSE=$LIVE"
echo "ADMIN_AUTH=$ADMIN_AUTH (by Telegram user id)"
echo "SECRETS_IN_LOGS=$LEAK"
echo "LIMITED_MODE=$LIMITED"
echo "SITE_1_IMPACT=$IMPACT"
echo "ROLLBACK=bash $0 rollback"
echo "EVIDENCE=$WORK"
[ "$LIVE$ADMIN_AUTH$LEAK$IMPACT$SINGLE" = YESPASSNONONEYES ]
