#!/usr/bin/env bash
# SITE_2 (vialabote-shop) — connect the existing Telegram bot to the Telegram CMS
# (POST /api/telegram/webhook) on the shared PROD VPS.
#
#   0 gates (read-only): root + TTY, not the DR VM, SITE_1 snapshot, SITE_2 active,
#     shop.vialabote.ru resolves to THIS VPS at both authoritative NS and is NOT in
#     LIMITED_RECOVERY mode, an ADMIN with a linked Telegram id exists
#     (site2-admin-bootstrap.sh)
#   1 bot token (hidden prompt) -> getMe
#   2 app.env: TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET (secret kept on re-runs),
#     backup first, atomic replace, restart vialabote-shop.service only
#   3 local webhook checks: no secret -> 403, right secret + empty update -> 200
#   4 setWebhook (https://shop.vialabote.ru/api/telegram/webhook, secret_token,
#     message + callback_query) -> getWebhookInfo; public no-secret POST -> 403
#   5 SITE_1 post-check + diff, secrets-in-journal check
#
# Secrets: the token is read with `read -s` and reaches curl only through a config
# on STDIN (`curl -K -`), never argv/env/logs. The webhook secret is generated here
# (openssl rand -hex 32) and lives only in app.env (0600 root) and at Telegram.
# Idempotent. Undo: site2-telegram-rollback.sh.
#
# usage (as root, interactive TTY):  bash site2-telegram-connect.sh
set -euo pipefail
set +x
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
OPT=/opt/vialabote-shop
APP_DIR=$OPT/current
NODE=$OPT/node-v24.21.0/bin/node
RUNUSER=/usr/sbin/runuser
APP_ENV=/etc/vialabote-shop/app.env
DB_ENV=/etc/vialabote-shop/db.env
EXPECT_DB=vialabote_shop
EXPECT_PORT=5433
APP=http://127.0.0.1:3002
DOMAIN=shop.vialabote.ru
IP=103.76.54.182
HOOK_URL=https://$DOMAIN/api/telegram/webhook
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-telegram-$STAMP

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
# Telegram Bot API call; token only on curl's stdin config. $1 = method, rest = extra config lines.
tg() {
  local method=$1; shift
  { printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$TOKEN" "$method"
    printf 'silent\nmax-time = 20\n'
    for l in "$@"; do printf '%s\n' "$l"; done; } | curl -K -
}
# Field from a JSON document on stdin, via the release's node (no jq dependency).
jget() { "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{v=undefined}for(const k of process.argv[1].split("."))v=v?.[k];console.log(v===undefined||v===null?"":typeof v==="object"?JSON.stringify(v):String(v))})' "$1"; }
wait_up() { for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$APP/")" = 200 ] && return 0; sleep 1; done; return 1; }
hook_local() { curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST -H 'Content-Type: application/json' "$@" --data '{}' "$APP/api/telegram/webhook"; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -t 0 ] || die "needs an interactive terminal (ssh -t) for the hidden token prompt"
[ "$(hostname)" != vialabote-dr ] || die "this is the DR VM — the bot is connected on the PROD VPS only"
umask 077
mkdir -p "$WORK"; chmod 700 "$WORK"

step "0/5 gates (read-only)"
bash "$HERE/site1-healthcheck.sh" | sed '/^-- info --$/,$d' > "$WORK/site1-pre.txt"
grep -q "^http https://vialabote.ru/ 200$" "$WORK/site1-pre.txt" || die "SITE_1 not healthy — nothing changed"
systemctl is-active --quiet vialabote-shop.service || die "SITE_2 service not active"
[ -x "$NODE" ] && [ -f "$APP_DIR/node_modules/@prisma/client/package.json" ] || die "SITE_2 release/node missing"
[ -f "$APP_ENV" ] || die "$APP_ENV missing (run site2-runtime-setup.sh first)"
for ns in ns1.reg.ru ns2.reg.ru; do
  A=$(dig +short +time=5 +tries=2 A "$DOMAIN" "@$ns" | sort | tr '\n' ' ')
  [ "$A" = "$IP " ] || die "$DOMAIN at $ns = '${A% }', expected $IP (DR still serving?) — nothing changed"
