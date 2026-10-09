#!/usr/bin/env bash
# Vialabote ZeroHour PRIMARY — deploy / roll back a SITE_2 (shop.vialabote.ru) release.
# Runs INSIDE vialabote-dr as root. Only SITE_2 changes: its `current` symlink and a restart of
# vialabote-shop.service (+ vialabote-telegram-poller.service if it is installed). SITE_1, DNS,
# the VDSina edge, WireGuard, PostgreSQL, nginx/limited mode, app.env are not touched.
#
#   deploy <sha7>   verify bundle + this script == its copy in the bundle -> remember the
#                   previous release -> vm-deploy-release.sh -> restart -> checks; if the shop or
#                   the catalog check fails, switch back to the previous release automatically
#   rollback        switch `current` back to the release remembered by the last deploy -> restart -> checks
#
# Checks (local nginx :8082 = what the edge proxies, and the public URL through the edge):
#   / 200, catalog 13 products, /favicon.ico + /icons/{icon-32,icon-512,apple-touch-icon}.png 200
#   with the right content-type, limited mode header, webhook: no secret 503 (nginx), right secret
#   200 (exception + app), app route without secret 403; SITE_1/WireGuard/UFW/env/db unchanged.
#
# usage: bash vm-site2-release.sh deploy <sha7>   |   bash vm-site2-release.sh rollback
set -euo pipefail
set +x
export LC_ALL=C PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
MODE=${1:?usage: vm-site2-release.sh deploy <sha7> | rollback}
HERE="$(cd "$(dirname "$0")" && pwd)"
OPT=/opt/vialabote-shop
IN=/srv/dr-inbox/releases
STATE=/var/lib/vialabote-dr/releases/site2-previous
APP_ENV=/etc/vialabote-shop/app.env
POLLER=vialabote-telegram-poller.service
PORT=8082
DOMAIN=shop.vialabote.ru
WORK=/root/vialabote-site2-release-$MODE-$(date -u +%Y%m%dT%H%M%SZ)

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
kv() { sed -n "s/^$1=//p" "$2" | head -1; }
loc() { curl -s -m 20 --resolve "$DOMAIN:$PORT:127.0.0.1" "$@"; }
wait_up() { for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:3002/)" = 200 ] && return 0; sleep 1; done; return 1; }
snap() {
  for u in vialabote-site wg-quick@wg0 postgresql@16-main postgresql@16-shop nginx; do echo "unit $u $(systemctl show -p ActiveState --value $u) pid=$(systemctl show -p MainPID --value $u)"; done
  echo "site1 current -> $(readlink /opt/vialabote/current)"
  for f in /etc/wireguard/* /etc/vialabote/* /etc/vialabote-shop/* /etc/nginx/conf.d/vialabote-limited-map.conf \
           /etc/nginx/sites-available/vialabote-dr-limited /etc/nginx/nginx.conf; do
    [ -f "$f" ] && echo "sha256 $f $(sha256sum "$f" | cut -c1-16)"
  done
  echo "ufw $(ufw status verbose 2>/dev/null | sha256sum | cut -c1-16)"
  for pth in / /products; do echo "site1 GET $pth $(curl -s -o /dev/null -m 15 -w '%{http_code}' --resolve vialabote.ru:$PORT:127.0.0.1 http://vialabote.ru:$PORT$pth)"; done
}
checks() {  # prints one line per check, "PASS"/"FAIL" first; sets CORE (shop+catalog) and ALL
  local secret code ct n
  CORE=PASS; ALL=PASS
  r() { echo "$1 $2"; [ "$1" = PASS ] || { ALL=FAIL; [ "${3:-}" = core ] && CORE=FAIL; }; true; }
  code=$(loc -o /dev/null -w '%{http_code}' "http://$DOMAIN:$PORT/"); [ "$code" = 200 ] && r PASS "shop / $code" || r FAIL "shop / $code" core
  n=$(loc "http://$DOMAIN:$PORT/catalog" | grep -oE 'href="/product/[a-z0-9-]+"' | sort -u | wc -l)
  [ "$n" = 13 ] && r PASS "catalog $n/13" || r FAIL "catalog $n/13" core
  for f in favicon.ico:image/x-icon icons/icon-32.png:image/png icons/icon-512.png:image/png icons/apple-touch-icon.png:image/png; do
    read -r code ct < <(loc -o /dev/null -w '%{http_code} %{content_type}' "http://$DOMAIN:$PORT/${f%%:*}")
    [ "$code $ct" = "200 ${f##*:}" ] && r PASS "/${f%%:*} $code $ct" || r FAIL "/${f%%:*} $code $ct"
  done
  n=$(loc "http://$DOMAIN:$PORT/" | grep -oE '<link[^>]*rel="(icon|apple-touch-icon)"[^>]*>' | wc -l)
  [ "$n" = 4 ] && r PASS "head icon links $n" || r FAIL "head icon links $n"
  loc -I "http://$DOMAIN:$PORT/" | grep -qi '^x-vialabote-mode: LIMITED_RECOVERY' && r PASS "limited mode header" || r FAIL "limited mode header"
  code=$(loc -o /dev/null -w '%{http_code}' -X POST --data '{}' "http://$DOMAIN:$PORT/api/orders"); [ "$code" = 503 ] && r PASS "orders POST $code" || r FAIL "orders POST $code"
  code=$(loc -o /dev/null -w '%{http_code}' -X POST --data '{}' "http://$DOMAIN:$PORT/api/telegram/webhook"); [ "$code" = 503 ] && r PASS "webhook no secret (nginx) $code" || r FAIL "webhook no secret (nginx) $code"
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST --data '{}' http://127.0.0.1:3002/api/telegram/webhook); [ "$code" = 403 ] && r PASS "webhook route no secret (app) $code" || r FAIL "webhook route no secret (app) $code"
  secret=$(kv TELEGRAM_WEBHOOK_SECRET "$APP_ENV")
  if [ -n "$secret" ]; then
    code=$(printf 'header = "X-Telegram-Bot-Api-Secret-Token: %s"\n' "$secret" | loc -K - -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' "http://$DOMAIN:$PORT/api/telegram/webhook")
    [ "$code" = 200 ] && r PASS "webhook right secret $code" || r FAIL "webhook right secret $code"
  fi
  unset secret
  if systemctl cat "$POLLER" >/dev/null 2>&1; then
    systemctl is-active --quiet "$POLLER" && r PASS "telegram poller active" || r FAIL "telegram poller not active"
  fi
  for f in / /favicon.ico /icons/apple-touch-icon.png; do
    code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "https://$DOMAIN$f"); [ "$code" = 200 ] && r PASS "public https://$DOMAIN$f $code" || r FAIL "public https://$DOMAIN$f $code"
  done
}
restart_site2() {
  systemctl restart vialabote-shop.service
  wait_up || return 1
  if systemctl cat "$POLLER" >/dev/null 2>&1 && systemctl is-enabled --quiet "$POLLER"; then systemctl restart "$POLLER"; sleep 3; fi
}
switch_to() {  # $1 = releases/<sha7>
  [ -d "$OPT/$1" ] || die "$OPT/$1 does not exist"
  ln -sfn "$1" "$OPT/current.tmp" && mv -T "$OPT/current.tmp" "$OPT/current"
}

[ "$(id -u)" -eq 0 ] || die "run as root"
[ "$(hostname)" = vialabote-dr ] || die "not the vialabote-dr VM"
[ -L /etc/nginx/sites-enabled/vialabote-dr-limited ] || die "limited mode vhost not enabled"
umask 077; mkdir -p "$WORK"; chmod 700 "$WORK"
snap > "$WORK/snap-pre.txt"
grep -q "^site1 GET / 200$" "$WORK/snap-pre.txt" || die "SITE_1 not healthy — nothing changed"
FROM=$(readlink "$OPT/current")

if [ "$MODE" = deploy ]; then
  S7=${2:?usage: vm-site2-release.sh deploy <sha7>}
  BUNDLE=app-$S7.tar.gz
  step "1/4 gates"
  [ -f "$IN/READY" ] && [ -f "$IN/$BUNDLE" ] && [ -f "$IN/$BUNDLE.sha256" ] || die "$BUNDLE (+.sha256, READY) not in $IN"
  (cd "$IN" && sha256sum -c --quiet "$BUNDLE.sha256") || die "bundle SHA256 mismatch"
  for pair in ops/dr/vm-site2-release.sh:vm-site2-release.sh ops/dr/vm-deploy-release.sh:vm-deploy-release.sh; do
    a=$(tar -xzOf "$IN/$BUNDLE" "./${pair%%:*}" | sha256sum | cut -c1-64); b=$(sha256sum "$HERE/${pair##*:}" | cut -c1-64)
    [ "$a" = "$b" ] || die "${pair##*:} differs from the copy in $BUNDLE"
  done
  for f in public/favicon.ico public/icons/icon-32.png public/icons/icon-512.png public/icons/apple-touch-icon.png .next/BUILD_ID; do
    tar -tzf "$IN/$BUNDLE" "./$f" >/dev/null 2>&1 || die "$f missing in $BUNDLE"
  done
  [ "$FROM" != "releases/$S7" ] || die "releases/$S7 is already current"
  echo "ok: $BUNDLE verified (icons + build inside); current $FROM"
  checks > "$WORK/checks-before.txt" || true
  step "2/4 install $S7 (previous: $FROM, kept for rollback)"
  install -d -m 0755 "$(dirname "$STATE")"; echo "$FROM" > "$STATE"
  bash "$HERE/vm-deploy-release.sh" site2 "$BUNDLE" | tee "$WORK/deploy.txt"
  [ "$(cut -c1-7 "$OPT/current/.release-commit")" = "$S7" ] || die "release commit mismatch"
  step "3/4 restart + checks"
  if ! restart_site2; then
    echo "SITE_2 did not come up on $S7 — switching back to $FROM"; switch_to "$FROM"; restart_site2 || true; AUTO=ROLLED_BACK
  fi
  checks > "$WORK/checks-after.txt"; cat "$WORK/checks-after.txt"
  if [ "$CORE" = FAIL ] && [ "${AUTO:-}" != ROLLED_BACK ]; then
    echo "core check failed on $S7 — switching back to $FROM"; switch_to "$FROM"; restart_site2 || true; AUTO=ROLLED_BACK
    checks > "$WORK/checks-after-rollback.txt"; cat "$WORK/checks-after-rollback.txt"
  fi
elif [ "$MODE" = rollback ]; then
  [ -s "$STATE" ] || die "no previous release recorded in $STATE"
  TO=$(cat "$STATE")
  step "rollback $FROM -> $TO"
  switch_to "$TO"; restart_site2 || die "SITE_2 did not come up on $TO"
  echo "$FROM" > "$STATE"   # a second rollback returns to where we were
  checks > "$WORK/checks-after.txt"; cat "$WORK/checks-after.txt"
else
  die "unknown mode $MODE"
fi

step "4/4 no-impact"
snap > "$WORK/snap-post.txt"
diff "$WORK/snap-pre.txt" "$WORK/snap-post.txt" && IMPACT=NONE || IMPACT=CHANGED
NOW=$(readlink "$OPT/current")
echo
if [ "$MODE" = deploy ]; then
  echo "FAVICON_DEPLOY=$([ "${AUTO:-}" != ROLLED_BACK ] && [ "$ALL" = PASS ] && [ "$IMPACT" = NONE ] && echo PASS || echo BLOCKED)$([ "${AUTO:-}" = ROLLED_BACK ] && echo ' (auto-rolled back)')"
fi
echo "RELEASE_SHA=$(cat "$OPT/current/.release-commit") ($NOW, was $FROM)"
echo "CHECKS=$ALL ($(grep -c '^PASS' "$WORK"/checks-after*.txt | tail -1 | cut -d: -f2) pass, see $WORK)"
echo "SITE_1_IMPACT=$IMPACT"
echo "ROLLBACK_READY=$([ -d "$OPT/$(cat "$STATE")" ] && echo "YES -> $(cat "$STATE") (bash $0 rollback)" || echo NO)"
[ "$ALL$IMPACT" = PASSNONE ]
