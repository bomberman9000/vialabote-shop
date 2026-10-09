#!/usr/bin/env bash
# Removes everything site2-db-setup.sh created for SITE_2 (vialabote-shop) and
# nothing else. Cluster 16/main and all SITE_1 files are only READ (pre/post
# snapshot). Destroys the SITE_2 database and its backups — a final dump is
# saved to /root first.
#
# usage (as root):  bash site2-db-rollback.sh --yes
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ "${1:-}" = "--yes" ] || { echo "This deletes SITE_2's DB cluster 16/shop, user and dirs. Re-run with --yes." >&2; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=/root/vialabote-shop-rollback-$STAMP
mkdir -p "$WORK"; chmod 700 "$WORK"

bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-pre.txt"

if pg_lsclusters --no-header | awk '{print $2}' | grep -qx shop; then
  runuser -u postgres -- pg_dump -p 5433 -Fc -d vialabote_shop -f /tmp/vialabote-shop-final.dump 2>/dev/null \
    && mv /tmp/vialabote-shop-final.dump "$WORK/final.dump" && echo "final dump: $WORK/final.dump"
fi

systemctl disable --now vialabote-shop-pgdump.timer vialabote-shop-backup-check.timer 2>/dev/null
rm -f /etc/systemd/system/vialabote-shop-pgdump.{service,timer} \
      /etc/systemd/system/vialabote-shop-backup-check.{service,timer} \
      /etc/systemd/system/vialabote-shop-backup-alert.service \
      /usr/local/sbin/vialabote-shop-pgdump /usr/local/sbin/vialabote-shop-backup-check
systemctl daemon-reload

if pg_lsclusters --no-header | awk '{print $2}' | grep -qx shop; then
  systemctl stop postgresql@16-shop.service 2>/dev/null
  pg_dropcluster 16 shop --stop
fi

getent passwd vialabote-shop >/dev/null && userdel vialabote-shop
rm -rf /etc/vialabote-shop /opt/vialabote-shop /var/backups/vialabote-shop

bash "$HERE/site1-healthcheck.sh" > "$WORK/site1-post.txt"
strip() { sed '/^-- info --$/,$d' "$1"; }
if diff <(strip "$WORK/site1-pre.txt") <(strip "$WORK/site1-post.txt"); then echo "SITE_1=UNCHANGED"; else echo "SITE_1=CHANGED (see diff)"; fi
echo "SITE_2 removed. Evidence: $WORK"