done
HDRS=$(curl -s -I -m 15 "https://$DOMAIN/") || die "https://$DOMAIN/ unreachable — nothing changed"
printf '%s' "$HDRS" | head -1 | grep -q ' 200' || die "https://$DOMAIN/ is not 200 — nothing changed"
printf '%s' "$HDRS" | grep -qi '^x-vialabote-mode' && die "$DOMAIN answers in LIMITED_RECOVERY mode (DR) — nothing changed"
DATABASE_URL=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in DATABASE_URL=*) DATABASE_URL=${line#DATABASE_URL=} ;; esac
done < "$DB_ENV"
case "$DATABASE_URL" in *"@127.0.0.1:$EXPECT_PORT/$EXPECT_DB?"*) ;; *) die "db.env does not point at SITE_2 (127.0.0.1:$EXPECT_PORT/$EXPECT_DB)" ;; esac
LINKED=$(cd / && env -i PATH="$PATH" HOME="$OPT/shared" DATABASE_URL="$DATABASE_URL" APP_DIR="$APP_DIR" \
  "$RUNUSER" -u vialabote-shop -- "$NODE" -e '
    const { createRequire } = require("node:module");
    const r = createRequire(process.env.APP_DIR + "/package.json");
    const p = new (r("@prisma/client").PrismaClient)();
    p.user.count({ where: { role: "ADMIN", telegramUserId: { not: null } } })
      .then((n) => console.log(n)).finally(() => p.$disconnect());') || die "DB check failed"
unset DATABASE_URL line
[ "$LINKED" -ge 1 ] 2>/dev/null || die "no ADMIN with a linked Telegram id — run site2-admin-bootstrap.sh first"
echo "ok: SITE_1 healthy, SITE_2 active, $DOMAIN -> $IP (not DR), admins with Telegram id: $LINKED"

step "1/5 bot token (not echoed)"
read -r -s -p "Bot token from @BotFather: " TOKEN; echo
TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
[[ "$TOKEN" =~ ^[0-9]{6,12}:[A-Za-z0-9_-]{30,}$ ]] || { unset TOKEN; die "token format is not <digits>:<secret> — nothing changed"; }
ME=$(tg getMe) || { unset TOKEN; die "api.telegram.org unreachable — nothing changed"; }
[ "$(printf '%s' "$ME" | jget ok)" = true ] || { unset TOKEN; die "getMe rejected the token — nothing changed"; }
BOT=$(printf '%s' "$ME" | jget result.username)
echo "ok: token valid for @$BOT"

step "2/5 app.env (backup, atomic replace, restart SITE_2 only)"
cp -p "$APP_ENV" "$WORK/app.env.before"
SECRET=$(sed -n 's/^TELEGRAM_WEBHOOK_SECRET=//p' "$APP_ENV")
[ -n "$SECRET" ] || SECRET=$(openssl rand -hex 32)   # generated once, kept on re-runs
grep -vE '^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET)=' "$APP_ENV" > "$APP_ENV.tmp"
printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_WEBHOOK_SECRET=%s\n' "$TOKEN" "$SECRET" >> "$APP_ENV.tmp"
chown root:root "$APP_ENV.tmp"; chmod 600 "$APP_ENV.tmp"; mv "$APP_ENV.tmp" "$APP_ENV"
systemctl restart vialabote-shop.service
wait_up || die "SITE_2 did not come back after restart — restore with: cp -p $WORK/app.env.before $APP_ENV && systemctl restart vialabote-shop"
echo "ok: $APP_ENV updated (0600 root:root, values not printed), backup in $WORK"

step "3/5 local webhook checks"
L_NOSECRET=$(hook_local)
L_BADSECRET=$(hook_local -H "X-Telegram-Bot-Api-Secret-Token: wrong")
L_OK=$(printf 'header = "X-Telegram-Bot-Api-Secret-Token: %s"\n' "$SECRET" | hook_local -K -)
echo "no secret=$L_NOSECRET wrong secret=$L_BADSECRET right secret=$L_OK"
[ "$L_NOSECRET$L_BADSECRET$L_OK" = 403403200 ] && LOCAL=PASS || LOCAL=FAIL

step "4/5 setWebhook + getWebhookInfo"
SET=$(tg setWebhook \
  "data-urlencode = \"url=$HOOK_URL\"" \
  "data-urlencode = \"secret_token=$SECRET\"" \
  'data-urlencode = "allowed_updates=[\"message\",\"callback_query\"]"' \
  'data-urlencode = "drop_pending_updates=true"')
[ "$(printf '%s' "$SET" | jget ok)" = true ] || { unset TOKEN SECRET; die "setWebhook failed: $(printf '%s' "$SET" | jget description)"; }
sleep 2
INFO=$(tg getWebhookInfo)
unset SECRET
W_URL=$(printf '%s' "$INFO" | jget result.url)
W_ERR=$(printf '%s' "$INFO" | jget result.last_error_message)
W_PENDING=$(printf '%s' "$INFO" | jget result.pending_update_count)
W_UPD=$(printf '%s' "$INFO" | jget result.allowed_updates)
P_NOSECRET=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' "$HOOK_URL")
echo "webhook url=$W_URL pending=$W_PENDING allowed=$W_UPD last_error='${W_ERR}' public no-secret POST=$P_NOSECRET"
[ "$W_URL" = "$HOOK_URL" ] && [ -z "$W_ERR" ] && [ "$P_NOSECRET" = 403 ] && HOOK=PASS || HOOK=FAIL

step "5/5 SITE_1 post-check + secrets check"
bash "$HERE/site1-healthcheck.sh" | sed '/^-- info --$/,$d' > "$WORK/site1-post.txt"
diff "$WORK/site1-pre.txt" "$WORK/site1-post.txt" && SITE1=UNCHANGED || SITE1=CHANGED
SEC_LEAK=NO
for v in $(grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET)=' "$APP_ENV" | cut -d= -f2-); do
  { systemctl status vialabote-shop --no-pager -l 2>&1; systemctl show vialabote-shop 2>&1; journalctl -u vialabote-shop --no-pager -o cat 2>&1; } | grep -qF "$v" && SEC_LEAK=YES
done
unset v TOKEN

echo
echo "TELEGRAM_CONNECT=$([ "$LOCAL$HOOK$SITE1$SEC_LEAK" = PASSPASSUNCHANGEDNO ] && echo PASS || echo FAIL)"
echo "BOT=@$BOT"
echo "WEBHOOK=$W_URL"
echo "LOCAL_WEBHOOK_AUTH=$LOCAL (403/403/200)"
echo "PUBLIC_WEBHOOK=$HOOK (registered, no delivery error, unauthenticated POST 403)"
echo "SECRETS_IN_JOURNAL=$SEC_LEAK"
echo "SITE_1=$SITE1"
echo "EVIDENCE=$WORK"
echo "NEXT: from the linked Telegram account send a read-only command to @$BOT and check the reply."
[ "$SITE1" = UNCHANGED ] || { echo "SITE_1 CHANGED — STOP. See diff." >&2; exit 2; }
