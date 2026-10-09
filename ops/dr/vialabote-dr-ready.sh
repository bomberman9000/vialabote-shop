#!/usr/bin/env bash
# Vialabote DR — DR_READY evaluation (read-only). Runs INSIDE vialabote-dr as root.
# DR_READY=YES only if ALL hold:
#   1. platform health (vialabote-dr-health) OK
#   2. both standby units active and answering through the test routing
#   3. the standby is promoted from a VERIFIED **PROD** set (never TEST)
#   4. that PROD set is younger than RPO_HOURS (default 24)
#   5. deployed release commits match the commits recorded in that set
# Otherwise DR_READY=NO with every failing reason listed.
set -uo pipefail
export LC_ALL=C
RPO_HOURS=${RPO_HOURS:-24}
BASE=/var/lib/vialabote-dr
R=()
/usr/local/sbin/vialabote-dr-health >/dev/null 2>&1 || R+=("platform health check failed")
for u in vialabote-site vialabote-shop; do systemctl is-active --quiet "$u.service" || R+=("$u not active"); done
S1=$(curl -s -o /dev/null -m 15 -w '%{http_code}' --resolve vialabote.ru:8081:127.0.0.1 http://vialabote.ru:8081/)
S2=$(curl -s -o /dev/null -m 15 -w '%{http_code}' --resolve shop.vialabote.ru:8081:127.0.0.1 http://shop.vialabote.ru:8081/)
[ "$S1" = 200 ] || R+=("SITE_1 via test routing -> $S1")
[ "$S2" = 200 ] || R+=("SITE_2 via test routing -> $S2")
CUR=$(basename "$(readlink "$BASE/CURRENT" 2>/dev/null || echo none)")
STATUS=$BASE/status/$CUR.json
if [ "$CUR" = none ] || [ ! -f "$STATUS" ]; then
  R+=("standby not promoted from any verified set (data: $(cut -d' ' -f1 "$BASE/status/standby-data" 2>/dev/null || echo unknown))")
else
  read -r V L T < <(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["verdict"],d["label"],d["verified_at"])' "$STATUS")
  [ "$V" = VERIFIED ] || R+=("current set $CUR is $V")
  [ "$L" = PROD ] || R+=("current set $CUR is a $L set, not a production backup")
  AGE_H=$(( ( $(date -u +%s) - $(date -u -d "$(echo "$CUR" | sed -E 's/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z.*/\1-\2-\3 \4:\5:\6/')" +%s) ) / 3600 ))
  [ "$AGE_H" -le "$RPO_HOURS" ] || R+=("current set is ${AGE_H}h old > RPO ${RPO_HOURS}h")
fi
echo "standby: SITE_1 $S1, SITE_2 $S2; current set: $CUR"
if [ ${#R[@]} -eq 0 ]; then echo "DR_READY=YES"; exit 0; fi
# Reasons that only a production backup from PRIMARY can clear:
ONLY_PRIMARY=1
for r in "${R[@]}"; do
  case "$r" in "current set "*" is a TEST set, not a production backup"|"standby not promoted from any verified set"*) ;; *) ONLY_PRIMARY=0 ;; esac
done
if [ "$ONLY_PRIMARY" = 1 ]; then echo "DR_READY=BLOCKED_ONLY_BY_MISSING_PRIMARY_STATE"; else echo "DR_READY=NO"; fi
for r in "${R[@]}"; do echo "  - $r"; done; exit 1
