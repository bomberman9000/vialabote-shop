#!/usr/bin/env bash
# SITE_2 (vialabote-shop) — disconnect the Telegram CMS (undo site2-telegram-connect.sh).
#
#   deleteWebhook (token from app.env, via curl stdin config) -> remove
#   TELEGRAM_* from app.env (backup kept) -> restart vialabote-shop.service ->
#   webhook route back to 404 -> SITE_1 diff.
# The ADMIN user and its Telegram id are left as they are; Web Admin is unaffected.
#
# usage (as root):  bash site2-telegram-rollback.sh
set -euo pipefail
set +x
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
APP_ENV=/etc/vialabote-shop/app.env
APP=http://127.0.0.1:3002
WORK=/root/vialabote-shop-telegram-rollback-$(date -u +%Y%m%dT%H%M%SZ)

die() { echo "ABORT: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root"
[ "$(hostname)" != vialabote-dr ] || die "this is the DR VM"
umask 077
mkdir -p "$WORK"; chmod 700 "$WORK"
bash "$HERE/site1-healthcheck.sh" | sed '/^-- info --$/,$d' > "$WORK/site1-pre.txt"

TOKEN=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$APP_ENV")
if [ -n "$TOKEN" ]; then
  R=$(printf 'url = "https://api.telegram.org/bot%s/deleteWebhook"\nsilent\nmax-time = 20\n' "$TOKEN" | curl -K -) || R=""
  case "$R" in *'"ok":true'*) DEL=OK ;; *) DEL="FAILED (remove manually in @BotFather or retry)" ;; esac
else
  DEL="SKIPPED (no token in app.env)"
fi
unset TOKEN R

cp -p "$APP_ENV" "$WORK/app.env.before"
grep -vE '^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET)=' "$APP_ENV" > "$APP_ENV.tmp"
chown root:root "$APP_ENV.tmp"; chmod 600 "$APP_ENV.tmp"; mv "$APP_ENV.tmp" "$APP_ENV"
systemctl restart vialabote-shop.service
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$APP/")" = 200 ] && break; sleep 1; done
HOOK=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST --data '{}' "$APP/api/telegram/webhook")

bash "$HERE/site1-healthcheck.sh" | sed '/^-- info --$/,$d' > "$WORK/site1-post.txt"
diff "$WORK/site1-pre.txt" "$WORK/site1-post.txt" && SITE1=UNCHANGED || SITE1=CHANGED
echo "DELETE_WEBHOOK=$DEL"
echo "WEBHOOK_ROUTE=$HOOK (expected 404)"
echo "SITE_1=$SITE1"
echo "EVIDENCE=$WORK (app.env.before contains the token — 0600, delete when no longer needed)"
[ "$HOOK" = 404 ] && [ "$SITE1" = UNCHANGED ] || exit 2
