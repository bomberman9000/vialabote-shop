#!/usr/bin/env bash
# Vialabote ZeroHour PRIMARY — activate the Telegram CMS for SITE_2 while LIMITED_RECOVERY
# mode stays on. Runs INSIDE vialabote-dr as root, interactive (ssh -t).
#
#   0 gates + snapshot (SITE_1, WireGuard, UFW, nginx vhosts, catalog fingerprint)
#   1 deploy release app-<sha7> (Telegram catalog-mutation kill switch, default OFF)
#   2 ADMIN with linked Telegram id — created with site2-admin-bootstrap.mjs only if absent
#   3 bot token (hidden) -> getMe; existing webhook of the bot shown, replacing needs "yes"
#   4 app.env TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET (no TELEGRAM_CMS_MUTATIONS = read-only)
#     + nginx secret map (0600 root) -> restart SITE_2 -> vm-limited-mode.sh (+ its self-smoke)
#   5 synthetic updates through nginx (answers come back in the HTTP response, nothing is sent
#     to Telegram): unknown user rejected, ADMIN recognised, read-only command works, mutation
#     refused; catalog fingerprint unchanged
#   6 setWebhook https://shop.vialabote.ru/api/telegram/webhook + secret_token -> getWebhookInfo;
#     public path via the edge: no/wrong secret 503, right secret 200
#   7 owner sends a read-only command from Telegram -> delivery seen in the nginx log
#   8 security: secrets not in journal/nginx logs/evidence, env + map permissions,
#     SITE_1/WireGuard/UFW/vhosts unchanged
#
# Not touched: DNS, the VDSina edge, WireGuard, SITE_1 app/env/DB, checkout/orders/payments
# (still 503), catalog (mutations off until a separate check sets TELEGRAM_CMS_MUTATIONS=enabled).
# Secrets: token and webhook secret are read/generated here, passed to curl only via
# stdin configs (`curl -K -`), never argv/env/output. Undo: vm-telegram-rollback.sh.
#
# usage (as root on vialabote-dr, files next to this script, bundle delivered to the inbox):
#   bash vm-telegram-activate.sh <sha7>
set -euo pipefail
set +x
export LC_ALL=C
S7=${1:?usage: vm-telegram-activate.sh <sha7>}
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
IN=/srv/dr-inbox/releases
BUNDLE=app-$S7.tar.gz
OPT=/opt/vialabote-shop
NODE=$OPT/node-v24.21.0/bin/node
RUNUSER=/usr/sbin/runuser
APP_ENV=/etc/vialabote-shop/app.env
DB_ENV=/etc/vialabote-shop/db.env
TG_MAP=/etc/nginx/vialabote-telegram-secret.map
APP=http://127.0.0.1:3002
PORT=8082
DOMAIN=shop.vialabote.ru
HOOK_URL=https://$DOMAIN/api/telegram/webhook
NGINX_LOG=/var/log/nginx/access.log
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-telegram-$STAMP

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
kv() { sed -n "s/^$1=//p" "$2" | head -1; }
wait_up() { for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$APP/")" = 200 ] && return 0; sleep 1; done; return 1; }
tg() {  # Bot API call; token only in curl's stdin config
  local method=$1; shift
  { printf 'url = "https://api.telegram.org/bot%s/%s"\nsilent\nmax-time = 20\n' "$TOKEN" "$method"
    for l in "$@"; do printf '%s\n' "$l"; done; } | curl -K -
}
jget() { "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{v=undefined}for(const k of process.argv[1].split("."))v=v?.[k];console.log(v===undefined||v===null?"":typeof v==="object"?JSON.stringify(v):String(v))})' "$1"; }
hook() {  # $1 = secret ("" = no header), $2 = JSON body, $3 = base URL (default local nginx) -> body + "\n<code>"
  local base=${3:-http://$DOMAIN:$PORT}
  { [ -n "$1" ] && printf 'header = "X-Telegram-Bot-Api-Secret-Token: %s"\n' "$1"; true; } |
    curl -s -m 20 -K - -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' --data "$2" \
      --resolve "$DOMAIN:$PORT:127.0.0.1" "$base/api/telegram/webhook"
}
code() { tail -n1 <<<"$1"; }
text() { head -n -1 <<<"$1" | jget text; }
db() {  # $1 = JS body using `p` (PrismaClient), must console.log one line
  env -i PATH="$PATH" HOME="$OPT/shared" APP_DIR="$OPT/current" DATABASE_URL="$(kv DATABASE_URL "$DB_ENV")" \
    "$RUNUSER" -u vialabote-shop -- "$NODE" -e "
      const r = require('node:module').createRequire(process.env.APP_DIR + '/package.json');
      const p = new (r('@prisma/client').PrismaClient)();
      (async () => { $1 })().finally(() => p.\$disconnect());" </dev/null
}
CATALOG_JS='const rows = await p.product.findMany({ select: { id: true, price: true, status: true, version: true, updatedAt: true }, orderBy: { id: "asc" } });
  const pub = rows.filter((x) => x.status === "published").length;
  const h = require("node:crypto").createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  const pc = await p.pendingConfirmation.count();
  console.log(`products=${rows.length} published=${pub} fp=${h} pending=${pc}`);'
snap() {  # stable facts that must not change (SITE_1, edge leg, vhosts)
  for u in vialabote-site wg-quick@wg0; do echo "unit $u $(systemctl show -p ActiveState --value $u) pid=$(systemctl show -p MainPID --value $u) restarts=$(systemctl show -p NRestarts --value $u)"; done
  echo "site1 current -> $(readlink /opt/vialabote/current)"
  for f in /etc/wireguard/* /etc/vialabote/* /etc/vialabote-shop/db.env /etc/nginx/sites-available/vialabote-dr-health \
           /etc/nginx/sites-available/vialabote-dr-testroute /etc/nginx/sites-available/vialabote-dr-limited /etc/nginx/nginx.conf; do
    [ -f "$f" ] && echo "sha256 $f $(sha256sum "$f" | cut -c1-16)"
  done
  echo "ufw $(ufw status verbose 2>/dev/null | sha256sum | cut -c1-16)"
  for pth in / /products /about; do echo "site1 GET $pth $(curl -s -o /dev/null -m 15 -w '%{http_code}' --resolve vialabote.ru:$PORT:127.0.0.1 http://vialabote.ru:$PORT$pth)"; done
}

[ "$(id -u)" -eq 0 ] || die "run as root"
[ "$(hostname)" = vialabote-dr ] || die "not the vialabote-dr VM"
[ -t 0 ] || die "needs an interactive terminal (ssh -t) for hidden prompts"
umask 077
mkdir -p "$WORK"; chmod 700 "$WORK"

step "0/8 gates + snapshot (read-only)"
for f in vm-deploy-release.sh vm-limited-mode.sh site2-admin-bootstrap.mjs; do [ -f "$HERE/$f" ] || die "$f missing next to this script"; done
[ -f "$IN/READY" ] && [ -f "$IN/$BUNDLE" ] && [ -f "$IN/$BUNDLE.sha256" ] || die "$BUNDLE (+.sha256, READY) not in $IN"
(cd "$IN" && sha256sum -c --quiet "$BUNDLE.sha256") || die "bundle SHA256 mismatch"
# the helper scripts next to us must be byte-identical to the ones inside the release
for pair in ops/dr/vm-telegram-activate.sh:vm-telegram-activate.sh ops/dr/vm-deploy-release.sh:vm-deploy-release.sh \
            ops/dr/vm-limited-mode.sh:vm-limited-mode.sh ops/vps/site2-admin-bootstrap.mjs:site2-admin-bootstrap.mjs; do
  a=$(tar -xzOf "$IN/$BUNDLE" "./${pair%%:*}" | sha256sum | cut -c1-64); b=$(sha256sum "$HERE/${pair##*:}" | cut -c1-64)
  [ "$a" = "$b" ] || die "${pair##*:} differs from the copy in $BUNDLE"
done
[ -L /etc/nginx/sites-enabled/vialabote-dr-limited ] || die "LIMITED mode vhost not enabled — this script only works with limited mode on"
curl -s -I -m 10 --resolve "$DOMAIN:$PORT:127.0.0.1" "http://$DOMAIN:$PORT/" | grep -qi '^x-vialabote-mode: LIMITED_RECOVERY' || die "limited mode header missing"
systemctl is-active --quiet vialabote-shop.service || die "SITE_2 service not active"
[ -x "$NODE" ] || die "node 24 missing"
snap > "$WORK/snap-pre.txt"
grep -q "^site1 GET / 200$" "$WORK/snap-pre.txt" || die "SITE_1 not healthy — nothing changed"
CAT_PRE=$(db "$CATALOG_JS") || die "DB read failed"
echo "ok: bundle verified, limited mode on, SITE_1 healthy; catalog: $CAT_PRE"
echo "current SITE_2 release: $(readlink $OPT/current)"

step "1/8 deploy release $S7 (catalog mutations via Telegram: OFF by default)"
if [ "$(readlink $OPT/current)" = "releases/$S7" ]; then
  echo "already current"
else
  bash "$HERE/vm-deploy-release.sh" site2 "$BUNDLE" | tee "$WORK/deploy.txt"
fi
[ "$(cat $OPT/current/.release-commit 2>/dev/null | cut -c1-7)" = "$S7" ] || die "release commit mismatch after deploy"

step "2/8 ADMIN with a linked Telegram id (current DB only)"
ADMIN_TG=$(db 'const a = await p.user.findFirst({ where: { role: "ADMIN", telegramUserId: { not: null } }, orderBy: { createdAt: "asc" } }); console.log(a ? a.telegramUserId : "");')
if [ -z "$ADMIN_TG" ]; then
  echo "no ADMIN with a Telegram id in this database — creating one (site2-admin-bootstrap.mjs)"
  read -r -p "Admin email: " EMAIL
  EMAIL=$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
  read -r -s -p "Admin password (min 12 chars, hidden): " PW; echo
  read -r -s -p "Repeat password: " PW2; echo
  [ "$PW" = "$PW2" ] || { unset PW PW2; die "passwords do not match — admin not created"; }
  unset PW2
  read -r -p "Your numeric Telegram user id: " TGID
  TGID=$(printf '%s' "$TGID" | tr -d '[:space:]')
  MJS_DIR=$(mktemp -d /tmp/vlshop-admin.XXXXXX)
  install -m 0644 "$HERE/site2-admin-bootstrap.mjs" "$MJS_DIR/bootstrap.mjs"
  chown -R vialabote-shop:vialabote-shop "$MJS_DIR"; chmod 0700 "$MJS_DIR"
  RC=0
  RESULT=$(printf '%s\n%s\n%s\n' "$EMAIL" "$PW" "$TGID" | \
    env -i PATH="$PATH" HOME="$OPT/shared" APP_DIR="$OPT/current" DATABASE_URL="$(kv DATABASE_URL "$DB_ENV")" \
        EXPECT_DB=vialabote_shop EXPECT_PORT=5433 \
    "$RUNUSER" -u vialabote-shop -- "$NODE" "$MJS_DIR/bootstrap.mjs") || RC=$?
  unset PW
  rm -f "$MJS_DIR/bootstrap.mjs"; rmdir "$MJS_DIR"
  [ "$RC" = 0 ] || die "admin bootstrap failed (single transaction, nothing written)"
  echo "$RESULT" | tee "$WORK/admin.json"
  ADMIN_TG=$TGID
else
  echo "ADMIN with Telegram id already present (…${ADMIN_TG: -3}) — not changed"
fi
ADMINS=$(db 'console.log(await p.user.count({ where: { role: "ADMIN", telegramUserId: { not: null } } }));')

step "3/8 bot token (hidden) — the existing bot, no new bot is created"
read -r -s -p "Bot token from @BotFather: " TOKEN; echo
TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
[[ "$TOKEN" =~ ^[0-9]{6,12}:[A-Za-z0-9_-]{30,}$ ]] || { unset TOKEN; die "token format is not <digits>:<secret>"; }
ME=$(tg getMe) || { unset TOKEN; die "api.telegram.org unreachable"; }
[ "$(jget ok <<<"$ME")" = true ] || { unset TOKEN; die "getMe rejected the token"; }
BOT=$(jget result.username <<<"$ME")
OLD_URL=$(tg getWebhookInfo | jget result.url)
echo "ok: @$BOT; current webhook: ${OLD_URL:-<none>}"
if [ -n "$OLD_URL" ] && [ "$OLD_URL" != "$HOOK_URL" ]; then
  read -r -p "The bot currently delivers to $OLD_URL. Replace it with $HOOK_URL? type yes: " OK
  [ "$OK" = yes ] || { unset TOKEN; die "kept the existing webhook — nothing changed in Telegram"; }
fi

step "4/8 app.env + nginx secret map -> restart SITE_2 -> limited mode with the webhook exception"
cp -p "$APP_ENV" "$WORK/app.env.before"
SECRET=$(kv TELEGRAM_WEBHOOK_SECRET "$APP_ENV")
[[ "$SECRET" =~ ^[0-9a-f]{64}$ ]] || SECRET=$(openssl rand -hex 32)
# TELEGRAM_CMS_MUTATIONS is removed on purpose: catalog changes stay off until a separate check
grep -vE '^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|TELEGRAM_CMS_MUTATIONS)=' "$APP_ENV" > "$APP_ENV.tmp"
printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_WEBHOOK_SECRET=%s\n' "$TOKEN" "$SECRET" >> "$APP_ENV.tmp"
chown root:root "$APP_ENV.tmp"; chmod 600 "$APP_ENV.tmp"; mv "$APP_ENV.tmp" "$APP_ENV"
printf '"~^%s$" 1;\n' "$SECRET" > "$TG_MAP.tmp"
chown root:root "$TG_MAP.tmp"; chmod 600 "$TG_MAP.tmp"; mv "$TG_MAP.tmp" "$TG_MAP"
systemctl restart vialabote-shop.service
wait_up || die "SITE_2 did not come back — undo: bash $HERE/vm-telegram-rollback.sh"
bash "$HERE/vm-limited-mode.sh" > "$WORK/limited-mode.txt" 2>&1 || { tail -20 "$WORK/limited-mode.txt"; die "limited mode smoke failed — undo: bash $HERE/vm-telegram-rollback.sh"; }
grep -E '^(FAIL|LIMITED_MODE_SMOKE)' "$WORK/limited-mode.txt"
for _ in $(seq 1 20); do [ "$(code "$(hook "$SECRET" '{}')")" = 200 ] && break; sleep 1; done   # reloaded workers

step "5/8 synthetic updates through nginx (replies stay in the HTTP response)"
UNKNOWN_ID=1000000001; [ "$ADMIN_TG" = "$UNKNOWN_ID" ] && UNKNOWN_ID=1000000002
msg() { printf '{"update_id":1,"message":{"message_id":1,"chat":{"id":%s},"from":{"id":%s},"text":"%s"}}' "$1" "$1" "$2"; }
R_NONE=$(hook "" '{}'); R_WRONG=$(hook "wrong-secret" '{}'); R_EMPTY=$(hook "$SECRET" '{}')
R_UNK=$(hook "$SECRET" "$(msg $UNKNOWN_ID 'показать товары без INCI')")
R_ADM=$(hook "$SECRET" "$(msg "$ADMIN_TG" 'показать товары без INCI')")
R_MUT=$(hook "$SECRET" "$(msg "$ADMIN_TG" 'цена Multi3 1')")
R_CB=$(hook "$SECRET" "{\"update_id\":2,\"callback_query\":{\"id\":\"x\",\"from\":{\"id\":$ADMIN_TG},\"message\":{\"chat\":{\"id\":$ADMIN_TG},\"message_id\":1},\"data\":\"confirm:nonexistent\"}}")
echo "no secret=$(code "$R_NONE") wrong secret=$(code "$R_WRONG") right secret=$(code "$R_EMPTY")"
echo "unknown user: $(code "$R_UNK") '$(text "$R_UNK")'"
echo "admin read-only: $(code "$R_ADM") '$(text "$R_ADM" | head -2 | tr '\n' ' ')'"
echo "admin mutation: $(code "$R_MUT") '$(text "$R_MUT")'"
echo "admin confirm callback: $(code "$R_CB") '$(text "$R_CB")'"
[ "$(code "$R_NONE")$(code "$R_WRONG")$(code "$R_EMPTY")" = 503503200 ] && GATE=PASS || GATE=FAIL
grep -q 'не привязан' <<<"$(text "$R_UNK")" && UNAUTH=YES || UNAUTH=NO
T_ADM=$(text "$R_ADM"); { [ "$(code "$R_ADM")" = 200 ] && grep -q 'INCI' <<<"$T_ADM" && ! grep -q 'не привязан' <<<"$T_ADM"; } && ADMIN_AUTH=PASS || ADMIN_AUTH=FAIL
{ grep -q 'отключены' <<<"$(text "$R_MUT")" && grep -q 'отключены' <<<"$(text "$R_CB")"; } && MUT_OFF=YES || MUT_OFF=NO
CAT_POST=$(db "$CATALOG_JS")
echo "catalog before: $CAT_PRE"; echo "catalog after:  $CAT_POST"
[ "$CAT_PRE" = "$CAT_POST" ] && CATALOG_SAME=YES || CATALOG_SAME=NO

step "6/8 setWebhook + getWebhookInfo + public path through the edge"
SET=$(tg setWebhook "data-urlencode = \"url=$HOOK_URL\"" "data-urlencode = \"secret_token=$SECRET\"" \
  'data-urlencode = "allowed_updates=[\"message\",\"callback_query\"]"' 'data-urlencode = "drop_pending_updates=true"')
[ "$(jget ok <<<"$SET")" = true ] || die "setWebhook failed: $(jget description <<<"$SET")"
sleep 2
INFO=$(tg getWebhookInfo)
W_URL=$(jget result.url <<<"$INFO"); W_ERR=$(jget result.last_error_message <<<"$INFO")
W_PENDING=$(jget result.pending_update_count <<<"$INFO"); W_UPD=$(jget result.allowed_updates <<<"$INFO")
echo "getWebhookInfo: url=$W_URL pending=$W_PENDING allowed=$W_UPD last_error='$W_ERR'"
P_NONE=$(code "$(hook "" '{}' "https://$DOMAIN")"); P_WRONG=$(code "$(hook "wrong-secret" '{}' "https://$DOMAIN")")
P_RIGHT=$(code "$(hook "$SECRET" '{}' "https://$DOMAIN")")
echo "public $HOOK_URL: no secret=$P_NONE wrong secret=$P_WRONG right secret=$P_RIGHT"
{ [ "$W_URL" = "$HOOK_URL" ] && [ -z "$W_ERR" ] && [ "$P_NONE$P_WRONG$P_RIGHT" = 503503200 ]; } && HOOK=PASS || HOOK=FAIL

step "7/8 live check from Telegram"
L0=$(wc -l < "$NGINX_LOG")
echo "From the Telegram account linked above, send to @$BOT:   показать товары без INCI"
read -r -p "Press Enter after the bot has replied (or after ~1 minute if it did not): " _
LIVE=$(tail -n +"$((L0 + 1))" "$NGINX_LOG" | grep -c '"POST /api/telegram/webhook HTTP/[0-9.]*" 200' || true)
INFO=$(tg getWebhookInfo); W_ERR2=$(jget result.last_error_message <<<"$INFO")
echo "webhook deliveries with 200 since the prompt: $LIVE; last_error='$W_ERR2'"
read -r -p "Did the bot answer with the product list (not 'не привязан')? [y/N]: " SAW
{ [ "$LIVE" -ge 1 ] && [ -z "$W_ERR2" ] && [ "$SAW" = y ]; } && LIVE_OK=PASS || LIVE_OK=FAIL

step "8/8 security + no-impact checks"
LEAK=NO
for v in "$TOKEN" "$SECRET"; do
  { journalctl -u vialabote-shop -u nginx --since "-2h" --no-pager -o cat 2>&1; cat /var/log/nginx/*.log 2>/dev/null; cat "$WORK"/*.txt "$WORK"/*.json 2>/dev/null; } | grep -qF "$v" && LEAK=YES
done
unset v TOKEN SECRET
PERM="app.env=$(stat -c '%a %U:%G' "$APP_ENV") map=$(stat -c '%a %U:%G' "$TG_MAP")"
[ "$PERM" = "app.env=600 root:root map=600 root:root" ] && PERM_OK=PASS || PERM_OK=FAIL
grep -q '^TELEGRAM_CMS_MUTATIONS=' "$APP_ENV" && MUT_ENV=SET || MUT_ENV=ABSENT
snap > "$WORK/snap-post.txt"
diff "$WORK/snap-pre.txt" "$WORK/snap-post.txt" && IMPACT=NONE || IMPACT=CHANGED
LM=$(grep -c '^PASS' "$WORK/limited-mode.txt" || true); LF=$(grep -c '^FAIL' "$WORK/limited-mode.txt" || true)
curl -s -I -m 10 --resolve "$DOMAIN:$PORT:127.0.0.1" "http://$DOMAIN:$PORT/" | grep -qi '^x-vialabote-mode: LIMITED_RECOVERY' && LIMITED=ACTIVE || LIMITED=OFF
N13=$(grep -c '^PASS SITE_2 catalog 13 products' "$WORK/limited-mode.txt" || true)

OK=$([ "$GATE$UNAUTH$ADMIN_AUTH$MUT_OFF$CATALOG_SAME$HOOK$LIVE_OK$LEAK$PERM_OK$MUT_ENV$IMPACT$LIMITED" = PASSYESPASSYESYESPASSPASSNOPASSABSENTNONEACTIVE ] && echo PASS || echo FAIL)
[ "$OK" = FAIL ] && [ "$LIVE_OK" = FAIL ] && [ "$GATE$UNAUTH$ADMIN_AUTH$HOOK$LEAK$IMPACT" = PASSYESPASSPASSNONONE ] && OK=PARTIAL
echo
echo "TELEGRAM_ACTIVATION=$OK"
echo "COMMIT=$(cat $OPT/current/.release-commit)"
echo "BOT=@$BOT"
echo "ADMIN_PRESENT=YES ($ADMINS with Telegram id)"
echo "TELEGRAM_ID_LINKED=YES (…${ADMIN_TG: -3})"
echo "TOKEN_CONFIGURED=YES (app.env, value not printed)"
echo "WEBHOOK_CONFIGURED=$HOOK ($W_URL, secret_token set)"
echo "GETWEBHOOKINFO=url=$W_URL pending=$W_PENDING allowed=$W_UPD last_error='${W_ERR2}'"
echo "WEBHOOK_SECRET_GATE=$GATE (nginx+app: none 503, wrong 503, right 200; public: $P_NONE/$P_WRONG/$P_RIGHT)"
echo "ADMIN_AUTH=$ADMIN_AUTH"
echo "UNAUTHORIZED_REJECTED=$UNAUTH"
echo "LIVE_TELEGRAM_ROUNDTRIP=$LIVE_OK ($LIVE deliveries)"
echo "CATALOG_MUTATIONS=OFF ($MUT_ENV TELEGRAM_CMS_MUTATIONS; mutation + confirm refused: $MUT_OFF)"
echo "CATALOG=$([ "$N13" = 1 ] && echo 13/13 || echo CHECK) unchanged=$CATALOG_SAME ($CAT_POST)"
echo "LIMITED_MODE=$LIMITED (smoke PASS=$LM FAIL=$LF; checkout/orders/payment/admin still 503)"
echo "SECRETS_IN_LOGS=$LEAK"
echo "ENV_PERMISSIONS=$PERM_OK ($PERM)"
echo "SITE_1_IMPACT=$IMPACT (also WireGuard, UFW, vhosts, db.env)"
echo "EVIDENCE=$WORK (app.env.before holds the previous env — 0600; delete when no longer needed)"
[ "$OK" = PASS ]
