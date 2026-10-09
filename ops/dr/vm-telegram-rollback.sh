#!/usr/bin/env bash
# Vialabote ZeroHour PRIMARY — undo vm-telegram-activate.sh. Runs INSIDE vialabote-dr as root.
#   deleteWebhook (token from app.env, curl stdin config) -> remove the nginx secret map ->
#   vm-limited-mode.sh (webhook back to 503, self-smoke) -> drop TELEGRAM_* from app.env ->
#   restart SITE_2 (route back to 404). The release and the ADMIN user are kept.
# usage: bash vm-telegram-rollback.sh   (vm-limited-mode.sh next to this script)
set -euo pipefail
set +x
export LC_ALL=C PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_ENV=/etc/vialabote-shop/app.env
TG_MAP=/etc/nginx/vialabote-telegram-secret.map
WORK=/root/vialabote-telegram-rollback-$(date -u +%Y%m%dT%H%M%SZ)
die() { echo "ABORT: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root"
[ "$(hostname)" = vialabote-dr ] || die "not the vialabote-dr VM"
[ -f "$HERE/vm-limited-mode.sh" ] || die "vm-limited-mode.sh missing next to this script"
umask 077; mkdir -p "$WORK"

TOKEN=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$APP_ENV")
if [ -n "$TOKEN" ]; then
  R=$(printf 'url = "https://api.telegram.org/bot%s/deleteWebhook"\nsilent\nmax-time = 20\n' "$TOKEN" | curl -K -) || R=""
  case "$R" in *'"ok":true'*) DEL=OK ;; *) DEL="FAILED (retry, or deleteWebhook manually)" ;; esac
else
  DEL="SKIPPED (no token in app.env)"
fi
unset TOKEN R

rm -f "$TG_MAP"
bash "$HERE/vm-limited-mode.sh" > "$WORK/limited-mode.txt" 2>&1 && LM=PASS || LM=FAIL
cp -p "$APP_ENV" "$WORK/app.env.before"
grep -vE '^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|TELEGRAM_CMS_MUTATIONS)=' "$APP_ENV" > "$APP_ENV.tmp"
chown root:root "$APP_ENV.tmp"; chmod 600 "$APP_ENV.tmp"; mv "$APP_ENV.tmp" "$APP_ENV"
systemctl restart vialabote-shop.service
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:3002/)" = 200 ] && break; sleep 1; done
ROUTE=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST --data '{}' http://127.0.0.1:3002/api/telegram/webhook)
echo "DELETE_WEBHOOK=$DEL"
echo "LIMITED_MODE_SMOKE=$LM (webhook exception removed)"
echo "WEBHOOK_ROUTE=$ROUTE (expected 404)"
echo "EVIDENCE=$WORK (app.env.before holds the token — 0600, delete when no longer needed)"
[ "$LM$ROUTE" = PASS404 ]
