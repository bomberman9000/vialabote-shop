#!/usr/bin/env bash
# SITE_2 (vialabote-shop) — production ADMIN bootstrap (first admin + Telegram id).
#
#   gates (root, SITE_1 snapshot, SITE_2 service + DB) -> hidden prompts
#   -> site2-admin-bootstrap.mjs as user vialabote-shop (app DB role, stdin only)
#   -> web-admin login check via NextAuth on 127.0.0.1:3002 (password via stdin)
#   -> SITE_1 post-check + diff.
#
# Secrets: the password is read with `read -s` (no echo), kept only in this
# shell's memory, and passed to child processes exclusively on STDIN
# (never argv/env/files/logs). Nothing here sets a Telegram token or webhook.
# Idempotent: re-running with the same email + Telegram id updates the same
# user (role ADMIN, password reset to the one typed); conflicts abort.
#
# usage (as root, interactive TTY):  bash site2-admin-bootstrap.sh
set -euo pipefail
set +x
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
OPT=/opt/vialabote-shop
APP_DIR=$OPT/current
NODE=$OPT/node-v24.21.0/bin/node
RUNUSER=/usr/sbin/runuser
DB_ENV=/etc/vialabote-shop/db.env
EXPECT_DB=vialabote_shop
EXPECT_PORT=5433
APP=http://127.0.0.1:3002
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-admin-$STAMP

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
valid_email() { [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] && [ ${#1} -le 200 ]; }
valid_tgid() { [[ "$1" =~ ^[1-9][0-9]{4,14}$ ]]; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -t 0 ] || die "needs an interactive terminal (ssh -t) for the hidden password prompt"
umask 077
mkdir -p "$WORK"; chmod 700 "$WORK"

step "1/5 gates (read-only)"
bash "$HERE/site1-healthcheck.sh" | sed '/^-- info --$/,$d' > "$WORK/site1-pre.txt"
grep -q "^http https://vialabote.ru/ 200$" "$WORK/site1-pre.txt" || die "SITE_1 not healthy — nothing changed"
systemctl is-active --quiet vialabote-shop.service || die "SITE_2 service not active"
[ -x "$NODE" ] && [ -f "$APP_DIR/node_modules/bcryptjs/package.json" ] || die "SITE_2 release/node missing"
[ -f "$HERE/site2-admin-bootstrap.mjs" ] || die "site2-admin-bootstrap.mjs missing next to this script"
DATABASE_URL=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in DATABASE_URL=*) DATABASE_URL=${line#DATABASE_URL=} ;; esac
done < "$DB_ENV"
case "$DATABASE_URL" in *"@127.0.0.1:$EXPECT_PORT/$EXPECT_DB?"*) ;; *) die "db.env does not point at SITE_2 (127.0.0.1:$EXPECT_PORT/$EXPECT_DB)" ;; esac
echo "ok: SITE_1 healthy, SITE_2 active, DB = SITE_2 ($EXPECT_DB:$EXPECT_PORT, app role)"

step "2/5 admin details (password is not echoed)"
read -r -p "Admin email: " EMAIL
EMAIL=$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
valid_email "$EMAIL" || die "invalid email — nothing changed"
read -r -s -p "Admin password (min 12 chars, hidden): " PW; echo
read -r -s -p "Repeat password: " PW2; echo
[ "$PW" = "$PW2" ] || { unset PW PW2; die "passwords do not match — nothing changed"; }
unset PW2
[ ${#PW} -ge 12 ] || { unset PW; die "password shorter than 12 characters — nothing changed"; }
read -r -p "Your numeric Telegram user id: " TGID
TGID=$(printf '%s' "$TGID" | tr -d '[:space:]')
valid_tgid "$TGID" || { unset PW; die "Telegram user id must be a number (5-15 digits) — nothing changed"; }

step "3/5 create/update ADMIN in SITE_2 DB"
# The service user cannot read /tmp/vialabote-shop-ops (0700 owner zero): give it
# a private copy of the .mjs for this run only.
MJS_DIR=$(mktemp -d /tmp/vlshop-admin.XXXXXX)
install -m 0644 "$HERE/site2-admin-bootstrap.mjs" "$MJS_DIR/bootstrap.mjs"
chown -R vialabote-shop:vialabote-shop "$MJS_DIR"; chmod 0700 "$MJS_DIR"
RC=0
RESULT=$(printf '%s\n%s\n%s\n' "$EMAIL" "$PW" "$TGID" | \
  env -i PATH="$PATH" HOME="$OPT/shared" APP_DIR="$APP_DIR" DATABASE_URL="$DATABASE_URL" \
      EXPECT_DB="$EXPECT_DB" EXPECT_PORT="$EXPECT_PORT" \
  "$RUNUSER" -u vialabote-shop -- "$NODE" "$MJS_DIR/bootstrap.mjs") || RC=$?
rm -f "$MJS_DIR/bootstrap.mjs"; rmdir "$MJS_DIR"
[ "$RC" = 0 ] || { unset PW; die "bootstrap failed (see message above) — no partial writes (single transaction)"; }
unset DATABASE_URL
echo "$RESULT" | tee "$WORK/result.json"

step "4/5 web-admin login check (NextAuth on $APP, password via stdin)"
JAR="$WORK/cookies.txt"
CSRF=$(curl -s -m 15 -c "$JAR" -b "$JAR" "$APP/api/auth/csrf" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')
[ -n "$CSRF" ] || { unset PW; die "could not get NextAuth csrf token"; }
LOGIN=$(printf '%s' "$PW" | curl -s -m 20 -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=$EMAIL" --data-urlencode "password@-" \
  --data-urlencode "json=true" --data-urlencode "callbackUrl=$APP/admin/products" \
  "$APP/api/auth/callback/credentials")
unset PW
SESSION=$(curl -s -m 15 -b "$JAR" "$APP/api/auth/session")
ADMIN_PAGE=$(curl -s -o /dev/null -m 20 -w '%{http_code}' -b "$JAR" "$APP/admin/products")
ANON_PAGE=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$APP/admin/products")
rm -f "$JAR"   # session cookie is a credential — not kept as evidence
SESSION_ROLE=$(printf '%s' "$SESSION" | sed -n 's/.*"role":"\([A-Z]*\)".*/\1/p')
SESSION_EMAIL=$(printf '%s' "$SESSION" | sed -n 's/.*"email":"\([^"]*\)".*/\1/p')
echo "callback=$LOGIN session_email=$SESSION_EMAIL session_role=$SESSION_ROLE /admin/products: with session=$ADMIN_PAGE, anonymous=$ANON_PAGE"
[ "$SESSION_ROLE" = ADMIN ] && [ "$SESSION_EMAIL" = "$EMAIL" ] && [ "$ADMIN_PAGE" = 200 ] && [ "$ANON_PAGE" != 200 ] && WEB=PASS || WEB=FAIL

step "5/5 SITE_1 post-check"
bash "$HERE/site1-healthcheck.sh" | sed '/^-- info --$/,$d' > "$WORK/site1-post.txt"
diff "$WORK/site1-pre.txt" "$WORK/site1-post.txt" && SITE1=UNCHANGED || SITE1=CHANGED

j() { printf '%s' "$RESULT" | sed -n "s/.*\"$1\":\([^,}]*\).*/\1/p" | tr -d '"'; }
echo
echo "ADMIN_BOOTSTRAP=$([ "$WEB$SITE1" = PASSUNCHANGED ] && [ "$(j role)" = ADMIN ] && [ "$(j telegramLinked)" = true ] && echo PASS || echo FAIL)"
echo "ADMIN_ACTION=$(j action)"
echo "ADMIN_EMAIL=$(j email)"
echo "ADMIN_ROLE=$(j role)"
echo "ADMIN_USERS=$(j adminUsers) (total users $(j totalUsers))"
echo "TELEGRAM_ID_LINKED=$( [ "$(j telegramLinked)" = true ] && echo YES || echo NO)"
echo "PASSWORD_HASH_PRESENT=$( [ "$(j passwordHashPresent)" = true ] && [ "$(j passwordHashVerifies)" = true ] && echo YES || echo NO) (bcrypt cost 10, verified)"
echo "PASSWORD_EXPOSED=NO (stdin only; not in argv/env/output/evidence)"
echo "WEB_ADMIN_AUTH=$WEB (local NextAuth credentials login -> role ADMIN -> /admin/products 200)"
echo "DB=$(j db)"
echo "SITE_1=$SITE1"
echo "EVIDENCE=$WORK"
[ "$SITE1" = UNCHANGED ] || { echo "SITE_1 CHANGED — STOP. See diff." >&2; exit 2; }
