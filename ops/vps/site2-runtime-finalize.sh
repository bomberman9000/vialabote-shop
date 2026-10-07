#!/usr/bin/env bash
# SITE_2 runtime — finalization only (steps 7-crash + 8 of site2-runtime-setup.sh).
# Does NOT re-run setup: no env/unit/symlink/enable changes. The only action
# is a simulated crash of vialabote-shop.service's MainPID (SIGKILL via
# --kill-whom=main) to prove Restart=on-failure, then reboot-readiness and the
# SITE_1 post-check against the ORIGINAL pre-setup baseline.
#
# usage (as root):  bash site2-runtime-finalize.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
U=vialabote-shop.service
PORT=3002
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-finalize-$STAMP

die() { echo "ABORT: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
prop() { systemctl show -p "$1" --value "$U"; }
code() { curl -s -o /dev/null -m 30 -w '%{http_code}' "http://127.0.0.1:$PORT$1"; }
cards() { curl -s -m 30 "http://127.0.0.1:$PORT$1" | grep -oE 'href="/product/[a-z0-9-]+"' | sort -u | wc -l; }
health() {
  local h c t p
  h=$(code /); c=$(cards /catalog); t=$(cards '/catalog?category=toniki'); p=$(code /product/toner-serum-ph55)
  echo "home=$h catalog_cards=$c toniki=$t pdp=$p"
  [ "$h" = 200 ] && [ "$c" = 13 ] && [ "$t" = 2 ] && [ "$p" = 200 ]
}
wait_up() { for _ in $(seq 1 60); do [ "$(code /)" = 200 ] && return 0; sleep 1; done; return 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash $0)"
mkdir -p "$WORK"; chmod 700 "$WORK"

step "1/4 preconditions (read-only)"
[ "$(prop ActiveState)" = active ] || die "$U not active — run nothing, investigate first"
[ "$(systemctl is-enabled "$U")" = enabled ] || die "$U not enabled"
BASE=$(ls -1dt /root/vialabote-shop-runtime-*/site1-pre.txt 2>/dev/null | tail -1 || true)   # oldest = before any runtime change
[ -n "$BASE" ] || die "original SITE_1 baseline (site1-pre.txt from runtime setup) not found"
bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-now.txt"
H0=$(health) || die "SITE_2 not healthy before the crash test: $H0"
echo "service: active/enabled, pid=$(prop MainPID), NRestarts=$(prop NRestarts); $H0"
echo "SITE_1 baseline: $BASE (taken before the runtime setup)"

step "2/4 crash test: SIGKILL MainPID only, expect automatic restart"
CG=$(prop ControlGroup)
echo "processes in cgroup before: $(wc -l < "/sys/fs/cgroup$CG/cgroup.procs")"
N0=$(prop NRestarts); P0=$(prop MainPID)
systemctl kill --kill-whom=main -s SIGKILL "$U" || echo "   (systemctl kill rc=$? — judged by restart evidence below)"
sleep 7
wait_up && H1=$(health) && CRASH=PASS || CRASH=FAIL
N1=$(prop NRestarts); P1=$(prop MainPID)
echo "pid $P0 -> $P1, NRestarts $N0 -> $N1, Restart=$(prop Restart), Result=$(prop Result); ${H1:-unhealthy}"
[ "$N1" -gt "$N0" ] && [ "$P1" != "$P0" ] && [ "$(prop ActiveState)" = active ] || CRASH=FAIL
BIND=$(ss -ltnH "sport = :$PORT" | awk '{print $4}' | sort | tr '\n' ' ')
echo "bind after restart: $BIND"
[ "$BIND" = "127.0.0.1:$PORT " ] || CRASH=FAIL

step "3/4 reboot readiness (no reboot)"
echo "is-enabled=$(systemctl is-enabled "$U"); WantedBy=$(prop WantedBy)"
echo "After: $(prop After | tr ' ' '\n' | grep -E 'postgresql@16-shop|network-online' | tr '\n' ' ')"
echo "Wants: $(prop Wants | tr ' ' '\n' | grep -E 'postgresql@16-shop' | tr '\n' ' ')"
echo "postgresql.service=$(systemctl is-enabled postgresql.service); 16/shop start.conf=$(grep -v '^#' /etc/postgresql/16/shop/start.conf | grep .)"

step "4/4 SITE_1 post-check"
bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-post.txt"
strip() { sed '/^-- info --$/,$d' "$1"; }
diff <(strip "$BASE") <(strip "$WORK/site1-post.txt") && SITE1=UNCHANGED || SITE1=CHANGED
same() { diff <(grep -E "^$1" "$BASE") <(grep -E "^$1" "$WORK/site1-post.txt") >/dev/null && echo UNCHANGED || echo CHANGED; }
grep -A2 "^-- info --" "$WORK/site1-post.txt"

echo
echo "CRASH_RESTART=$CRASH"
echo "SYSTEMD_ACTIVE=$(systemctl is-active "$U")"
echo "SYSTEMD_ENABLED=$(systemctl is-enabled "$U")"
echo "HOME=$(code /)"
echo "HEALTH=${H1:-unhealthy}"
echo "SITE_1_HTTP=$(same 'http |cert ')"
echo "SITE_1_SERVICE=$(same 'unit')"
echo "SITE_1_PORT=$(same 'listen ')"
echo "SITE_1_DB=$(same 'unit postgresql@16-main|sha256 /etc/postgresql/16/main|pg-clusters')"
echo "SITE_1=$SITE1 (vs pre-setup baseline)"
echo "EVIDENCE=$WORK"
[ "$SITE1" = UNCHANGED ] || { echo "SITE_1 CHANGED — STOP. See diff above." >&2; exit 2; }
[ "$CRASH" = PASS ] || exit 1
